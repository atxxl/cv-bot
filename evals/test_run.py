#!/usr/bin/env python3
"""Tests for the parts of evals/run.py that need no model: naming, selection,
record assembly, and the Worker client against a local fake Worker.

No network beyond 127.0.0.1, no key, made-up material and questions only.
"""

from __future__ import annotations

import contextlib
import io
import json
import threading
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import common
import run
from common import Material, MaterialLine

MATERIAL = Material(lines=(MaterialLine("sample#1", "# Sample"), MaterialLine("sample#2", "Built a widget.")), hash="0123456789ab")
QUESTIONS = [
    {"id": "g1", "kind": "grounded", "question": "q1", "expect": {"cite_prefix": "sample"}},
    {"id": "n1", "kind": "not_done", "question": "q2", "expect": {"negative": True}},
    {"id": "i1", "kind": "injection", "question": "q3", "expect": {"marker": "X-1"}},
]


class NamingAndSelectionTest(unittest.TestCase):
    def test_default_run_path(self) -> None:
        now = datetime(2026, 10, 30, 23, 59, tzinfo=timezone.utc)
        self.assertEqual(run.default_run_path(Path("/r"), now, "abc1234"), Path("/r/2026-10-30-abc1234.jsonl"))

    def test_select_by_ids_and_limit(self) -> None:
        self.assertEqual([q["id"] for q in run.select_questions(QUESTIONS, ["i1", "g1"], None)], ["g1", "i1"])
        self.assertEqual([q["id"] for q in run.select_questions(QUESTIONS, None, 2)], ["g1", "n1"])
        with self.assertRaises(common.EvalError):
            run.select_questions(QUESTIONS, ["nope"], None)


class RecordTest(unittest.TestCase):
    META = {"model": "m", "mode": "direct", "material_hash": "0123456789ab", "system_prompt_sha": "s", "system_prompt_title": "t", "git_sha": "g", "git_dirty": False, "run_at": "now"}

    def test_direct_record_extracts_citations_like_the_worker(self) -> None:
        fields = {"answer": "A widget [sample#2] [sample#9].", "citations": None, "refused": False, "error": None, "stop_reason": "end_turn", "usage": {"input_tokens": 1}, "cost_usd": 0.001, "latency_ms": 5}
        record = run.make_record(QUESTIONS[0], fields, MATERIAL, self.META)
        self.assertEqual(record["citations"], ["sample#2"])
        self.assertEqual(record["id"], "g1")
        self.assertEqual(record["material_hash"], "0123456789ab")
        self.assertFalse(record["refused"])

    def test_worker_record_keeps_the_workers_citations_and_hash(self) -> None:
        fields = {"answer": "A widget [sample#2].", "citations": ["sample#2"], "refused": False, "error": None, "latency_ms": 5, "worker_status": 200, "material_hash": "ffffffffffff"}
        record = run.make_record(QUESTIONS[0], fields, MATERIAL, self.META)
        self.assertEqual(record["material_hash"], "ffffffffffff")
        self.assertEqual(record["worker_status"], 200)
        self.assertIsNone(record["usage"])


class FakeWorker(BaseHTTPRequestHandler):
    """Answers /ask like the Worker: 429 with retry-after once, then 200; /refuse answers 503."""

    responses: list[tuple[int, dict, dict]] = []
    seen: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        FakeWorker.seen.append(json.loads(self.rfile.read(length)))
        status, headers, body = FakeWorker.responses.pop(0)
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args) -> None:
        pass


class WorkerAnswererTest(unittest.TestCase):
    def setUp(self) -> None:
        FakeWorker.responses = []
        FakeWorker.seen = []
        self.server = HTTPServer(("127.0.0.1", 0), FakeWorker)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.sleeps: list[int] = []

    def answerer(self) -> run.WorkerAnswerer:
        return run.WorkerAnswerer(self.base, timeout=5, sleep=self.sleeps.append)

    def test_answer_after_a_rate_limit(self) -> None:
        FakeWorker.responses = [
            (429, {"retry-after": "7"}, {"answer": "Please wait.", "citations": [], "refused": True, "material_hash": "h"}),
            (200, {}, {"answer": "A widget [sample#2].", "citations": ["sample#2"], "refused": False, "material_hash": "h"}),
        ]
        with contextlib.redirect_stdout(io.StringIO()):  # the "waiting 7s" progress line
            fields = self.answerer().ask("what?")
        self.assertEqual(self.sleeps, [7])
        self.assertEqual(FakeWorker.seen, [{"question": "what?"}, {"question": "what?"}])
        self.assertEqual(fields["answer"], "A widget [sample#2].")
        self.assertEqual(fields["citations"], ["sample#2"])
        self.assertFalse(fields["refused"])
        self.assertIsNone(fields["error"])
        self.assertEqual(fields["worker_status"], 200)
        self.assertEqual(fields["material_hash"], "h")

    def test_worker_refusal_is_recorded_as_no_answer(self) -> None:
        FakeWorker.responses = [(503, {}, {"answer": "Not available right now.", "citations": [], "refused": True, "material_hash": "h"})]
        fields = self.answerer().ask("what?")
        self.assertTrue(fields["refused"])
        self.assertEqual(fields["error"], "worker refused (status 503)")
        self.assertEqual(fields["answer"], "Not available right now.")

    def test_non_json_body_is_an_error(self) -> None:
        class Broken(FakeWorker):
            def do_POST(self) -> None:  # noqa: N802
                self.send_response(200)
                self.send_header("content-length", "3")
                self.end_headers()
                self.wfile.write(b"nop")

        self.server.RequestHandlerClass = Broken
        fields = self.answerer().ask("what?")
        self.assertTrue(fields["refused"])
        self.assertIn("non-JSON", fields["error"])

    def test_unreachable_worker_is_an_error(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        fields = run.WorkerAnswerer(self.base, timeout=2, sleep=self.sleeps.append).ask("what?")
        self.assertTrue(fields["refused"])
        self.assertTrue(fields["error"].startswith("network_error"))


if __name__ == "__main__":
    unittest.main()
