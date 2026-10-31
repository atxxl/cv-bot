#!/usr/bin/env python3
"""Tests for the parts of evals/judge.py that need no API: prompt assembly and verdict parsing.

Made-up material and answers only; no network, no key.
"""

from __future__ import annotations

import json
import unittest

import common
import judge
from common import Material, MaterialLine

MATERIAL = Material(
    lines=(
        MaterialLine("sample#1", "# Sample project"),
        MaterialLine("sample#2", "Built a widget that counts purple umbrellas."),
        MaterialLine("other#1", "Taught umbrella counting to a team of three."),
    ),
    hash="0123456789ab",
)


class JudgeInputTest(unittest.TestCase):
    def test_cited_lines_are_quoted_with_their_text(self) -> None:
        record = {"question": "What did they build?", "answer": "A widget [sample#2] for a team [other#1]."}
        text = judge.build_judge_input(record, MATERIAL)
        self.assertIn("## Question\nWhat did they build?", text)
        self.assertIn("## Answer\nA widget [sample#2] for a team [other#1].", text)
        self.assertIn("## Cited lines\nsample#2: Built a widget that counts purple umbrellas.\nother#1: Taught umbrella counting to a team of three.", text)
        self.assertNotIn("not in the material", text)
        self.assertNotIn("range", text)

    def test_no_citations(self) -> None:
        text = judge.build_judge_input({"question": "q", "answer": "Not done."}, MATERIAL)
        self.assertIn("The answer cites no line of the material.", text)

    def test_unknown_ids_and_ranges_are_listed_separately(self) -> None:
        text = judge.build_judge_input({"question": "q", "answer": "X [sample#9]. Y [sample#1–sample#2]."}, MATERIAL)
        self.assertIn("## Cited ids that are not in the material (they support nothing)\nsample#9", text)
        self.assertIn("## Citations written as a range (they cite nothing)\n[sample#1–sample#2]", text)

    def test_system_block_is_rubric_then_material(self) -> None:
        system = judge.build_judge_system("# Judge prompt vX\n\nRubric.\n", MATERIAL)
        self.assertTrue(system.startswith("# Judge prompt vX\n\nRubric.\n\n# Material\n\nsample#1: # Sample project\n"))
        self.assertTrue(system.endswith("other#1: Taught umbrella counting to a team of three.\n"))


class VerdictParsingTest(unittest.TestCase):
    GOOD = {"faithfulness": 2, "tone": 1, "citations": [{"id": "sample#2", "supports": True, "note": "says so"}], "unsupported_claims": [], "notes": "fine"}

    def test_valid_verdict(self) -> None:
        verdict = judge.parse_verdict(json.dumps(self.GOOD))
        self.assertEqual(verdict["faithfulness"], 2)
        self.assertEqual(verdict["tone"], 1)
        self.assertEqual(verdict["citations"][0]["id"], "sample#2")

    def test_out_of_range_and_missing_fields_are_errors(self) -> None:
        for bad in (
            {**self.GOOD, "faithfulness": 3},
            {**self.GOOD, "tone": 2},
            {**self.GOOD, "faithfulness": True},
            {k: v for k, v in self.GOOD.items() if k != "notes"},
            {**self.GOOD, "citations": "sample#2"},
        ):
            with self.assertRaises(common.EvalError, msg=bad):
                judge.parse_verdict(json.dumps(bad))
        with self.assertRaises(common.EvalError):
            judge.parse_verdict("not json")

    def test_schema_lists_every_required_field(self) -> None:
        self.assertEqual(set(judge.VERDICT_SCHEMA["required"]), set(self.GOOD))


class ReportTest(unittest.TestCase):
    def test_means_and_low_scores(self) -> None:
        records = [
            {"id": "g1", "kind": "grounded", "cost_usd": 0.004, "judge": {"model": "m", "prompt_title": "Judge prompt vX", "faithfulness": 2, "tone": 1, "cost_usd": 0.01, "notes": "ok"}},
            {"id": "g2", "kind": "grounded", "cost_usd": 0.004, "judge": {"model": "m", "prompt_title": "Judge prompt vX", "faithfulness": 1, "tone": 1, "cost_usd": 0.01, "notes": "one claim is  not cited"}},
            {"id": "n1", "kind": "not_done", "cost_usd": None, "judge": {"model": "m", "faithfulness": None, "tone": None, "error": "no model answer to judge"}},
        ]
        report = judge.format_report(common.RUNS_DIR / "x.jsonl", records)
        self.assertIn("2 of 3 record(s) judged by m", report)
        self.assertIn("grounded         2   1.50     1    1    0   1.00      $0.0040     $0.0100", report)
        self.assertIn("LOW g2 (grounded) faith=1 tone=1: one claim is not cited", report)
        self.assertIn("UNJUDGED n1 (not_done): no model answer to judge", report)


if __name__ == "__main__":
    unittest.main()
