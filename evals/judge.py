#!/usr/bin/env python3
"""Judge the answers in a run file with Sonnet: faithfulness 0-2 and tone 0-1.

Reads a run file written by ``run.py``, asks the judge model once per answer,
adds a ``judge`` object to each record, rewrites the file in place (atomically,
after every verdict) and prints the mean per kind and the cost per question.

The rubric is ``prompts/judge.md`` (versioned; its short sha256 is recorded on
every verdict). The judge's system block is the rubric followed by the whole
material with line ids, in the same shape the answer model sees. The user turn
holds the question, the answer, the exact text of every line the answer cited
(``common.extract_citations``, the Worker's parser), and separately any cited
id that is not in the material and any citation written as a range, so the
judge checks each citation against the specific line it points at. The verdict
is JSON enforced with a schema (``output_config.format``).

Usage:
    python evals/judge.py evals/runs/<file>.jsonl            # judge records without a verdict
    python evals/judge.py evals/runs/<file>.jsonl --rejudge  # judge all again
    python evals/judge.py evals/runs/<file>.jsonl --dry-run  # print the first judge input, call nothing

The API key is read from CVBOT_API_KEY (ANTHROPIC_API_KEY as a local fallback)
with os.environ only; never printed or written. Needs ``anthropic`` (evals/requirements.txt).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import common
from common import JUDGE_MODEL, JUDGE_PROMPT_PATH, KINDS, MATERIAL_DIR, EvalError, Material

JUDGE_MAX_TOKENS = 4096  # the verdict is small; the room is for the model's own reasoning

VERDICT_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "faithfulness": {"type": "integer", "enum": [0, 1, 2]},
        "tone": {"type": "integer", "enum": [0, 1]},
        "citations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "supports": {"type": "boolean"},
                    "note": {"type": "string"},
                },
                "required": ["id", "supports", "note"],
                "additionalProperties": False,
            },
        },
        "unsupported_claims": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "string"},
    },
    "required": ["faithfulness", "tone", "citations", "unsupported_claims", "notes"],
    "additionalProperties": False,
}


def build_judge_system(judge_prompt: str, material: Material) -> str:
    """Rubric, then ``# Material`` with every line and its id (same shape as the answer model's block)."""
    return common.build_system_block(judge_prompt, material.lines)


def build_judge_input(record: dict, material: Material) -> str:
    """The user turn: question, answer, the cited lines' exact text, and what the Worker would drop."""
    answer = record.get("answer") or ""
    cited = common.extract_citations(answer, material.ids)
    unknown = common.unknown_citations(answer, material.ids)
    ranges = common.range_citations(answer)

    parts = ["## Question", record["question"], "", "## Answer", answer, "", "## Cited lines"]
    if cited:
        parts.extend(f"{line_id}: {material.text_of(line_id)}" for line_id in cited)
    else:
        parts.append("The answer cites no line of the material.")
    if unknown:
        parts.extend(["", "## Cited ids that are not in the material (they support nothing)", *unknown])
    if ranges:
        parts.extend(["", "## Citations written as a range (they cite nothing)", *(f"[{r}]" for r in ranges)])
    return "\n".join(parts)


def parse_verdict(text: str) -> dict:
    """The judge's JSON, validated; EvalError when it is not a verdict."""
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise EvalError(f"judge returned non-JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise EvalError("judge returned a non-object")
    missing = set(VERDICT_SCHEMA["required"]) - data.keys()
    if missing:
        raise EvalError(f"judge verdict missing {sorted(missing)}")
    if data["faithfulness"] not in (0, 1, 2) or isinstance(data["faithfulness"], bool):
        raise EvalError(f"faithfulness out of range: {data['faithfulness']!r}")
    if data["tone"] not in (0, 1) or isinstance(data["tone"], bool):
        raise EvalError(f"tone out of range: {data['tone']!r}")
    if not isinstance(data["citations"], list) or not isinstance(data["unsupported_claims"], list):
        raise EvalError("citations and unsupported_claims must be lists")
    if not isinstance(data["notes"], str):
        raise EvalError("notes must be a string")
    return {
        "faithfulness": int(data["faithfulness"]),
        "tone": int(data["tone"]),
        "citations": [
            {"id": str(c.get("id", "")), "supports": bool(c.get("supports")), "note": str(c.get("note", ""))}
            for c in data["citations"]
            if isinstance(c, dict)
        ],
        "unsupported_claims": [str(c) for c in data["unsupported_claims"]],
        "notes": data["notes"],
    }


class Judge:
    def __init__(self, system: str, model: str = JUDGE_MODEL, timeout: float = 120.0, max_retries: int = 3) -> None:
        import anthropic  # here, so checks and tests never need it

        self._anthropic = anthropic
        self.client = anthropic.Anthropic(api_key=common.api_key(), timeout=timeout, max_retries=max_retries)
        self.system = system
        self.model = model

    def judge(self, user_text: str) -> dict:
        """``{"verdict": {...} | None, "error": str | None, "usage", "cost_usd", "latency_ms", "stop_reason"}``."""
        started = time.monotonic()
        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=JUDGE_MAX_TOKENS,
                system=[{"type": "text", "text": self.system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user_text}],
                output_config={"format": {"type": "json_schema", "schema": VERDICT_SCHEMA}},
            )
        except self._anthropic.APIStatusError as exc:
            error_type = getattr(exc, "type", None) or type(exc).__name__
            return _failed(f"api_error status={exc.status_code} type={error_type}", started)
        except self._anthropic.APIConnectionError as exc:
            return _failed(f"connection_error {type(exc).__name__}", started)
        latency_ms = int(round((time.monotonic() - started) * 1000))
        usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_creation_input_tokens": response.usage.cache_creation_input_tokens or 0,
            "cache_read_input_tokens": response.usage.cache_read_input_tokens or 0,
        }
        result = {
            "verdict": None,
            "error": None,
            "usage": usage,
            "cost_usd": common.cost_usd(self.model, usage),
            "latency_ms": latency_ms,
            "stop_reason": response.stop_reason,
        }
        if response.stop_reason in ("refusal", "max_tokens"):
            result["error"] = f"judge stopped with {response.stop_reason}"
            return result
        text = "".join(block.text for block in response.content if block.type == "text").strip()
        try:
            result["verdict"] = parse_verdict(text)
        except EvalError as exc:
            result["error"] = str(exc)
        return result


def _failed(error: str, started: float) -> dict:
    return {
        "verdict": None,
        "error": error,
        "usage": None,
        "cost_usd": None,
        "latency_ms": int(round((time.monotonic() - started) * 1000)),
        "stop_reason": None,
    }


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def format_report(run_path: Path, records: list[dict]) -> str:
    judged = [r for r in records if isinstance(r.get("judge"), dict) and r["judge"].get("faithfulness") is not None]
    unjudged = [r for r in records if r not in judged]
    models = sorted({r["judge"].get("model") for r in judged if r["judge"].get("model")})
    prompts = sorted({r["judge"].get("prompt_title") or r["judge"].get("prompt_sha") or "?" for r in judged})
    head = (
        f"judge: {run_path}: {len(judged)} of {len(records)} record(s) judged by {', '.join(models) or '?'} "
        f"with {', '.join(repr(p) for p in prompts) or '?'}"
    )
    rows = ["  kind            n   faith   f=2  f=1  f=0   tone   answer $/q   judge $/q"]
    for kind in (*KINDS, "all"):
        group = judged if kind == "all" else [r for r in judged if r["kind"] == kind]
        if not group:
            rows.append(f"  {kind:<14} {0:>3}       -     -    -    -      -            -           -")
            continue
        faith = [r["judge"]["faithfulness"] for r in group]
        tone = [r["judge"]["tone"] for r in group]
        answer_cost = mean([r["cost_usd"] for r in group if r.get("cost_usd") is not None])
        judge_cost = mean([r["judge"]["cost_usd"] for r in group if r["judge"].get("cost_usd") is not None])
        rows.append(
            f"  {kind:<14} {len(group):>3}   {mean(faith):.2f}   {faith.count(2):>3}  {faith.count(1):>3}  {faith.count(0):>3}   "
            f"{mean(tone):.2f}   {common.fmt_usd(answer_cost):>10}   {common.fmt_usd(judge_cost):>9}"
        )
    parts = [head, *rows]
    low = [r for r in judged if r["judge"]["faithfulness"] < 2 or r["judge"]["tone"] < 1]
    for r in low:
        j = r["judge"]
        notes = " ".join(j.get("notes", "").split())
        parts.append(f"  LOW {r['id']} ({r['kind']}) faith={j['faithfulness']} tone={j['tone']}: {notes}")
    for r in unjudged:
        reason = (r.get("judge") or {}).get("error") or "not judged"
        parts.append(f"  UNJUDGED {r['id']} ({r.get('kind', '?')}): {reason}")
    return "\n".join(parts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="judge.py", description="Judge a run file's answers with Sonnet.")
    parser.add_argument("run", type=Path, help="run file from run.py; rewritten in place with a judge object per record")
    parser.add_argument("--rejudge", action="store_true", help="judge records that already have a verdict")
    parser.add_argument("--ids", help="comma-separated question ids to judge (default all)")
    parser.add_argument("--model", default=JUDGE_MODEL)
    parser.add_argument("--prompt", type=Path, default=JUDGE_PROMPT_PATH, help="judge prompt (default prompts/judge.md)")
    parser.add_argument("--material", type=Path, default=MATERIAL_DIR)
    parser.add_argument("--timeout", type=float, default=120.0, help="seconds per request")
    parser.add_argument("--dry-run", action="store_true", help="print the system block size and the first judge input; call nothing")
    args = parser.parse_args(argv)

    try:
        records = common.read_jsonl(args.run)
        material = common.load_material(args.material)
        judge_prompt = args.prompt.read_text(encoding="utf-8")
    except (EvalError, OSError) as exc:
        print(f"judge: {exc}", file=sys.stderr)
        return 1
    if not records:
        print(f"judge: {args.run} has no records", file=sys.stderr)
        return 1

    hashes = {r.get("material_hash") for r in records} - {None}
    if hashes and hashes != {material.hash}:
        print(
            f"judge: warning: the run was made with material {', '.join(sorted(hashes))}, "
            f"the judge quotes the current material {material.hash}; ids may have moved"
        )

    wanted = set(args.ids.split(",")) if args.ids else None
    todo = [
        r for r in records
        if (wanted is None or r.get("id") in wanted) and (args.rejudge or "judge" not in r)
    ]
    system = build_judge_system(judge_prompt, material)
    prompt_meta = {
        "model": args.model,
        "prompt_sha": common.short_sha256(judge_prompt),
        "prompt_title": common.first_heading(judge_prompt),
        "material_hash": material.hash,
    }
    print(
        f"judge: {len(todo)} of {len(records)} record(s) to judge with {args.model}, "
        f"prompt {prompt_meta['prompt_title']!r} ({prompt_meta['prompt_sha']}), material {material.hash}"
    )
    if args.dry_run:
        print(f"judge: system block {len(system)} chars")
        if todo:
            print("judge: first input:\n" + build_judge_input(todo[0], material))
        return 0
    if not todo:
        print(format_report(args.run, records))
        return 0

    try:
        judge = Judge(system, model=args.model, timeout=args.timeout)
    except EvalError as exc:
        print(f"judge: {exc}", file=sys.stderr)
        return 1

    errors = 0
    for record in todo:
        judged_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if record.get("error") or record.get("refused") or not (record.get("answer") or "").strip():
            record["judge"] = {**prompt_meta, "judged_at": judged_at, "faithfulness": None, "tone": None, "error": "no model answer to judge"}
            common.write_jsonl(args.run, records)
            print(f"  {record['id']:<4} {record['kind']:<13} skipped: no model answer", flush=True)
            continue
        result = judge.judge(build_judge_input(record, material))
        verdict = result["verdict"] or {"faithfulness": None, "tone": None, "citations": [], "unsupported_claims": [], "notes": ""}
        record["judge"] = {
            **prompt_meta,
            "judged_at": judged_at,
            **verdict,
            "usage": result["usage"],
            "cost_usd": result["cost_usd"],
            "latency_ms": result["latency_ms"],
            "stop_reason": result["stop_reason"],
            "error": result["error"],
        }
        common.write_jsonl(args.run, records)
        if result["error"]:
            errors += 1
            print(f"  {record['id']:<4} {record['kind']:<13} ERROR {result['error']}", flush=True)
        else:
            print(
                f"  {record['id']:<4} {record['kind']:<13} faith={verdict['faithfulness']} tone={verdict['tone']} "
                f"{result['latency_ms']:>6} ms {common.fmt_usd(result['cost_usd']):>8}",
                flush=True,
            )

    print(format_report(args.run, records))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
