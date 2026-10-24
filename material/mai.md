# mAI (now 1-to-X.ai) — AI Engineer internship, 2026

Role: AI Engineer intern at mAI (now 1-to-X.ai), a platform that generates business software through an agentic LLM pipeline. Stack: Python backend, Next.js/TypeScript frontend, PostgreSQL. The product serves 50+ customers.

## What I built

- Built a build-request approval workflow end to end: a new `rebuild_requests` table, four backend scripts (submit, load pending, approve, reject), Next.js pages for requesting and reviewing, notifications to the requester, and request history with audit fields (who resolved it, when).
- On approval the backend creates a task in the project's task board and hands off to the agentic build pipeline as a background job; the frontend polls the job status.
- Rejections require a reason. The sidebar shows the live count of pending requests.
- Extended infrastructure settings with VM backup configuration: four new database columns, load and save scripts, and a configuration card in the admin UI. Built and tested locally; this change was not merged into the main branch.

## What I fixed

- Traced a silent failure in the pipeline hand-off: failed builds were recorded as successful and users were told "rebuild completed". The builder returned a failure object instead of raising, and the trigger script only caught exceptions.
- Fixed the result check so a failed build is recorded as failed and no success notification is sent.
- Added a backend guard that rejects an approval before any database write when the project has no architecture record, so the owner sees the error at approval time.
- Fixed the frontend call order: the build trigger used to fire before the approval had completed, so a build could start on an unapproved request. Now approval is awaited and checked first.
- Found a race where a page reload after approval could drop the build trigger before it reached the server. Moved the trigger into the backend, started after the database commit, so the build always starts regardless of frontend state.
- Replaced browser alert() with an error modal in the existing UI style; amber marks "blocked", red is reserved for destructive actions.

## Architecture view

- Designed a visual language in the architecture view that marks connections to external services (third-party APIs, external auth): amber background and a globe icon on API files, a dashed amber border on the integrations directory to show the system boundary, and a legend entry.
- Designed it so that a planned second kind of outward connection (other projects in the same group) could be distinguished later without changing the language.

## How I worked

- Ran the full stack locally on day one and worked across frontend and backend from then on.
- Wrote open questions before starting a task and a short reflection after finishing it.
- Used Claude Code day to day for codebase onboarding, style-consistent refactoring and documentation.

## Not done at mAI

- Did not build the RAG or agent generation pipeline itself; worked on features that connect to it and on its failure detection.
- Did not write the Dockerfile or the CI/CD configuration.
