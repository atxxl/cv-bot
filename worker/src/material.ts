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
// Sources (1 file(s)): mai.md

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
export const MATERIAL_HASH: string = "dda42f9b021e";

export const MATERIAL: MaterialLine[] = [
  { id: "mai#1", text: "# mAI (now 1-to-X.ai) — AI Engineer internship, 2026" },
  { id: "mai#2", text: "Role: AI Engineer intern at mAI (now 1-to-X.ai), a platform that generates business software through an agentic LLM pipeline. Stack: Python backend, Next.js/TypeScript frontend, PostgreSQL. The product serves 50+ customers." },
  { id: "mai#3", text: "## What I built" },
  { id: "mai#4", text: "- Built a build-request approval workflow end to end: a new `rebuild_requests` table, four backend scripts (submit, load pending, approve, reject), Next.js pages for requesting and reviewing, notifications to the requester, and request history with audit fields (who resolved it, when)." },
  { id: "mai#5", text: "- On approval the backend creates a task in the project's task board and hands off to the agentic build pipeline as a background job; the frontend polls the job status." },
  { id: "mai#6", text: "- Rejections require a reason. The sidebar shows the live count of pending requests." },
  { id: "mai#7", text: "- Extended infrastructure settings with VM backup configuration: four new database columns, load and save scripts, and a configuration card in the admin UI. Built and tested locally; this change was not merged into the main branch." },
  { id: "mai#8", text: "## What I fixed" },
  { id: "mai#9", text: "- Traced a silent failure in the pipeline hand-off: failed builds were recorded as successful and users were told \"rebuild completed\". The builder returned a failure object instead of raising, and the trigger script only caught exceptions." },
  { id: "mai#10", text: "- Fixed the result check so a failed build is recorded as failed and no success notification is sent." },
  { id: "mai#11", text: "- Added a backend guard that rejects an approval before any database write when the project has no architecture record, so the owner sees the error at approval time." },
  { id: "mai#12", text: "- Fixed the frontend call order: the build trigger used to fire before the approval had completed, so a build could start on an unapproved request. Now approval is awaited and checked first." },
  { id: "mai#13", text: "- Found a race where a page reload after approval could drop the build trigger before it reached the server. Moved the trigger into the backend, started after the database commit, so the build always starts regardless of frontend state." },
  { id: "mai#14", text: "- Replaced browser alert() with an error modal in the existing UI style; amber marks \"blocked\", red is reserved for destructive actions." },
  { id: "mai#15", text: "## Architecture view" },
  { id: "mai#16", text: "- Designed a visual language in the architecture view that marks connections to external services (third-party APIs, external auth): amber background and a globe icon on API files, a dashed amber border on the integrations directory to show the system boundary, and a legend entry." },
  { id: "mai#17", text: "- Designed it so that a planned second kind of outward connection (other projects in the same group) could be distinguished later without changing the language." },
  { id: "mai#18", text: "## How I worked" },
  { id: "mai#19", text: "- Ran the full stack locally on day one and worked across frontend and backend from then on." },
  { id: "mai#20", text: "- Wrote open questions before starting a task and a short reflection after finishing it." },
  { id: "mai#21", text: "- Used Claude Code day to day for codebase onboarding, style-consistent refactoring and documentation." },
  { id: "mai#22", text: "## Not done at mAI" },
  { id: "mai#23", text: "- Did not build the RAG or agent generation pipeline itself; worked on features that connect to it and on its failure detection." },
  { id: "mai#24", text: "- Did not write the Dockerfile or the CI/CD configuration." },
];
