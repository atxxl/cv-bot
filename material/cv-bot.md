# cv-bot — the Q&A assistant on this CV page, 2026

Role: Owner of a small personal project: a question-answering bot embedded in my CV page. It answers only from a curated set of material files that I maintain, cites the lines it used, and says so when the material does not cover a question. Code: https://github.com/atxxl/cv-bot

## What it is

- The assistant you are talking to right now. It answers questions about my background using only the files in the repository's `material/` folder; nothing else is in scope.
- If something is not in the material, it says plainly that my CV does not list it, instead of guessing.

## How it is built

- A Cloudflare Worker (TypeScript) in front of the Claude API (Haiku 4.5, temperature 0), with two KV namespaces: one for per-IP rate limiting (10 questions per 10 minutes) and one for operational switches (`enabled`, `spend_cap_usd`, `material_hash`).
- The Worker refuses to answer when the hash of the material it was built with does not match the `material_hash` switch, so a stale deployment fails closed instead of answering from old facts.
- The production API key is a Cloudflare Worker secret issued from its own Anthropic Console workspace with a monthly spending limit; evaluation runs use a separate key, so either can be revoked on its own.
- Every claim about me carries a citation to a material line; a plain "not done" or a refusal carries none. Citations are checked against the bundled material: unknown ids are dropped, and a short range (up to 8 lines) is expanded line by line so the reader sees the exact lines the answer rests on.
- A Python evaluation harness: a fixed question set (`evals/questions.jsonl`, 39 questions across grounded, not-done, out-of-scope and prompt-injection cases), a list of things the bot must never state (`evals/forbidden.txt`), and an LLM judge that scores answers for faithfulness and tone.
- Every prompt change is run against the same fixed set and the numbers go into the pull request; a drop is reported, not explained away. CI reports the evaluation but does not block merges; I decide.
- Under the same judge, questions, model and material: the first prompt scored 1.85 mean faithfulness (0–2); v3 raised tone and injection handling but lowered faithfulness to 1.72; v4 brought faithfulness back to 1.82 with tone at 1.00.
- The v3 misses had three causes, and each got its own fix: the judge penalised sentences the prompt requires (judge v2), the parser dropped range citations (range expansion in the Worker), and the model over-elaborated (prompt v4).
- Tests: 126 Python tests (76 for the evaluation harness, 50 for the material bundler, the widget and the operations docs) and 209 Worker tests, as of November 2026.
- The page loads the widget from the Worker itself with version-based caching, so the CV page only carries a three-line snippet.

## How it was developed, and my role

- The code was written mostly with Claude Code, one GitHub issue per cloud session, each ending in a pull request.
- I set the constraints (what the bot may and may not say, how spending is capped, what counts as a regression), decided what each issue should do, approved the evaluation questions, the forbidden list and every material file, and merged every pull request; drafting and first-pass review were done together with my own Claude-based assistant.
- The evaluation design, the forbidden list and the material files are mine; agents do not edit the material.
- I treat it as a small production system: fail-closed switches, a spend cap, separate keys, and an evaluation run before every prompt change.

## Why I built it

- I wanted a concrete, inspectable example of an LLM product where the interesting work is in the constraints and the evaluation rather than in the prompt.
- It also answers the same recruiter questions consistently, with citations, instead of relying on my memory in each conversation.

## Not done

- The widget sets no cookies, uses no local storage and has no analytics.
- The Worker logs question length, latency and cost, never the text of a question or an answer.
