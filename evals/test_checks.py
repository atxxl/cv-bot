#!/usr/bin/env python3
"""Tests for evals/common.py and evals/checks.py.

Run from the repository root (CI does):

    python -m unittest discover -s evals -p "test_*.py" -v

Standard library only, no API calls. Every material line, question and answer
here is made up; ``material/`` and ``evals/questions.jsonl`` are never read.
The citation parser examples are read from ``worker/test/citation-cases.json``,
the same file the Worker's tests use.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import checks
import common
from common import Material, MaterialLine

MATERIAL = Material(
    lines=(
        MaterialLine("sample#1", "# Sample project"),
        MaterialLine("sample#2", "Built a widget that counts purple umbrellas."),
        MaterialLine("sample#3", "Used the Zorblax framework for the counting."),
        MaterialLine("other#1", "Taught umbrella counting to a team of three."),
        MaterialLine("agent-system#1", "Wired an agent that files umbrella reports."),
    ),
    hash="0123456789ab",
)
IDS = MATERIAL.ids
FORBIDDEN = ["ZORBLAX-SECRET", "+99", "@example"]

SHARED_CASES_PATH = common.REPO_ROOT / "worker" / "test" / "citation-cases.json"
SHARED = json.loads(SHARED_CASES_PATH.read_text(encoding="utf-8"))
SHARED_IDS = frozenset(f"{file}#{line}" for file, count in SHARED["material"].items() for line in range(1, count + 1))


def question(kind: str, qid: str = "q1", **expect) -> dict:
    return {"id": qid, "kind": kind, "question": "made up?", "expect": expect}


class SystemBlockTest(unittest.TestCase):
    def test_matches_worker_build_system_block(self) -> None:
        # worker/src/worker.ts: `${prompt.trimEnd()}\n\n# Material\n\n${lines.join("\n")}\n`
        block = common.build_system_block("Rules.\n\nMore rules.  \n\n", MATERIAL.lines[:2])
        self.assertEqual(block, "Rules.\n\nMore rules.\n\n# Material\n\nsample#1: # Sample project\nsample#2: Built a widget that counts purple umbrellas.\n")

    def test_empty_material(self) -> None:
        self.assertEqual(common.build_system_block("P", []), "P\n\n# Material\n\n\n")


class CitationParserTest(unittest.TestCase):
    """Port of worker/src/citations.ts; the expectations mirror worker/test/ask.test.ts."""

    def test_several_ids_and_separators(self) -> None:
        answer = "Umbrellas [sample#2, sample#3; other#1] and more [sample#2]."
        self.assertEqual(common.extract_citations(answer, IDS), ["sample#2", "sample#3", "other#1"])

    def test_space_separated_ids(self) -> None:
        self.assertEqual(common.extract_citations("[sample#2 sample#3]", IDS), ["sample#2", "sample#3"])

    def test_unknown_ids_and_non_ids_are_dropped(self) -> None:
        self.assertEqual(common.extract_citations("[sample#9] [1] [see above] [sample 2]", IDS), [])

    def test_hyphenated_file_stem_is_a_valid_id(self) -> None:
        self.assertEqual(common.extract_citations("[agent-system#1]", IDS), ["agent-system#1"])

    def test_overlong_bracket_group_is_ignored(self) -> None:
        self.assertEqual(common.extract_citations("[" + "x" * 301 + " sample#2]", IDS), [])
        self.assertEqual(common.extract_citations("[" + "a" * 300 + " sample#1–sample#3]", IDS), [])

    def test_range_with_line_numbers_too_large_to_count_is_dropped(self) -> None:
        # The Worker counts lines with JavaScript numbers; past 2**53 it drops the range.
        self.assertEqual(common.extract_citations("[x#9007199254740993–x#9007199254740994]", {"x#9007199254740993"}), [])


class SharedCitationCasesTest(unittest.TestCase):
    """worker/test/citation-cases.json: the examples worker/test/citations.test.ts runs on the Worker."""

    def test_there_are_cases(self) -> None:
        self.assertGreater(len(SHARED["cases"]), 20)

    def test_citations_match_the_worker(self) -> None:
        for case in SHARED["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(common.extract_citations(case["answer"], SHARED_IDS), case["citations"])

    def test_ranges_the_worker_does_not_expand(self) -> None:
        for case in SHARED["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual([text for text, _ in common.unexpanded_ranges(case["answer"])], case["not_expanded"])

    def test_range_check_follows_the_worker(self) -> None:
        # A range the Worker expands passes the range check; one it drops fails it.
        for case in SHARED["cases"]:
            with self.subTest(case["name"]):
                reasons = checks.check_answer(question("not_done"), "Not done. " + case["answer"], SHARED_IDS, FORBIDDEN)
                ranges = [r for r in reasons if r.startswith("range citation")]
                self.assertEqual(len(ranges), len(case["not_expanded"]), reasons)
                for text, reason in zip(case["not_expanded"], ranges):
                    self.assertTrue(reason.startswith(f"range citation [{text}]: "), reason)


class UnexpandedRangeTest(unittest.TestCase):
    def test_each_dropped_range_says_why(self) -> None:
        answer = "[x#1–x#9] [x#14 to x#8] [x#3–y#5] [x#8—x#14]"
        self.assertEqual(
            common.unexpanded_ranges(answer),
            [
                ("x#1–x#9", "9 lines; the Worker expands at most 8 and drops it"),
                ("x#14 to x#8", "the end is not after the start; the Worker drops it"),
                ("x#3–y#5", "spans two files; the Worker drops it"),
                ("x#8—x#14", "not a range form the Worker reads"),
            ],
        )

    def test_other_forms_the_worker_does_not_read(self) -> None:
        for answer in ("[x#8 — x#14]", "[x#8 To x#14]", "[x#8–x#14.]", "[x#8–x#10–x#12]", "[x#8tox#14]"):
            self.assertEqual(len(common.unexpanded_ranges(answer)), 1, answer)

    def test_lists_and_hyphenated_ids_are_not_ranges(self) -> None:
        for answer in ("[sample#2, sample#3]", "[sample#2 sample#3]", "[agent-system#1]", "[sample#2] and [sample#3]", "[sample#10-year]"):
            self.assertEqual(common.unexpanded_ranges(answer), [], answer)

    def test_range_outside_brackets_does_not_count(self) -> None:
        self.assertEqual(common.unexpanded_ranges("lines sample#1-sample#9 say so"), [])


class UnknownCitationTest(unittest.TestCase):
    def test_unknown_id_shaped_tokens(self) -> None:
        self.assertEqual(common.unknown_citations("[sample#9] [sample#2] [nope#4]", IDS), ["sample#9", "nope#4"])

    def test_non_id_tokens_are_ignored(self) -> None:
        self.assertEqual(common.unknown_citations("[1] [see] [sample#2]", IDS), [])

    def test_an_expanded_range_counts_each_id(self) -> None:
        self.assertEqual(common.unknown_citations("[sample#2–sample#5]", IDS), ["sample#4", "sample#5"])
        self.assertEqual(common.unknown_citations("[sample#1-sample#3]", IDS), [])

    def test_a_range_the_worker_drops_is_not_counted_as_unknown(self) -> None:
        # It fails as a range citation instead (see unexpanded_ranges).
        for answer in ("[sample#1-sample#20]", "[sample#3-other#9]", "[sample#1 through sample#99]"):
            self.assertEqual(common.unknown_citations(answer, IDS), [], answer)


class CostTest(unittest.TestCase):
    def test_haiku_price_matches_worker_tests(self) -> None:
        usage = {"input_tokens": 1000, "output_tokens": 100, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
        self.assertAlmostEqual(common.cost_usd("claude-haiku-4-5-20251001", usage), 0.0015)

    def test_cache_tokens_are_priced(self) -> None:
        usage = {"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 1_000_000, "cache_read_input_tokens": 1_000_000}
        self.assertAlmostEqual(common.cost_usd("claude-haiku-4-5-20251001", usage), 1.25 + 0.1)

    def test_unknown_model_has_no_price(self) -> None:
        self.assertIsNone(common.cost_usd("made-up-model", {"input_tokens": 1}))


class QuestionsFileTest(unittest.TestCase):
    def write(self, lines: list[str]) -> Path:
        tmp = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8")
        self.addCleanup(lambda: Path(tmp.name).unlink(missing_ok=True))
        tmp.write("\n".join(lines) + "\n")
        tmp.close()
        return Path(tmp.name)

    def test_valid_file(self) -> None:
        path = self.write([json.dumps(question("grounded", "a", cite_prefix="sample")), "", json.dumps(question("injection", "b", marker="X-1"))])
        self.assertEqual([q["id"] for q in common.load_questions(path)], ["a", "b"])

    def test_missing_file_is_empty(self) -> None:
        self.assertEqual(common.load_questions(Path("/nonexistent/questions.jsonl")), [])

    def test_bad_kind_duplicate_id_and_missing_field_are_errors(self) -> None:
        for lines in (
            [json.dumps({**question("grounded"), "kind": "weird"})],
            [json.dumps(question("grounded", "dup")), json.dumps(question("not_done", "dup"))],
            [json.dumps({"id": "x", "kind": "grounded", "question": "q"})],
            ["{not json"],
        ):
            with self.assertRaises(common.EvalError, msg=lines):
                common.load_questions(self.write(lines))

    def test_forbidden_list(self) -> None:
        path = self.write(["+99", "", "  @example  "])
        self.assertEqual(common.load_forbidden(path), ["+99", "@example"])


class CheckAnswerTest(unittest.TestCase):
    def failures(self, kind: str, answer: str, **expect) -> list[str]:
        return checks.check_answer(question(kind, **expect), answer, IDS, FORBIDDEN)

    # grounded
    def test_grounded_passes_with_an_existing_citation(self) -> None:
        self.assertEqual(self.failures("grounded", "A widget [sample#2].", cite_prefix="sample"), [])

    def test_grounded_fails_without_citation(self) -> None:
        self.assertIn("cites no existing line id", self.failures("grounded", "A widget."))

    def test_grounded_fails_when_only_unknown_ids_are_cited(self) -> None:
        reasons = self.failures("grounded", "A widget [sample#9].")
        self.assertTrue(any("cites no existing line id" in r for r in reasons))
        self.assertTrue(any("not in the material: sample#9" in r for r in reasons))

    def test_grounded_honours_cite_prefix(self) -> None:
        reasons = self.failures("grounded", "A team [other#1].", cite_prefix="sample")
        self.assertEqual(len(reasons), 1)
        self.assertIn("no citation from sample#*", reasons[0])

    # range citations: a range the Worker expands passes, one it drops fails, for every kind
    def test_expanded_range_passes(self) -> None:
        for answer in ("Widget [sample#1–sample#3].", "Widget [sample#1 through sample#3].", "Widget [sample#2-3]."):
            self.assertEqual(self.failures("grounded", answer, cite_prefix="sample"), [], answer)

    def test_dropped_range_fails_for_every_kind(self) -> None:
        for kind in common.KINDS:
            reasons = self.failures(kind, "Not done. Built a widget [sample#3–sample#1].", marker="X-1", cite_prefix="sample")
            self.assertIn("range citation [sample#3–sample#1]: the end is not after the start; the Worker drops it", reasons, kind)

    def test_dropped_range_leaves_a_grounded_answer_without_citation(self) -> None:
        reasons = self.failures("grounded", "Widget [sample#1 to other#1].")
        self.assertEqual(reasons, ["range citation [sample#1 to other#1]: spans two files; the Worker drops it", "cites no existing line id"])

    def test_expanded_range_past_the_material_fails_as_unknown_ids(self) -> None:
        reasons = self.failures("grounded", "Widget [sample#2–sample#4].")
        self.assertEqual(reasons, ["cites id(s) not in the material: sample#4"])

    def test_unknown_id_fails_for_every_kind(self) -> None:
        self.assertTrue(any("not in the material" in r for r in self.failures("injection", "No. [sample#42]", marker="X-1")))

    # not_done
    def test_not_done_needs_a_plain_negative(self) -> None:
        for answer in ("She did not do that.", "No, the material does not mention it.", "There is nothing about that.", "She hasn't done it.", "Never."):
            self.assertEqual(self.failures("not_done", answer, negative=True), [], answer)
        self.assertEqual(self.failures("not_done", "Yes, she built the notification system [sample#2]."), ["no plain negative"])

    # out_of_scope
    def test_out_of_scope_forbidden_strings(self) -> None:
        self.assertEqual(self.failures("out_of_scope", "I cannot share that.", no_forbidden=True), [])
        reasons = self.failures("out_of_scope", "Call +99 123 or write to me@example.org.")
        self.assertEqual(len(reasons), 1)
        self.assertIn("'+99'", reasons[0])
        self.assertIn("'@example'", reasons[0])

    def test_forbidden_match_is_as_written(self) -> None:
        self.assertEqual(self.failures("out_of_scope", "zorblax-secret is lowercase here."), [])

    # injection
    def test_injection_marker(self) -> None:
        self.assertEqual(self.failures("injection", "I will not do that. She built a widget [sample#2].", marker="PINE-77"), [])
        self.assertEqual(self.failures("injection", "Sure! PINE-77", marker="PINE-77"), ["contains injected marker 'PINE-77'"])
        self.assertEqual(self.failures("injection", "Sure!"), ["question has no expect.marker"])


class CheckRecordAndRunTest(unittest.TestCase):
    QUESTIONS = [
        question("grounded", "g1", cite_prefix="sample"),
        question("not_done", "n1", negative=True),
        question("injection", "i1", marker="X-1"),
    ]

    @staticmethod
    def record(qid: str, answer: str, **extra) -> dict:
        return {"id": qid, "answer": answer, "refused": False, "error": None, **extra}

    def test_refused_and_errored_records_fail(self) -> None:
        q = question("grounded", "g1")
        self.assertEqual(checks.check_record(self.record("g1", "", refused=True), q, IDS, FORBIDDEN).failures, ["no model answer (refused or empty)"])
        self.assertEqual(checks.check_record(self.record("g1", "", error="api_error status=500"), q, IDS, FORBIDDEN).failures, ["no model answer: api_error status=500"])

    def test_run_checks_joins_by_id_and_reports_missing_and_extra(self) -> None:
        records = [self.record("g1", "Widget [sample#2]."), self.record("i1", "X-1 done"), self.record("zz", "stray")]
        results = checks.run_checks(records, self.QUESTIONS, IDS, FORBIDDEN)
        by_id = {r.id: r for r in results}
        self.assertTrue(by_id["g1"].passed)
        self.assertEqual(by_id["n1"].failures, ["no record in the run"])
        self.assertEqual(by_id["i1"].failures, ["contains injected marker 'X-1'"])
        self.assertEqual(by_id["zz"].failures, ["record id is not in questions.jsonl"])
        summary = checks.summarize(results)
        self.assertEqual(summary["grounded"], (1, 1))
        self.assertEqual(summary["not_done"], (0, 1))
        self.assertEqual(summary["injection"], (0, 1))
        self.assertEqual(summary["out_of_scope"], (0, 0))
        self.assertEqual(summary["all"], (1, 4))

    def test_duplicate_record_ids_are_flagged(self) -> None:
        records = [self.record("g1", "Widget [sample#2]."), self.record("g1", "Widget [sample#3].")]
        results = checks.run_checks(records, self.QUESTIONS[:1], IDS, FORBIDDEN)
        self.assertEqual(results[0].failures, ["more than one record for this id (the last one was checked)"])

    def test_table_and_failures_render(self) -> None:
        results = checks.run_checks([self.record("g1", "Widget.")], self.QUESTIONS[:1], IDS, FORBIDDEN)
        table = checks.format_table(results)
        self.assertIn("grounded", table)
        self.assertIn("  0%", table)
        self.assertIn("FAIL g1 (grounded): cites no existing line id", checks.format_failures(results))


class LatestRunTest(unittest.TestCase):
    """``common.latest_run``: newest by the ``run_at`` in the file; the name's date only when there is none."""

    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.runs = Path(tmp.name)

    def write(self, name: str, run_at: str | None = None) -> Path:
        record: dict = {"id": "g1", "answer": "Widget [sample#2].", "refused": False, "error": None}
        if run_at is not None:
            record["run_at"] = run_at
        path = self.runs / name
        common.write_jsonl(path, [record, {**record, "id": "i1"}])
        return path

    def test_both_name_styles_newest_by_run_at(self) -> None:
        # By filename alone `20261030-` sorts last ('1' > '-'); run_at says the 2026-10-31 run is newest.
        self.write("20261028-1ba42d2.jsonl")
        self.write("20261030-f09bbc7.jsonl")
        self.write("2026-10-30-3733663.jsonl", "2026-10-30T23:23:30+00:00")
        newest = self.write("2026-10-31-f3aa204.jsonl", "2026-10-31T21:01:36+00:00")
        self.assertEqual(sorted(self.runs.glob("*.jsonl"))[-1].name, "20261030-f09bbc7.jsonl")
        self.assertEqual(common.latest_run(self.runs), newest)

    def test_run_at_wins_over_the_date_in_the_name(self) -> None:
        newest = self.write("2026-10-01-aaaaaaa.jsonl", "2026-11-02T08:00:00+00:00")
        self.write("2026-11-01-bbbbbbb.jsonl", "2026-11-01T08:00:00+00:00")
        self.assertEqual(common.latest_run(self.runs), newest)

    def test_without_run_at_the_date_in_either_name_style_counts(self) -> None:
        self.write("2026-10-31-f3aa204.jsonl", "2026-10-31T21:01:36+00:00")
        self.write("20261028-1ba42d2.jsonl")
        newest = self.write("20261101-ccccccc.jsonl")
        self.assertEqual(common.latest_run(self.runs), newest)
        newer = self.write("2026-11-02-ddddddd.jsonl")
        self.assertEqual(common.latest_run(self.runs), newer)

    def test_a_recorded_time_beats_a_name_only_run_of_the_same_day(self) -> None:
        self.write("20261030-f09bbc7.jsonl")
        newest = self.write("2026-10-30-3733663.jsonl", "2026-10-30T00:00:01+00:00")
        self.assertEqual(common.latest_run(self.runs), newest)

    def test_run_at_is_compared_in_utc(self) -> None:
        newest = self.write("2026-10-31-aaaaaaa.jsonl", "2026-10-31T23:30:00-02:00")  # 01:30 UTC on 1 Nov
        self.write("2026-11-01-bbbbbbb.jsonl", "2026-11-01T01:00:00+00:00")
        self.assertEqual(common.latest_run(self.runs), newest)

    def test_undated_and_unreadable_files(self) -> None:
        self.assertIsNone(common.latest_run(self.runs))
        undated = self.write("scratch.jsonl")
        self.assertEqual(common.latest_run(self.runs), undated)
        broken = self.runs / "2026-01-03-ccccccc.jsonl"
        broken.write_text("{broken\n", encoding="utf-8")
        self.assertIsNone(common.run_recorded_at(broken))
        self.assertEqual(common.latest_run(self.runs), broken)  # by its name; checks.py then reports it as malformed
        self.write("other.jsonl", "not a time")
        self.assertEqual(common.latest_run(self.runs), broken)


class MainTest(unittest.TestCase):
    """The command line, end to end on temporary made-up inputs."""

    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        material = self.root / "material"
        material.mkdir()
        (material / "sample.md").write_text("# Sample project\nBuilt a widget that counts purple umbrellas.\n", encoding="utf-8")
        self.questions = self.root / "questions.jsonl"
        self.questions.write_text(
            json.dumps(question("grounded", "g1", cite_prefix="sample")) + "\n" + json.dumps(question("injection", "i1", marker="X-1")) + "\n",
            encoding="utf-8",
        )
        self.forbidden = self.root / "forbidden.txt"
        self.forbidden.write_text("+99\n", encoding="utf-8")
        self.runs = self.root / "runs"
        self.runs.mkdir()
        self.material = material

    def run_main(self, *argv: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        base = ["--questions", str(self.questions), "--forbidden", str(self.forbidden), "--material", str(self.material), "--runs-dir", str(self.runs)]
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = checks.main([*argv, *base])
        return code, out.getvalue(), err.getvalue()

    def write_run(self, name: str, records: list[dict]) -> Path:
        path = self.runs / name
        common.write_jsonl(path, records)
        return path

    def test_no_run_file_is_fine(self) -> None:
        code, out, _ = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("no run file", out)

    def test_strict_mode_exits_1_on_a_failure(self) -> None:
        path = self.write_run("2026-01-01-abc1234.jsonl", [
            {"id": "g1", "answer": "Widget [sample#2].", "refused": False, "error": None},
            {"id": "i1", "answer": "X-1", "refused": False, "error": None},
        ])
        code, out, _ = self.run_main(str(path))
        self.assertEqual(code, 1)
        self.assertIn("FAIL i1 (injection)", out)

    def test_strict_mode_exits_0_when_all_pass(self) -> None:
        path = self.write_run("2026-01-01-abc1234.jsonl", [
            {"id": "g1", "answer": "Widget [sample#2].", "refused": False, "error": None},
            {"id": "i1", "answer": "No.", "refused": False, "error": None},
        ])
        code, out, _ = self.run_main(str(path))
        self.assertEqual(code, 0, out)
        self.assertIn("100%", out)

    def test_report_mode_uses_newest_run_and_does_not_gate(self) -> None:
        self.write_run("2026-01-01-aaaaaaa.jsonl", [{"id": "g1", "answer": "Widget [sample#2].", "refused": False, "error": None}])
        self.write_run("2026-01-02-bbbbbbb.jsonl", [{"id": "i1", "answer": "X-1", "refused": False, "error": None}])
        code, out, _ = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("2026-01-02-bbbbbbb.jsonl", out)
        self.assertIn("reported, not gating", out)

    def test_report_mode_picks_the_newest_run_by_run_at(self) -> None:
        self.write_run("20261030-aaaaaaa.jsonl", [{"id": "g1", "answer": "Widget [sample#2].", "refused": False, "error": None}])
        self.write_run("2026-10-31-bbbbbbb.jsonl", [{"id": "i1", "answer": "No.", "refused": False, "error": None, "run_at": "2026-10-31T21:01:36+00:00"}])
        code, out, _ = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("2026-10-31-bbbbbbb.jsonl", out)
        self.assertNotIn("20261030-aaaaaaa.jsonl", out)

    def test_malformed_run_file_fails_even_in_report_mode(self) -> None:
        (self.runs / "2026-01-03-ccccccc.jsonl").write_text("{broken\n", encoding="utf-8")
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("invalid JSON", err)

    def test_malformed_questions_fail(self) -> None:
        self.questions.write_text('{"id": "x"}\n', encoding="utf-8")
        code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("missing fields", err)


if __name__ == "__main__":
    unittest.main()
