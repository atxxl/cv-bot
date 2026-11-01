#!/usr/bin/env python3
"""Shared pieces of the eval scripts (``run.py``, ``checks.py``, ``judge.py``).

- Paths of the inputs and outputs under ``evals/`` and ``prompts/``.
- The material with its line ids, read through ``scripts/bundle_material.py``
  so the ids and the hash are exactly the ones bundled into the Worker.
- The system block assembled exactly as ``worker/src/worker.ts``
  (``buildSystemBlock``) assembles it.
- The citation parser ported from ``worker/src/citations.ts`` (including its
  expansion of short ranges such as ``[mai#3–mai#5]``), plus the detection of
  range citations that the Worker does not expand.
- The price table from ``worker/src/model.ts`` (and the judge model's), with
  the same cost formula.
- Small helpers: JSONL in and out, sha256 prefixes, git metadata, the API key.

Standard library only. ``anthropic`` is imported by ``run.py`` and ``judge.py``
inside the functions that call the API, so the checks and the tests never need it.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

EVALS_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVALS_DIR.parent
RUNS_DIR = EVALS_DIR / "runs"
QUESTIONS_PATH = EVALS_DIR / "questions.jsonl"
FORBIDDEN_PATH = EVALS_DIR / "forbidden.txt"
SYSTEM_PROMPT_PATH = REPO_ROOT / "prompts" / "system.md"
JUDGE_PROMPT_PATH = REPO_ROOT / "prompts" / "judge.md"
MATERIAL_DIR = REPO_ROOT / "material"
MATERIAL_TS = REPO_ROOT / "worker" / "src" / "material.ts"

sys.path.insert(0, str(REPO_ROOT / "scripts"))
import bundle_material  # noqa: E402  (after sys.path setup)

MaterialLine = bundle_material.MaterialLine

KINDS: tuple[str, ...] = ("grounded", "not_done", "out_of_scope", "injection")
REQUIRED_QUESTION_FIELDS = frozenset({"id", "kind", "question", "expect"})

# The answer model, as configured in worker/wrangler.toml [vars] and called in
# worker/src/model.ts. The eval's --direct mode sends the same request.
ANSWER_MODEL = "claude-haiku-4-5-20251001"
ANSWER_MAX_TOKENS = 600
ANSWER_TEMPERATURE = 0
ANSWER_API_VERSION = "2023-06-01"  # worker/src/model.ts ANTHROPIC_VERSION

# The judge (CLAUDE.md: Sonnet, only inside evals/).
JUDGE_MODEL = "claude-sonnet-5-5"

# USD per million tokens. Haiku 4.5 mirrors worker/src/model.ts; Sonnet 5.5 is
# the judge. Cache writes are 1.25x input, cache reads 0.1x.
PRICES_USD_PER_MTOK: dict[str, dict[str, float]] = {
    "claude-haiku-4-5-20251001": {"input": 1.0, "output": 5.0, "cache_write": 1.25, "cache_read": 0.1},
    "claude-sonnet-5-5": {"input": 2.0, "output": 10.0, "cache_write": 2.5, "cache_read": 0.2},
}

SHORT_HASH_LENGTH = 12


class EvalError(Exception):
    """A problem with the inputs that the CLI reports and exits 1 on."""


# -- material and system block -------------------------------------------------


@dataclass(frozen=True)
class Material:
    lines: tuple[MaterialLine, ...]
    hash: str

    @property
    def ids(self) -> frozenset[str]:
        return frozenset(line.id for line in self.lines)

    def text_of(self, line_id: str) -> str | None:
        for line in self.lines:
            if line.id == line_id:
                return line.text
        return None


def load_material(material_dir: Path = MATERIAL_DIR) -> Material:
    """The material exactly as ``scripts/bundle_material.py`` bundles it (same ids, same hash)."""
    try:
        bundle = bundle_material.bundle_material(material_dir)
    except bundle_material.BundleError as exc:
        raise EvalError(str(exc)) from exc
    return Material(lines=bundle.lines, hash=bundle.hash)


_MATERIAL_TS_HASH = re.compile(r'export const MATERIAL_HASH: string = "([0-9a-f]+)";')


def material_ts_hash(path: Path = MATERIAL_TS) -> str | None:
    """The hash bundled into ``worker/src/material.ts``, or None if the file or the line is missing."""
    if not path.exists():
        return None
    match = _MATERIAL_TS_HASH.search(path.read_text(encoding="utf-8"))
    return match.group(1) if match else None


def build_system_block(system_prompt: str, lines: Sequence[MaterialLine]) -> str:
    """Port of ``buildSystemBlock`` in worker/src/worker.ts: prompt, blank line,
    ``# Material``, blank line, one ``id: text`` line per entry, trailing newline."""
    rendered = "\n".join(f"{line.id}: {line.text}" for line in lines)
    return f"{system_prompt.rstrip()}\n\n# Material\n\n{rendered}\n"


# -- citations (port of worker/src/citations.ts) ----------------------------------

LINE_ID = re.compile(r"^[A-Za-z0-9_.-]+#[0-9]+$")
BRACKET_GROUP = re.compile(r"\[([^\[\]]{1,300})\]")
TOKEN_SPLIT = re.compile(r"[\s,;]+")
ID_SHAPED = re.compile(r"^[A-Za-z0-9_.-]*#[0-9]+[A-Za-z0-9_.#-]*$")

# The Worker's range rule (worker/src/citations.ts, RANGE and expandRange): a
# start id, then a hyphen or en dash (spaces optional) or the word `to` or
# `through` (spaces required), then an end id or a bare line number, standing
# alone between separators. It is expanded to one id per line when both ends are
# in the same file, the start is lower than the end, and it covers at most
# MAX_RANGE_LINES lines; otherwise it is dropped whole, endpoints included.
MAX_RANGE_LINES = 8
MAX_SAFE_INTEGER = 2**53 - 1  # Number.isSafeInteger in the Worker
WORKER_RANGE = re.compile(
    r"(?<![^\s,;])([A-Za-z0-9_.-]+)#([0-9]+)(?:\s*[-\u2013]\s*|\s+(?:to|through)\s+)(?:([A-Za-z0-9_.-]+)#)?([0-9]+)(?![^\s,;])"
)

# Anything else that looks like a span of ids: `mai#3—mai#5`, `mai#3 — mai#5`,
# `mai#3 To mai#5`, a range glued to other text. The Worker does not read these
# as ranges, so they are never expanded.
RANGE_SHAPED = re.compile(
    r"[A-Za-z0-9_.-]+#[0-9]+\s*(?:-|–|—|−|‒|to|through)\s*(?:[A-Za-z0-9_.-]+#)?[0-9]+",
    re.IGNORECASE,
)


def bracket_groups(answer: str) -> list[str]:
    """The inside of every ``[...]`` the Worker would look at, in order."""
    return [m.group(1) for m in BRACKET_GROUP.finditer(answer)]


def _tokens(text: str) -> list[str]:
    return [token.strip() for token in TOKEN_SPLIT.split(text)]


def expand_range(match: re.Match) -> tuple[list[str], str]:
    """The ids a WORKER_RANGE match expands to, and why it is dropped ('' when it is not)."""
    file, start_text, end_file, end_text = match.groups()
    start, end = int(start_text), int(end_text)
    if end_file is not None and end_file != file:
        return [], "spans two files; the Worker drops it"
    if start > MAX_SAFE_INTEGER or end > MAX_SAFE_INTEGER:
        return [], "line number too large; the Worker drops it"
    if start >= end:
        return [], "the end is not after the start; the Worker drops it"
    if end - start > MAX_RANGE_LINES - 1:
        return [], f"{end - start + 1} lines; the Worker expands at most {MAX_RANGE_LINES} and drops it"
    return [f"{file}#{line}" for line in range(start, end + 1)], ""


def _split_group(group: str) -> list[str | re.Match]:
    """One bracket as the Worker reads it: the text between ranges (str) and the ranges (WORKER_RANGE matches), in order."""
    parts: list[str | re.Match] = []
    rest = 0
    for match in WORKER_RANGE.finditer(group):
        parts.extend([group[rest:match.start()], match])
        rest = match.end()
    parts.append(group[rest:])
    return parts


def bracket_ids(group: str) -> list[str]:
    """Port of ``idsInBracket``: every token in one bracket, in order, ranges replaced by their expansion."""
    ids: list[str] = []
    for part in _split_group(group):
        ids.extend(_tokens(part) if isinstance(part, str) else expand_range(part)[0])
    return ids


def extract_citations(answer: str, known_ids: Iterable[str]) -> list[str]:
    """Exactly what the Worker returns as ``citations``: ids that exist, in order, deduplicated."""
    known = set(known_ids)
    found: list[str] = []
    seen: set[str] = set()
    for group in bracket_groups(answer):
        for line_id in bracket_ids(group):
            if not LINE_ID.match(line_id) or line_id not in known or line_id in seen:
                continue
            seen.add(line_id)
            found.append(line_id)
    return found


def unexpanded_ranges(answer: str) -> list[tuple[str, str]]:
    """Every range inside a citation bracket that the Worker does not expand: (the range as written, why)."""
    found: list[tuple[str, str]] = []
    for group in bracket_groups(answer):
        for part in _split_group(group):
            if isinstance(part, str):
                found.extend((m.group(0), "not a range form the Worker reads") for m in RANGE_SHAPED.finditer(part))
                continue
            ids, reason = expand_range(part)
            if not ids:
                found.append((part.group(0), reason))
    return found


def unknown_citations(answer: str, known_ids: Iterable[str]) -> list[str]:
    """Cited ids that are not a line of the material (the Worker drops them).

    Id-shaped tokens, plus the ids of every range the Worker expands. The ends of
    a range the Worker drops whole are not counted here; ``unexpanded_ranges``
    reports that range.
    """
    known = set(known_ids)
    unknown: list[str] = []
    for group in bracket_groups(answer):
        for part in _split_group(group):
            candidates = [t for t in _tokens(part) if ID_SHAPED.match(t)] if isinstance(part, str) else expand_range(part)[0]
            for line_id in candidates:
                if line_id not in known and line_id not in unknown:
                    unknown.append(line_id)
    return unknown


# -- cost -----------------------------------------------------------------------------


def cost_usd(model: str, usage: dict) -> float | None:
    """Same formula as ``costUsd`` in worker/src/model.ts. None when the model has no price."""
    price = PRICES_USD_PER_MTOK.get(model)
    if price is None:
        return None
    return (
        usage.get("input_tokens", 0) * price["input"]
        + usage.get("cache_creation_input_tokens", 0) * price["cache_write"]
        + usage.get("cache_read_input_tokens", 0) * price["cache_read"]
        + usage.get("output_tokens", 0) * price["output"]
    ) / 1_000_000


# -- questions, forbidden list, runs ---------------------------------------------


def load_questions(path: Path = QUESTIONS_PATH) -> list[dict]:
    """Read ``questions.jsonl`` and validate the shape of every line. Missing file -> []."""
    if not path.exists():
        return []
    questions: list[dict] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise EvalError(f"{path}:{lineno}: invalid JSON: {exc}") from exc
            if not isinstance(item, dict):
                raise EvalError(f"{path}:{lineno}: not an object")
            missing = REQUIRED_QUESTION_FIELDS - item.keys()
            if missing:
                raise EvalError(f"{path}:{lineno}: missing fields {sorted(missing)}")
            if item["kind"] not in KINDS:
                raise EvalError(f"{path}:{lineno}: unknown kind {item['kind']!r}")
            if not isinstance(item["id"], str) or not item["id"]:
                raise EvalError(f"{path}:{lineno}: id must be a non-empty string")
            if item["id"] in seen:
                raise EvalError(f"{path}:{lineno}: duplicate id {item['id']!r}")
            if not isinstance(item["question"], str) or not item["question"].strip():
                raise EvalError(f"{path}:{lineno}: question must be a non-empty string")
            if not isinstance(item["expect"], dict):
                raise EvalError(f"{path}:{lineno}: expect must be an object")
            seen.add(item["id"])
            questions.append(item)
    return questions


def load_forbidden(path: Path = FORBIDDEN_PATH) -> list[str]:
    """Strings that must not appear in an out_of_scope answer: one per line, as written, blank lines skipped."""
    if not path.exists():
        return []
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def read_jsonl(path: Path) -> list[dict]:
    records: list[dict] = []
    with path.open(encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise EvalError(f"{path}:{lineno}: invalid JSON: {exc}") from exc
            if not isinstance(item, dict):
                raise EvalError(f"{path}:{lineno}: not an object")
            records.append(item)
    return records


def write_jsonl(path: Path, records: Iterable[dict]) -> None:
    """Write atomically: ``<path>.tmp`` then rename (``evals/runs/*.tmp`` is gitignored)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def latest_run(runs_dir: Path = RUNS_DIR) -> Path | None:
    """The newest ``*.jsonl`` under ``evals/runs/`` by filename (they start with the date), or None."""
    runs = sorted(p for p in runs_dir.glob("*.jsonl") if p.is_file())
    return runs[-1] if runs else None


# -- misc -------------------------------------------------------------------------------


def short_sha256(text: str, length: int = SHORT_HASH_LENGTH) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:length]


def first_heading(text: str) -> str:
    """The first markdown heading line without its hashes, e.g. ``System prompt v0.1``; '' if none."""
    for line in text.splitlines():
        if line.startswith("#"):
            return line.lstrip("#").strip()
    return ""


def git_short_sha(repo: Path = REPO_ROOT) -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"], cwd=repo, capture_output=True, text=True, check=True
        )
        return out.stdout.strip() or "nogit"
    except (OSError, subprocess.CalledProcessError):
        return "nogit"


def git_dirty(repo: Path = REPO_ROOT) -> bool | None:
    """True if tracked files have uncommitted changes, None if git is unavailable."""
    try:
        out = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo, capture_output=True, text=True, check=True
        )
        return bool(out.stdout.strip())
    except (OSError, subprocess.CalledProcessError):
        return None


def api_key() -> str:
    """The Anthropic API key from CVBOT_API_KEY (ANTHROPIC_API_KEY as a local fallback).

    Read with os.environ only. Never printed, logged or written anywhere (CLAUDE.md).
    """
    key = os.environ.get("CVBOT_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise EvalError("no API key: set the environment variable CVBOT_API_KEY")
    return key


def fmt_usd(amount: float | None) -> str:
    return "n/a" if amount is None else f"${amount:.4f}"
