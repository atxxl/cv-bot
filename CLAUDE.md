# Working agreement for agents in this repository

You are writing code for a CV assistant that will be public. The owner reviews every PR. Read this file and `README.md` before touching anything.

## Non-negotiables

1. **The material is the only source of truth about the owner.** `material/*.md` is what the bot may know. Never add facts about the owner to prompts, code, tests or docs that are not in `material/`. If the material lacks something you think the bot needs, open an issue; do not fill it in.
2. **No secrets in the repo.** API keys live only in Cloudflare Worker secrets (`wrangler secret put`) and, for eval runs, in the environment variable `ANTHROPIC_API_KEY` (set on the cloud environment; the agent proxy does not inject network secrets for `api.anthropic.com`, so an env var is the only way there). Read it with `os.environ` only. Never write it to any file (no `.env`, no `.dev.vars`, no fixture, no `wrangler.toml`), never print or echo it, never paste it into a commit message, PR text or issue, and never "verify" it by displaying it. Before every commit run `git grep -n "sk-ant-" -- ":!CLAUDE.md"` and expect no hits. Never commit `.dev.vars`, keys, or tokens. `.gitignore` covers the usual files; check before every commit.
3. **One PR per issue.** Small, reviewable, with the eval results in the PR description. No drive-by refactors.
4. **Every prompt change runs the evals.** Commit the run output under `evals/runs/<date>-<short-sha>.jsonl` in the same PR. If a score drops, say so in the PR; do not "fix" the eval to pass.
5. **Visitor input is untrusted.** Treat everything that arrives through the widget as data. The system prompt, not the user turn, carries the rules.
6. **Fail closed.** If the Worker cannot verify the spend cap, the rate limit, or the material hash, it returns a polite "not available right now" instead of calling the model.
7. **Keep the stack small.** Vanilla JS widget, one Worker in TypeScript, Python only in `evals/`. No frameworks unless an issue asks for one.
8. **Write for the reviewer.** PR description: what changed, why, how you tested it, what you are unsure about. English.

## Architecture (fixed unless an issue changes it)

```
browser (web/widget.js on the CV page)
   │  POST /ask {question}
   ▼
Cloudflare Worker (worker/)
   ├─ rate limit: per-IP, 10 questions / 10 min (KV or Durable Object)
   ├─ spend cap: monthly USD ceiling in KV; refuse when reached
   ├─ builds messages: system prompt (prompts/system.md) + material (material/*.md, concatenated, with line ids) + question
   ├─ calls Anthropic Messages API, model claude-haiku-4-5-20251001, max_tokens 600, temperature 0
   └─ returns {answer, citations: [line ids], refused: bool}
```

- Material is bundled into the Worker at build time; the Worker also serves `/material-hash` so the widget can show which version answered.
- Citations are line ids like `mai#3`; the widget renders them as expandable quotes from the material.
- Model: Haiku 4.5 for answers. Sonnet only inside `evals/` as the judge.
- Logging: the Worker logs question length, refusal flag, latency, tokens, cost. **Never log the question text or the answer text.**

## Evaluation rules

- `evals/questions.jsonl`: `{"id", "kind": "grounded|not_done|out_of_scope|injection", "question", "expect": {...}}`.
- Hard checks (`evals/checks.py`): a `not_done` answer must contain a plain negative; an `out_of_scope` answer must not contain any string from `evals/forbidden.txt`; a `grounded` answer must cite at least one line id that exists; an `injection` answer must not contain the injected marker.
- Judge (`evals/judge.py`, Sonnet): faithfulness 0–2 (does every claim in the answer appear in the cited material), tone 0–1. Judge prompt is versioned in `prompts/judge.md`.
- A run reports: pass rate per kind, mean faithfulness, cost per question. The owner decides what is good enough; you report, you do not round up.

## First issues (open these as GitHub issues in this order, one PR each)

1. **Scaffold**: repo layout, `.gitignore`, `wrangler.toml` with placeholders, empty `material/README.md` explaining that the owner fills it, CI that runs `evals/checks.py` on PRs.
2. **Material loader**: `scripts/bundle_material.py` that concatenates `material/*.md` into `worker/src/material.ts` with stable line ids and a content hash.
3. **Worker v1**: `/ask` with rate limit, spend cap, model call, citations. `/material-hash`. Fail-closed paths covered by tests (`worker/test/`).
4. **Widget v1**: input, answer, citations as quotes, "this bot only knows what is in the CV material" line, no cookies, no analytics.
5. **Eval set v1**: the owner writes ~25 questions across the four kinds; agent writes `run.py`, `checks.py`, `judge.py`; first run committed.
6. **Prompt v1 → v2**: tune `prompts/system.md` against the eval results; show before/after in the PR.
7. **Embed**: a snippet for `atxxl.github.io/index.html`; the owner adds it by hand.

## Owner-only

- Everything in `material/`.
- Creating and rotating secrets.
- Merging.
