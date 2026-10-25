#!/usr/bin/env python3
"""Static checks for the widget in ``web/``.

Run from the repository root (CI runs this together with the other
``scripts/test_*.py`` files):

    python -m unittest discover -s scripts -v

Standard library only. The checks read ``web/widget.js``, ``web/widget.css``
and ``web/demo.html`` as text; nothing is executed and ``material/`` is never
touched.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB = REPO_ROOT / "web"
JS = WEB / "widget.js"
CSS = WEB / "widget.css"
DEMO = WEB / "demo.html"

# widget.js + widget.css together, unminified, must stay under this (issue 4).
SIZE_LIMIT_BYTES = 12 * 1024  # 12 288

# None of these may appear in widget.js: no HTML interpretation of network
# data, no code evaluation, no cookies, no storage.
FORBIDDEN_IN_JS = (
    "innerHTML",
    "outerHTML",
    "insertAdjacentHTML",
    "document.write",
    "eval(",
    "new Function",
    "document.cookie",
    "localStorage",
    "sessionStorage",
)

FOOTER = "This assistant only knows what is in the approved CV material. It will say so when it does not know."
DEMO_WORKER_URL = "http://localhost:8787"
URL_RE = re.compile(r"https?://[^\s\"'<>()]+")
SCRIPT_SRC_RE = re.compile(r"<script\b[^>]*\bsrc=[\"']([^\"']+)[\"']", re.IGNORECASE)
LINK_RE = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
ATTR_RE = r"\b{}=[\"']([^\"']*)[\"']"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class WidgetFilesTest(unittest.TestCase):
    def test_the_three_files_exist(self) -> None:
        for path in (JS, CSS, DEMO):
            self.assertTrue(path.is_file(), f"missing {path.relative_to(REPO_ROOT)}")

    def test_js_plus_css_stay_under_12_kib_unminified(self) -> None:
        size = JS.stat().st_size + CSS.stat().st_size
        self.assertLess(size, SIZE_LIMIT_BYTES, f"widget.js + widget.css is {size} bytes, limit {SIZE_LIMIT_BYTES}")

    def test_files_are_utf8_without_carriage_returns(self) -> None:
        for path in (JS, CSS, DEMO):
            text = read(path)  # raises on invalid UTF-8
            self.assertNotIn("\r", text, f"{path.name} has CR line endings")


class WidgetJsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.js = read(JS)

    def test_no_html_injection_eval_cookies_or_storage(self) -> None:
        for needle in FORBIDDEN_IN_JS:
            self.assertNotIn(needle, self.js, f"widget.js must not contain {needle!r}")

    def test_no_absolute_urls_so_the_only_endpoints_come_from_the_mount(self) -> None:
        self.assertEqual(URL_RE.findall(self.js), [], "widget.js must not hard-code any http(s) URL")
        self.assertEqual(URL_RE.findall(read(CSS)), [], "widget.css must not reference any http(s) URL")
        self.assertNotIn("@import", read(CSS))

    def test_only_the_two_worker_endpoints_are_fetched(self) -> None:
        targets = re.findall(r"fetch\(\s*workerUrl \+ \"(/[a-z-]*)\"", self.js)
        self.assertEqual(sorted(set(targets)), ["/ask", "/material"])
        self.assertEqual(self.js.count("fetch("), len(targets), "every fetch( must target the Worker URL")

    def test_reads_the_worker_url_from_the_mount(self) -> None:
        self.assertIn('getElementById("cv-bot")', self.js)
        self.assertIn('getAttribute("data-worker-url")', self.js)

    def test_fixed_footer_line(self) -> None:
        self.assertIn(FOOTER, self.js)

    def test_answer_area_is_a_polite_live_region(self) -> None:
        self.assertRegex(self.js, r'setAttribute\(\s*"aria-live",\s*"polite"\s*\)')

    def test_not_available_fallback_and_limit_match_the_worker(self) -> None:
        self.assertIn('"Not available right now."', self.js)
        self.assertIn("MAX_CHARS = 500", self.js)


class DemoPageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.html = read(DEMO)

    def test_references_no_url_other_than_the_local_worker(self) -> None:
        for url in URL_RE.findall(self.html):
            self.assertTrue(
                url == DEMO_WORKER_URL or url.startswith(DEMO_WORKER_URL + "/"),
                f"demo.html references {url}; only {DEMO_WORKER_URL} is allowed",
            )

    def test_mounts_the_widget_against_the_local_worker(self) -> None:
        self.assertIn(f'<div id="cv-bot" data-worker-url="{DEMO_WORKER_URL}"></div>', self.html)

    def test_loads_only_the_widget_script_and_stylesheet(self) -> None:
        self.assertEqual(SCRIPT_SRC_RE.findall(self.html), ["widget.js"])
        stylesheets = []
        for tag in LINK_RE.findall(self.html):
            rel = re.search(ATTR_RE.format("rel"), tag, re.IGNORECASE)
            href = re.search(ATTR_RE.format("href"), tag, re.IGNORECASE)
            self.assertIsNotNone(href, f"link without href: {tag}")
            if rel and rel.group(1).lower() == "stylesheet":
                stylesheets.append(href.group(1))
            else:
                # Anything else (the empty data: favicon) must not fetch from the network.
                self.assertFalse(URL_RE.match(href.group(1)), f"link fetches from the network: {tag}")
        self.assertEqual(stylesheets, ["widget.css"])
        self.assertNotIn("<iframe", self.html.lower())
        self.assertNotIn("@import", self.html)

    def test_basic_document_structure_for_accessibility(self) -> None:
        self.assertIn('<html lang="en">', self.html)
        self.assertIn('<meta charset="utf-8">', self.html)
        self.assertRegex(self.html, r'<meta name="viewport" content="width=device-width')
        self.assertRegex(self.html, r"<title>[^<]+</title>")


if __name__ == "__main__":
    unittest.main()
