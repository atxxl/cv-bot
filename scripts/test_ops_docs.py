#!/usr/bin/env python3
"""Static checks for the operations docs: ``web/embed.md``, ``docs/runbook.md``
and the KV commands in ``docs/setup.md`` and ``web/README.md``.

Run from the repository root (CI runs this together with the other
``scripts/test_*.py`` files):

    python -m unittest discover -s scripts -v

Standard library only. Nothing is executed; the files are read as text.

What is checked:

- The snippet in ``web/embed.md`` is exactly the three lines the widget needs,
  pointing at the Worker routes that serve the widget, with placeholders only
  (no real Worker hostname in the repository).
- Every ``wrangler kv key`` command in the docs targets the deployed namespace
  (``--remote --preview false``). Without ``--remote`` wrangler 4 writes to
  local dev storage, so a kill switch typed from the docs would silently do
  nothing in production.
- No API key prefix appears anywhere in these docs.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EMBED = REPO_ROOT / "web" / "embed.md"
WEB_README = REPO_ROOT / "web" / "README.md"
RUNBOOK = REPO_ROOT / "docs" / "runbook.md"
SETUP = REPO_ROOT / "docs" / "setup.md"
ASSETS_TS = REPO_ROOT / "worker" / "src" / "assets.ts"
WORKER_TS = REPO_ROOT / "worker" / "src" / "worker.ts"

OPS_DOCS = (EMBED, WEB_README, RUNBOOK, SETUP)

WORKER_URL = "https://<your-worker>.workers.dev"
HTML_BLOCK_RE = re.compile(r"```html\n(.*?)```", re.DOTALL)
KV_COMMAND_RE = re.compile(r"npx wrangler kv key [^`\n]*")
WORKERS_DEV_RE = re.compile(r"[^\s/\"'`(]*\.workers\.dev")
# Built from two halves so this file does not itself match the pre-commit
# secret grep in CLAUDE.md.
KEY_PREFIX = "sk-" + "ant-"
ATTR_RE = r"\b{}=\"([^\"]*)\""


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def attr(tag: str, name: str) -> str | None:
    match = re.search(ATTR_RE.format(name), tag)
    return match.group(1) if match else None


class EmbedSnippetTest(unittest.TestCase):
    def setUp(self) -> None:
        blocks = HTML_BLOCK_RE.findall(read(EMBED))
        self.assertEqual(len(blocks), 1, "web/embed.md must contain exactly one ```html block: the snippet")
        self.lines = [line.strip() for line in blocks[0].strip().splitlines()]

    def test_is_the_three_lines(self) -> None:
        self.assertEqual(len(self.lines), 3, self.lines)
        self.assertTrue(self.lines[0].startswith("<link "))
        self.assertTrue(self.lines[1].startswith("<div "))
        self.assertTrue(self.lines[2].startswith("<script "))

    def test_mount_points_at_the_worker_placeholder(self) -> None:
        div = self.lines[1]
        self.assertEqual(attr(div, "id"), "cv-bot")
        self.assertEqual(attr(div, "data-worker-url"), WORKER_URL)
        self.assertTrue(div.endswith("></div>"))

    def test_loads_the_widget_from_the_worker_routes(self) -> None:
        link, script = self.lines[0], self.lines[2]
        self.assertEqual(attr(link, "rel"), "stylesheet")
        self.assertEqual(attr(link, "href"), f"{WORKER_URL}/widget.css?v=<version>")
        self.assertEqual(attr(script, "src"), f"{WORKER_URL}/widget.js?v=<version>")
        self.assertRegex(script, r"\sdefer[\s>]")
        self.assertTrue(script.endswith("</script>"))

    def test_routes_exist_in_the_worker(self) -> None:
        worker = read(WORKER_TS)
        assets = read(ASSETS_TS)
        for route in ("/widget.js", "/widget.css"):
            self.assertIn(f'"{route}"', worker, f"{route} is not a route in worker/src/worker.ts")
            self.assertIn(f'"{route}"', assets, f"{route} has no content type in worker/src/assets.ts")

    def test_web_readme_shows_the_same_snippet(self) -> None:
        blocks = HTML_BLOCK_RE.findall(read(WEB_README))
        self.assertEqual(len(blocks), 1)
        self.assertEqual([line.strip() for line in blocks[0].strip().splitlines()], self.lines)


class KvCommandsTest(unittest.TestCase):
    def test_every_kv_command_targets_the_deployed_namespace(self) -> None:
        seen = 0
        for path in OPS_DOCS:
            for command in KV_COMMAND_RE.findall(read(path)):
                seen += 1
                with self.subTest(file=path.name, command=command):
                    self.assertIn("--remote", command)
                    self.assertIn("--preview false", command)
        self.assertGreater(seen, 10, "expected the runbook and setup docs to contain kv commands")

    def test_runbook_documents_the_kill_switch_both_ways(self) -> None:
        runbook = read(RUNBOOK)
        self.assertIn("npx wrangler kv key put --remote --preview false --binding SPEND enabled false", runbook)
        self.assertIn("npx wrangler kv key put --remote --preview false --binding SPEND enabled 1", runbook)

    def test_runbook_covers_the_four_tasks_of_issue_7(self) -> None:
        headings = re.findall(r"^## (.+)$", read(RUNBOOK), re.MULTILINE)
        for expected in ("Take the widget offline (kill switch)", "Rotate the API key", "Raise or lower the spend cap", "Read the logs"):
            self.assertIn(expected, headings)


class NoSecretsTest(unittest.TestCase):
    def test_no_api_key_prefix(self) -> None:
        for path in OPS_DOCS:
            self.assertFalse(KEY_PREFIX in read(path), f"{path.name} contains an API key prefix")

    def test_only_the_placeholder_worker_hostname(self) -> None:
        for path in OPS_DOCS:
            for host in WORKERS_DEV_RE.findall(read(path)):
                with self.subTest(file=path.name):
                    self.assertEqual(host, "<your-worker>.workers.dev")


if __name__ == "__main__":
    unittest.main()
