#!/usr/bin/env python3
"""Tests for scripts/bundle_material.py.

Run from the repository root:

    python -m unittest discover -s scripts -v

Standard library only. Every test works on a temporary directory with made-up
text; ``material/`` itself is never read or written here.
"""

from __future__ import annotations

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bundle_material as bm  # noqa: E402  (after sys.path setup)

HEX = set("0123456789abcdef")


class BundleMaterialTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    # -- helpers ---------------------------------------------------------------

    def material(self, files: dict[str, str | bytes], name: str = "material") -> Path:
        """Create a material directory with the given files. Values are UTF-8 text or raw bytes."""
        directory = self.root / name
        directory.mkdir(parents=True, exist_ok=True)
        for filename, content in files.items():
            data = content if isinstance(content, bytes) else content.encode("utf-8")
            (directory / filename).write_bytes(data)
        return directory

    @staticmethod
    def ids(bundle: bm.Bundle) -> list[str]:
        return [line.id for line in bundle.lines]

    @staticmethod
    def texts(bundle: bm.Bundle) -> list[str]:
        return [line.text for line in bundle.lines]

    @staticmethod
    def run_main(*argv: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = bm.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    # -- reading ---------------------------------------------------------------

    def test_empty_dir_gives_no_lines(self) -> None:
        bundle = bm.bundle_material(self.material({}))
        self.assertEqual(bundle.lines, ())
        self.assertEqual(bundle.files, ())
        self.assertEqual(len(bundle.hash), bm.HASH_LENGTH)
        self.assertTrue(set(bundle.hash) <= HEX)

    def test_missing_dir_is_an_error(self) -> None:
        with self.assertRaises(bm.BundleError):
            bm.bundle_material(self.root / "does-not-exist")

    def test_readme_is_skipped(self) -> None:
        only_readme = bm.bundle_material(self.material({"README.md": "# about this dir\nrules"}))
        self.assertEqual(only_readme.lines, ())
        self.assertEqual(only_readme.files, ())

        with_readme = bm.bundle_material(
            self.material({"README.md": "# about this dir", "alpha.md": "one\ntwo"}, "a")
        )
        without_readme = bm.bundle_material(self.material({"alpha.md": "one\ntwo"}, "b"))
        self.assertEqual(self.ids(with_readme), ["alpha#1", "alpha#2"])
        self.assertEqual(with_readme.files, ("alpha.md",))
        self.assertEqual(with_readme.hash, without_readme.hash)

    def test_only_top_level_md_files_are_bundled(self) -> None:
        directory = self.material({"alpha.md": "one", "notes.txt": "ignored"})
        (directory / "nested").mkdir()
        (directory / "nested" / "beta.md").write_text("ignored too", encoding="utf-8")
        bundle = bm.bundle_material(directory)
        self.assertEqual(bundle.files, ("alpha.md",))
        self.assertEqual(self.ids(bundle), ["alpha#1"])

    def test_one_file(self) -> None:
        bundle = bm.bundle_material(self.material({"alpha.md": "# Heading\n- first point\n- second point\n"}))
        self.assertEqual(bundle.files, ("alpha.md",))
        self.assertEqual(self.ids(bundle), ["alpha#1", "alpha#2", "alpha#3"])
        self.assertEqual(self.texts(bundle), ["# Heading", "- first point", "- second point"])

    def test_blank_and_whitespace_only_lines_are_skipped(self) -> None:
        bundle = bm.bundle_material(self.material({"alpha.md": "\n\none\n\n   \n\t\ntwo\n\n"}))
        self.assertEqual(self.ids(bundle), ["alpha#1", "alpha#2"])
        self.assertEqual(self.texts(bundle), ["one", "two"])

    def test_ids_are_stable_across_runs(self) -> None:
        directory = self.material({"alpha.md": "one\ntwo", "beta.md": "three"})
        first = bm.bundle_material(directory)
        second = bm.bundle_material(directory)
        self.assertEqual(first, second)
        self.assertEqual(self.ids(first), ["alpha#1", "alpha#2", "beta#1"])

    def test_ids_do_not_change_when_blank_lines_are_added(self) -> None:
        before = bm.bundle_material(self.material({"alpha.md": "one\ntwo\nthree"}, "a"))
        after = bm.bundle_material(self.material({"alpha.md": "\none\n\n\ntwo\n   \nthree\n"}, "b"))
        self.assertEqual(self.ids(before), self.ids(after))
        self.assertEqual(self.texts(before), self.texts(after))

    def test_files_are_bundled_in_sorted_filename_order(self) -> None:
        directory = self.material({})
        # Created in reverse order on purpose; the bundle order must not depend on it.
        (directory / "zeta.md").write_text("z1", encoding="utf-8")
        (directory / "beta.md").write_text("b1\nb2", encoding="utf-8")
        (directory / "alpha.md").write_text("a1", encoding="utf-8")
        bundle = bm.bundle_material(directory)
        self.assertEqual(bundle.files, ("alpha.md", "beta.md", "zeta.md"))
        self.assertEqual(self.ids(bundle), ["alpha#1", "beta#1", "beta#2", "zeta#1"])

    def test_trailing_whitespace_is_removed_and_indentation_kept(self) -> None:
        bundle = bm.bundle_material(self.material({"alpha.md": "- item   \n  - nested\t\n"}))
        self.assertEqual(self.texts(bundle), ["- item", "  - nested"])

    def test_crlf_and_bom_are_normalised(self) -> None:
        lf = bm.bundle_material(self.material({"alpha.md": "one\ntwo\n"}, "lf"))
        crlf = bm.bundle_material(self.material({"alpha.md": b"\xef\xbb\xbfone\r\ntwo\r\n"}, "crlf"))
        self.assertEqual(self.texts(lf), ["one", "two"])
        self.assertEqual(lf.lines, crlf.lines)
        self.assertEqual(lf.hash, crlf.hash)

    def test_invalid_utf8_is_an_error(self) -> None:
        with self.assertRaises(bm.BundleError):
            bm.bundle_material(self.material({"alpha.md": b"\xff\xfe not utf-8"}))

    def test_hash_sign_in_filename_is_rejected(self) -> None:
        with self.assertRaises(bm.BundleError):
            bm.bundle_material(self.material({"al#pha.md": "one"}))

    # -- hash ------------------------------------------------------------------

    def test_hash_is_short_hex(self) -> None:
        bundle = bm.bundle_material(self.material({"alpha.md": "one"}))
        self.assertEqual(len(bundle.hash), 12)
        self.assertTrue(set(bundle.hash) <= HEX)

    def test_hash_changes_when_text_changes(self) -> None:
        before = bm.bundle_material(self.material({"alpha.md": "one\ntwo"}, "a"))
        after = bm.bundle_material(self.material({"alpha.md": "one\ntwo!"}, "b"))
        self.assertEqual(self.ids(before), self.ids(after))  # same shape ...
        self.assertNotEqual(before.hash, after.hash)  # ... different content

    def test_hash_changes_when_a_line_moves_between_files(self) -> None:
        before = bm.bundle_material(self.material({"alpha.md": "one\ntwo", "beta.md": "three"}, "a"))
        after = bm.bundle_material(self.material({"alpha.md": "one", "beta.md": "two\nthree"}, "b"))
        self.assertEqual(self.texts(before), self.texts(after))  # same concatenated text ...
        self.assertNotEqual(self.ids(before), self.ids(after))  # ... but the ids moved ...
        self.assertNotEqual(before.hash, after.hash)  # ... so the hash must move too

    def test_hash_does_not_depend_on_the_directory_path(self) -> None:
        first = bm.bundle_material(self.material({"alpha.md": "one"}, "where/ever"))
        second = bm.bundle_material(self.material({"alpha.md": "one"}, "some/other/place"))
        self.assertEqual(first.hash, second.hash)

    # -- rendering -------------------------------------------------------------

    def test_render_exports_hash_and_lines(self) -> None:
        bundle = bm.bundle_material(self.material({"alpha.md": "one\ntwo"}))
        ts = bm.render_ts(bundle)
        self.assertIn("GENERATED FILE", ts)
        self.assertIn("export interface MaterialLine", ts)
        self.assertIn(f'export const MATERIAL_HASH: string = "{bundle.hash}";', ts)
        self.assertIn("export const MATERIAL: MaterialLine[] = [\n", ts)
        self.assertIn('  { id: "alpha#1", text: "one" },\n', ts)
        self.assertIn('  { id: "alpha#2", text: "two" },\n', ts)
        self.assertTrue(ts.endswith("];\n"))

    def test_render_empty_bundle(self) -> None:
        ts = bm.render_ts(bm.bundle_material(self.material({})))
        self.assertIn("// Sources (0 file(s)): (none)\n", ts)
        self.assertIn("export const MATERIAL: MaterialLine[] = [];\n", ts)

    def test_render_escapes_strings(self) -> None:
        text = 'say "hi" \\ back tab\there naïve'
        ts = bm.render_ts(bm.bundle_material(self.material({"alpha.md": text})))
        self.assertIn('text: "say \\"hi\\" \\\\ back\\u2028tab\\there naïve"', ts)
        self.assertNotIn(" ", ts)

    def test_render_contains_no_absolute_paths(self) -> None:
        directory = self.material({"alpha.md": "one"})
        ts = bm.render_ts(bm.bundle_material(directory))
        self.assertNotIn(str(directory), ts)
        self.assertNotIn(str(self.root), ts)

    # -- command line ----------------------------------------------------------

    def test_main_writes_file_and_is_byte_identical_across_runs(self) -> None:
        directory = self.material({"alpha.md": "one\ntwo", "beta.md": "three"})
        out = self.root / "generated" / "material.ts"

        code, stdout, _ = self.run_main("--material", str(directory), "--out", str(out))
        self.assertEqual(code, 0)
        self.assertIn("wrote", stdout)
        first = out.read_bytes()

        code, stdout, _ = self.run_main("--material", str(directory), "--out", str(out))
        self.assertEqual(code, 0)
        self.assertIn("unchanged", stdout)
        self.assertEqual(out.read_bytes(), first)
        self.assertEqual(first.decode("utf-8"), bm.render_ts(bm.bundle_material(directory)))
        self.assertNotIn(b"\r", first)

    def test_check_passes_when_up_to_date(self) -> None:
        directory = self.material({"alpha.md": "one"})
        out = self.root / "material.ts"
        self.assertEqual(self.run_main("--material", str(directory), "--out", str(out))[0], 0)
        code, stdout, stderr = self.run_main("--check", "--material", str(directory), "--out", str(out))
        self.assertEqual(code, 0, stderr)
        self.assertIn("up to date", stdout)

    def test_check_fails_when_stale(self) -> None:
        directory = self.material({"alpha.md": "one"})
        out = self.root / "material.ts"
        self.assertEqual(self.run_main("--material", str(directory), "--out", str(out))[0], 0)
        before = out.read_bytes()

        (directory / "alpha.md").write_text("one\ntwo", encoding="utf-8")
        code, _, stderr = self.run_main("--check", "--material", str(directory), "--out", str(out))
        self.assertEqual(code, 1)
        self.assertIn("out of date", stderr)
        self.assertEqual(out.read_bytes(), before)  # --check never writes

    def test_check_fails_when_output_is_missing(self) -> None:
        directory = self.material({"alpha.md": "one"})
        out = self.root / "material.ts"
        code, _, stderr = self.run_main("--check", "--material", str(directory), "--out", str(out))
        self.assertEqual(code, 1)
        self.assertIn("missing", stderr)
        self.assertFalse(out.exists())

    def test_main_reports_bundle_errors(self) -> None:
        out = self.root / "material.ts"
        code, _, stderr = self.run_main("--material", str(self.root / "nope"), "--out", str(out))
        self.assertEqual(code, 1)
        self.assertIn("not found", stderr)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
