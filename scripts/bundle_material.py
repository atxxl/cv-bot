#!/usr/bin/env python3
"""Bundle ``material/*.md`` into ``worker/src/material.ts``.

The Worker ships the approved material inside its own bundle. This script is
the only thing that writes ``worker/src/material.ts``; nobody edits that file
by hand.

What it does
------------
- Reads every ``material/*.md`` (top level only) in sorted filename order.
  ``README.md`` is skipped: it explains the directory, it is not material.
- Decodes each file as UTF-8 (a leading BOM is dropped) and normalises line
  endings to LF, so the result is the same on every platform and checkout.
- Every non-empty line (anything other than whitespace on it) becomes one
  entry ``{id, text}``. ``id`` is ``<file stem>#<n>`` where ``n`` is the
  1-based index of that line among the non-empty lines of its file: ``mai#3``
  is the third non-empty line of ``mai.md``. Blank lines are not counted, so
  adding or removing a blank line does not renumber anything. ``text`` is the
  line with trailing whitespace removed; leading indentation is kept.
- ``MATERIAL_HASH`` is the first 12 hex characters of the sha256 over the
  bundled sources: for each file in order, its filename, a newline, its
  normalised content, a newline. The filename is part of the hash so that
  moving a line from one file to another (which changes its id) also changes
  the hash.
- The rendered TypeScript contains nothing that varies between runs (no
  timestamps, no absolute paths), so the same input gives byte-identical
  output and running the script twice produces no diff.

Usage
-----
    python scripts/bundle_material.py            # (re)write worker/src/material.ts
    python scripts/bundle_material.py --check    # exit 1 if material.ts is out of date

``--check`` is what CI runs. Both forms accept ``--material DIR`` and
``--out FILE`` to work on other paths; the tests use them.

No third-party dependencies.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MATERIAL_DIR = REPO_ROOT / "material"
DEFAULT_OUT = REPO_ROOT / "worker" / "src" / "material.ts"

SKIP_NAMES = frozenset({"README.md"})
HASH_LENGTH = 12


class BundleError(Exception):
    """The material cannot be bundled. The CLI reports it and exits 1."""


@dataclass(frozen=True)
class MaterialLine:
    id: str
    text: str


@dataclass(frozen=True)
class Bundle:
    lines: tuple[MaterialLine, ...]
    hash: str
    files: tuple[str, ...]  # bundled filenames, in bundle order


def list_material_files(material_dir: Path) -> list[Path]:
    """Top-level ``*.md`` files in ``material_dir``, sorted by filename, README.md excluded."""
    if not material_dir.is_dir():
        raise BundleError(f"material directory not found: {material_dir}")
    files = [p for p in material_dir.glob("*.md") if p.is_file() and p.name not in SKIP_NAMES]
    return sorted(files, key=lambda p: p.name)


def read_source(path: Path) -> str:
    """File content as text: UTF-8 (BOM dropped), line endings normalised to LF."""
    try:
        text = path.read_bytes().decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise BundleError(f"{path}: not valid UTF-8 ({exc})") from exc
    return text.replace("\r\n", "\n").replace("\r", "\n")


def split_lines(stem: str, text: str) -> list[MaterialLine]:
    """One ``MaterialLine`` per non-empty line, numbered 1.. among non-empty lines."""
    lines: list[MaterialLine] = []
    n = 0
    for raw in text.split("\n"):
        if not raw.strip():
            continue
        n += 1
        lines.append(MaterialLine(id=f"{stem}#{n}", text=raw.rstrip()))
    return lines


def bundle_material(material_dir: Path) -> Bundle:
    """Read ``material_dir`` and return the lines, the content hash and the file list."""
    hasher = hashlib.sha256()
    lines: list[MaterialLine] = []
    names: list[str] = []
    for path in list_material_files(material_dir):
        if "#" in path.stem:
            raise BundleError(
                f"{path.name}: '#' is not allowed in a material filename, "
                "it separates the file stem from the line number in ids"
            )
        text = read_source(path)
        for chunk in (path.name, "\n", text, "\n"):
            hasher.update(chunk.encode("utf-8"))
        lines.extend(split_lines(path.stem, text))
        names.append(path.name)
    return Bundle(tuple(lines), hasher.hexdigest()[:HASH_LENGTH], tuple(names))


def js_string(text: str) -> str:
    """A double-quoted JavaScript string literal for ``text``.

    ``json.dumps`` escapes quotes, backslashes and control characters and is
    deterministic. U+2028 and U+2029 are escaped as well so no line separator
    ever appears inside a literal. Other non-ASCII text is kept readable.
    """
    literal = json.dumps(text, ensure_ascii=False)
    return literal.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


HEADER = """\
// GENERATED FILE. Do not edit by hand.
//
// Built by scripts/bundle_material.py from material/*.md (README.md excluded).
// After any change under material/, regenerate with:
//
//   python scripts/bundle_material.py
//
// CI runs `python scripts/bundle_material.py --check` and fails when this
// file is out of date.
"""

TYPES = """\
/** One citable line of the approved material. */
export interface MaterialLine {
  /**
   * Stable citation id `<file stem>#<n>`: n is the 1-based index of the line
   * among the non-empty lines of its source file (`mai#3` is the third
   * non-empty line of `material/mai.md`).
   */
  id: string;
  /** The line as written in the material, trailing whitespace removed. */
  text: string;
}
"""


def render_ts(bundle: Bundle) -> str:
    """The full content of ``material.ts`` for ``bundle``. Deterministic."""
    sources = ", ".join(bundle.files) if bundle.files else "(none)"
    out = [
        HEADER,
        "//\n",
        f"// Sources ({len(bundle.files)} file(s)): {sources}\n",
        "\n",
        TYPES,
        "\n",
        "/** sha256 of the bundled source files (sorted, newline-normalised), first 12 hex chars. */\n",
        f"export const MATERIAL_HASH: string = {js_string(bundle.hash)};\n",
        "\n",
    ]
    if bundle.lines:
        out.append("export const MATERIAL: MaterialLine[] = [\n")
        for line in bundle.lines:
            out.append(f"  {{ id: {js_string(line.id)}, text: {js_string(line.text)} }},\n")
        out.append("];\n")
    else:
        out.append("export const MATERIAL: MaterialLine[] = [];\n")
    return "".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="bundle_material.py",
        description="Bundle material/*.md into worker/src/material.ts with stable line ids and a content hash.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="do not write; exit 1 if the output file is missing or out of date",
    )
    parser.add_argument(
        "--material",
        type=Path,
        default=DEFAULT_MATERIAL_DIR,
        help="directory holding the *.md material (default: material/)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help="TypeScript file to write or check (default: worker/src/material.ts)",
    )
    args = parser.parse_args(argv)

    try:
        bundle = bundle_material(args.material)
    except BundleError as exc:
        print(f"bundle_material: {exc}", file=sys.stderr)
        return 1

    rendered = render_ts(bundle).encode("utf-8")
    summary = f"{len(bundle.lines)} line(s) from {len(bundle.files)} file(s), hash {bundle.hash}"

    if args.check:
        if not args.out.exists():
            print(f"bundle_material: {args.out} is missing; run: python scripts/bundle_material.py", file=sys.stderr)
            return 1
        if args.out.read_bytes() != rendered:
            print(
                f"bundle_material: {args.out} is out of date with {args.material}; "
                "run: python scripts/bundle_material.py and commit the result",
                file=sys.stderr,
            )
            return 1
        print(f"bundle_material: {args.out} is up to date ({summary})")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    unchanged = args.out.exists() and args.out.read_bytes() == rendered
    args.out.write_bytes(rendered)
    verb = "unchanged" if unchanged else "wrote"
    print(f"bundle_material: {verb} {args.out} ({summary})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
