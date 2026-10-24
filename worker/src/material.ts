// GENERATED FILE. Do not edit by hand.
//
// Built by scripts/bundle_material.py from material/*.md (README.md excluded).
// After any change under material/, regenerate with:
//
//   python scripts/bundle_material.py
//
// CI runs `python scripts/bundle_material.py --check` and fails when this
// file is out of date.
//
// Sources (0 file(s)): (none)

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

/** sha256 of the bundled source files (sorted, newline-normalised), first 12 hex chars. */
export const MATERIAL_HASH: string = "e3b0c44298fc";

export const MATERIAL: MaterialLine[] = [];
