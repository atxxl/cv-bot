#!/usr/bin/env python3
"""Hard checks for cv-bot eval answers.

Skeleton (issue 1). It loads ``evals/questions.jsonl``, which may be empty,
validates the shape of each line, and exits 0. The actual checks per kind
(``grounded``, ``not_done``, ``out_of_scope``, ``injection``) land in
issue 5 together with ``run.py`` and ``judge.py``.

Usage:
    python evals/checks.py              # uses evals/questions.jsonl
    python evals/checks.py path.jsonl   # another questions file
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

KINDS = {"grounded", "not_done", "out_of_scope", "injection"}
REQUIRED_FIELDS = {"id", "kind", "question", "expect"}

HERE = Path(__file__).resolve().parent
DEFAULT_QUESTIONS = HERE / "questions.jsonl"


def load_questions(path: Path) -> list[dict]:
    """Read a JSONL file of questions. Missing or empty file -> []."""
    if not path.exists():
        return []
    questions: list[dict] = []
    with path.open(encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{lineno}: invalid JSON: {exc}") from exc
            missing = REQUIRED_FIELDS - item.keys()
            if missing:
                raise ValueError(f"{path}:{lineno}: missing fields {sorted(missing)}")
            if item["kind"] not in KINDS:
                raise ValueError(f"{path}:{lineno}: unknown kind {item['kind']!r}")
            questions.append(item)
    return questions


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else DEFAULT_QUESTIONS
    try:
        questions = load_questions(path)
    except ValueError as exc:
        print(f"checks: {exc}", file=sys.stderr)
        return 1

    by_kind = {kind: 0 for kind in sorted(KINDS)}
    for q in questions:
        by_kind[q["kind"]] += 1

    print(f"checks: loaded {len(questions)} question(s) from {path}")
    for kind, count in by_kind.items():
        print(f"  {kind}: {count}")
    print("checks: no answer checks implemented yet (issue 5); exit 0")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
