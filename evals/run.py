#!/usr/bin/env python3
"""Run the eval questions against the bot and write one record per question.

Two modes, one required:

  --direct       call the model directly with the same request the Worker sends:
                 the system block is prompts/system.md + ``# Material`` + the bundled
                 material with line ids (``buildSystemBlock`` in worker/src/worker.ts),
                 model claude-haiku-4-5-20251001, temperature 0, max_tokens 600, the
                 system block marked for caching, API version 2023-06-01 (worker/src/model.ts).
  --worker URL   POST each question to a deployed Worker's ``/ask``. The Worker's
                 rate limit (10 questions / 10 minutes per IP) is respected by
                 sleeping for ``retry-after`` on 429.

Output: ``evals/runs/<utc date>-<git short sha>.jsonl`` (or ``--out``), one JSON
object per question, written after every answer so a crash loses nothing:

  id, kind, question, answer, citations, refused, error, stop_reason, usage,
  cost_usd, latency_ms, model, mode, material_hash, system_prompt_sha,
  system_prompt_title, git_sha, git_dirty, run_at

``citations`` is what the Worker returns: existing ids, in order, deduplicated
(in --direct mode computed with the same parser, ``common.extract_citations``).
Then the hard checks (``checks.py``) run on the file and the pass table is printed.
Exit status is 1 when any question got no model answer.

The API key is read from the environment variable CVBOT_API_KEY (ANTHROPIC_API_KEY
as a local fallback) with os.environ only; it is never printed, logged or written.
--direct needs the ``anthropic`` package (evals/requirements.txt); --worker needs
only the standard library.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import checks
import common
from common import (
    ANSWER_API_VERSION,
    ANSWER_MAX_TOKENS,
    ANSWER_MODEL,
    ANSWER_TEMPERATURE,
    FORBIDDEN_PATH,
    MATERIAL_DIR,
    QUESTIONS_PATH,
    RUNS_DIR,
    SYSTEM_PROMPT_PATH,
    EvalError,
    Material,
)

WORKER_MAX_ATTEMPTS = 8
WORKER_MAX_WAIT_SECONDS = 15 * 60


def default_run_path(runs_dir: Path, now: datetime, git_sha: str) -> Path:
    return runs_dir / f"{now.strftime('%Y-%m-%d')}-{git_sha}.jsonl"


def select_questions(questions: list[dict], ids: list[str] | None, limit: int | None) -> list[dict]:
    selected = questions
    if ids:
        wanted = set(ids)
        selected = [q for q in questions if q["id"] in wanted]
        missing = wanted - {q["id"] for q in selected}
        if missing:
            raise EvalError(f"unknown question id(s): {', '.join(sorted(missing))}")
    if limit is not None:
        selected = selected[:limit]
    return selected


def _no_answer(error: str, latency_ms: int) -> dict:
    return {
        "answer": "",
        "citations": None,
        "refused": True,
        "error": error,
        "stop_reason": None,
        "usage": None,
        "cost_usd": None,
        "latency_ms": latency_ms,
    }


class DirectAnswerer:
    """The Worker's model call (worker/src/model.ts ``askModel``), made from Python.

    The installed SDK sends API version 2026-10-21 by default, which rejects
    ``temperature``; the Worker pins 2023-06-01 and sends temperature 0. Both are
    overridden per request here so the eval tests exactly what the Worker sends.
    """

    mode = "direct"

    def __init__(
        self,
        system_block: str,
        model: str = ANSWER_MODEL,
        max_tokens: int = ANSWER_MAX_TOKENS,
        temperature: float = ANSWER_TEMPERATURE,
        api_version: str = ANSWER_API_VERSION,
        timeout: float = 60.0,
        max_retries: int = 3,
    ) -> None:
        import anthropic  # here, so checks and tests never need it

        self._anthropic = anthropic
        self.client = anthropic.Anthropic(api_key=common.api_key(), timeout=timeout, max_retries=max_retries)
        self.system_block = system_block
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.api_version = api_version

    def ask(self, question: str) -> dict:
        started = time.monotonic()
        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                system=[{"type": "text", "text": self.system_block, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": [{"type": "text", "text": question}]}],
                extra_headers={"anthropic-version": self.api_version},
                extra_body={"temperature": self.temperature},
            )
        except self._anthropic.APIStatusError as exc:
            # Status and error type only: never the body, which is not needed and not ours.
            error_type = getattr(exc, "type", None) or type(exc).__name__
            return _no_answer(f"api_error status={exc.status_code} type={error_type}", _ms(started))
        except self._anthropic.APIConnectionError as exc:
            return _no_answer(f"connection_error {type(exc).__name__}", _ms(started))
        latency_ms = _ms(started)

        text = "".join(block.text for block in response.content if block.type == "text").strip()
        usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_creation_input_tokens": response.usage.cache_creation_input_tokens or 0,
            "cache_read_input_tokens": response.usage.cache_read_input_tokens or 0,
        }
        cost = common.cost_usd(self.model, usage)
        if text == "":
            # The Worker treats this as a model error and answers "not available".
            fields = _no_answer(f"model returned no text (stop_reason={response.stop_reason})", latency_ms)
            fields.update(stop_reason=response.stop_reason, usage=usage, cost_usd=cost)
            return fields
        return {
            "answer": text,
            "citations": None,  # filled in by the caller with the same parser the Worker uses
            "refused": False,
            "error": None,
            "stop_reason": response.stop_reason,
            "usage": usage,
            "cost_usd": cost,
            "latency_ms": latency_ms,
        }


class WorkerAnswerer:
    """POST /ask on a deployed Worker. Sleeps on 429 as the Worker's retry-after says."""

    mode = "worker"

    def __init__(self, base_url: str, timeout: float = 60.0, max_wait_seconds: int = WORKER_MAX_WAIT_SECONDS, sleep=time.sleep) -> None:
        self.url = base_url.rstrip("/") + "/ask"
        self.timeout = timeout
        self.max_wait_seconds = max_wait_seconds
        self.sleep = sleep

    def ask(self, question: str) -> dict:
        body = json.dumps({"question": question}).encode("utf-8")
        for attempt in range(1, WORKER_MAX_ATTEMPTS + 1):
            request = urllib.request.Request(self.url, data=body, headers={"content-type": "application/json"}, method="POST")
            started = time.monotonic()
            retry_after = None
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    status, raw = response.status, response.read()
            except urllib.error.HTTPError as exc:
                status, raw = exc.code, exc.read()
                retry_after = exc.headers.get("retry-after")
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                return _no_answer(f"network_error {type(exc).__name__}", _ms(started))
            latency_ms = _ms(started)

            try:
                payload = json.loads(raw)
            except ValueError:
                return _no_answer(f"worker returned non-JSON (status {status})", latency_ms)
            if not isinstance(payload, dict):
                return _no_answer(f"worker returned an unexpected shape (status {status})", latency_ms)

            if status == 429 and attempt < WORKER_MAX_ATTEMPTS:
                try:
                    wait = int(retry_after) if retry_after else 60
                except ValueError:
                    wait = 60
                wait = max(0, min(wait, self.max_wait_seconds))
                print(f"  rate limited by the Worker; waiting {wait}s (attempt {attempt})", flush=True)
                self.sleep(wait)
                continue

            answer = payload.get("answer")
            refused = bool(payload.get("refused", status != 200))
            return {
                "answer": answer if isinstance(answer, str) else "",
                "citations": [c for c in payload.get("citations", []) if isinstance(c, str)],
                "refused": refused,
                "error": f"worker refused (status {status})" if refused else None,
                "stop_reason": None,
                "usage": None,  # the Worker does not expose token counts
                "cost_usd": None,
                "latency_ms": latency_ms,
                "worker_status": status,
                "material_hash": payload.get("material_hash"),
            }
        return _no_answer("worker kept rate limiting", 0)


def _ms(started: float) -> int:
    return int(round((time.monotonic() - started) * 1000))


def make_record(question: dict, fields: dict, material: Material, meta: dict) -> dict:
    answer = fields.get("answer") or ""
    citations = fields.get("citations")
    if citations is None:
        citations = common.extract_citations(answer, material.ids)
    record = {
        "id": question["id"],
        "kind": question["kind"],
        "question": question["question"],
        "answer": answer,
        "citations": citations,
        "refused": bool(fields.get("refused")),
        "error": fields.get("error"),
        "stop_reason": fields.get("stop_reason"),
        "usage": fields.get("usage"),
        "cost_usd": fields.get("cost_usd"),
        "latency_ms": fields.get("latency_ms"),
        **meta,
    }
    if fields.get("material_hash"):
        record["material_hash"] = fields["material_hash"]
    if "worker_status" in fields:
        record["worker_status"] = fields["worker_status"]
    return record


def progress_line(record: dict) -> str:
    usage = record.get("usage") or {}
    tokens = f"{usage.get('input_tokens', 0)}+{usage.get('output_tokens', 0)} tok" if usage else "-"
    status = "ERROR" if record.get("error") else ("refused" if record.get("refused") else "ok")
    return (
        f"  {record['id']:<4} {record['kind']:<13} {status:<7} {record.get('latency_ms') or 0:>6} ms "
        f"{tokens:>14} {common.fmt_usd(record.get('cost_usd')):>8}  cites={record['citations']}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="run.py", description="Run the eval questions and write a run file.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--direct", action="store_true", help="call the model directly with the Worker's request")
    mode.add_argument("--worker", metavar="URL", help="send questions to a deployed Worker (its base URL)")
    parser.add_argument("--out", type=Path, help="run file to write (default evals/runs/<date>-<sha>.jsonl)")
    parser.add_argument("--force", action="store_true", help="overwrite the output file if it exists")
    parser.add_argument("--ids", help="comma-separated question ids to run (default all)")
    parser.add_argument("--limit", type=int, help="run only the first N selected questions")
    parser.add_argument("--questions", type=Path, default=QUESTIONS_PATH)
    parser.add_argument("--forbidden", type=Path, default=FORBIDDEN_PATH)
    parser.add_argument("--material", type=Path, default=MATERIAL_DIR)
    parser.add_argument("--prompt", type=Path, default=SYSTEM_PROMPT_PATH, help="system prompt file (default prompts/system.md)")
    parser.add_argument("--model", default=ANSWER_MODEL, help="answer model for --direct (default: the Worker's)")
    parser.add_argument("--timeout", type=float, default=60.0, help="seconds per request")
    args = parser.parse_args(argv)

    try:
        questions = common.load_questions(args.questions)
        forbidden = common.load_forbidden(args.forbidden)
        material = common.load_material(args.material)
        selected = select_questions(questions, args.ids.split(",") if args.ids else None, args.limit)
        if not selected:
            raise EvalError(f"no questions to run from {args.questions}")
        if not material.lines:
            raise EvalError(f"no material under {args.material}")
        system_prompt = args.prompt.read_text(encoding="utf-8")
        if args.direct:
            ts_hash = common.material_ts_hash()
            if ts_hash is not None and ts_hash != material.hash:
                raise EvalError(
                    f"worker/src/material.ts ({ts_hash}) is out of date with {args.material} ({material.hash}); "
                    "run `python scripts/bundle_material.py` first so the run tests what the Worker ships"
                )
            answerer = DirectAnswerer(
                common.build_system_block(system_prompt, material.lines),
                model=args.model,
                timeout=args.timeout,
            )
        else:
            answerer = WorkerAnswerer(args.worker, timeout=args.timeout)
    except (EvalError, OSError) as exc:
        print(f"run: {exc}", file=sys.stderr)
        return 1

    now = datetime.now(timezone.utc)
    git_sha = common.git_short_sha()
    dirty = common.git_dirty()
    out = args.out or default_run_path(RUNS_DIR, now, git_sha)
    if out.exists() and not args.force:
        print(f"run: {out} exists; pass --out for another file or --force to overwrite", file=sys.stderr)
        return 1

    meta = {
        "model": args.model,
        "mode": answerer.mode,
        "material_hash": material.hash,
        "system_prompt_sha": common.short_sha256(system_prompt),
        "system_prompt_title": common.first_heading(system_prompt),
        "git_sha": git_sha,
        "git_dirty": dirty,
        "run_at": now.isoformat(timespec="seconds"),
    }
    print(
        f"run: {len(selected)} question(s), mode {meta['mode']}, model {meta['model']}, "
        f"material {material.hash} ({len(material.lines)} lines), prompt {meta['system_prompt_title']!r} "
        f"({meta['system_prompt_sha']}), git {git_sha}{' (dirty)' if dirty else ''}"
    )
    print(f"run: writing {out}")

    records: list[dict] = []
    for question in selected:
        fields = answerer.ask(question["question"])
        record = make_record(question, fields, material, meta)
        records.append(record)
        common.write_jsonl(out, records)
        print(progress_line(record), flush=True)

    hashes = {r.get("material_hash") for r in records} - {None, material.hash}
    if hashes:
        print(f"run: warning: the Worker answered with material {', '.join(sorted(hashes))}, local bundle is {material.hash}")

    results = checks.run_checks(records, selected, material.ids, forbidden)
    print(checks.format_report(out, records, results))
    costs = [r["cost_usd"] for r in records if r.get("cost_usd") is not None]
    errors = sum(1 for r in records if r.get("error"))
    total = sum(costs) if costs else None
    mean = (total / len(costs)) if costs else None
    print(
        f"run: {len(records)} record(s), {errors} without an answer, "
        f"answer cost total {common.fmt_usd(total)}, per question {common.fmt_usd(mean)}"
    )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
