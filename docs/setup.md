# Setup

How to get a clean machine from `git clone` to a working local Worker.

## Prerequisites

- Node.js 20 or newer (`node --version`)
- Python 3.11 or newer (`python3 --version`), only needed for `evals/` and `scripts/`
- A Cloudflare account (owner only; needed to deploy, not to run the evals)

## Clone and install

```sh
git clone https://github.com/atxxl/cv-bot.git
cd cv-bot
cd worker && npm install
```

`npm install` pulls in `wrangler`, TypeScript and the Workers type definitions. No other dependencies.

## Run the checks

From the repository root:

```sh
python -m unittest discover -s evals -p "test_*.py" -v   # unit tests of the eval scripts
python evals/checks.py                                    # question set, forbidden list, newest committed run
```

This is what CI runs on every pull request. Both need only the standard library. `checks.py` without arguments reports the newest run under `evals/runs/` and gates only on malformed input; `python evals/checks.py evals/runs/<file>.jsonl` exits 1 if any hard check fails.

## Run the evals

Running the questions against the model and judging the answers needs the `anthropic` package and an API key in the environment variable `CVBOT_API_KEY` (`ANTHROPIC_API_KEY` works as a local fallback). The key lives only in the environment: never in a file, never printed.

```sh
pip install -r evals/requirements.txt
python evals/run.py --direct                     # same request the Worker sends; writes evals/runs/<date>-<sha>.jsonl
python evals/checks.py evals/runs/<file>.jsonl   # the pass table for the PR description
python evals/judge.py evals/runs/<file>.jsonl    # Sonnet judge; adds verdicts to the same file
```

`run.py --worker https://<your-worker>.workers.dev` sends the questions through a deployed Worker instead. Every prompt change gets a run, committed in the same PR. Details in `evals/README.md`.

## Run the Worker tests

```sh
cd worker
npm run typecheck   # tsc --noEmit over src/ and test/
npm test            # vitest, inside the Workers runtime (workerd) via @cloudflare/vitest-plugin
```

CI runs both on every pull request. The tests use made-up material and a fake model; they never call the Anthropic API and need no key. Each test starts with empty KV namespaces.

## Regenerate the material bundle

The Worker does not read `material/` at runtime. `scripts/bundle_material.py` turns `material/*.md` (sorted by filename, `README.md` skipped) into `worker/src/material.ts`, which is committed. Every non-empty line gets a stable id `<file stem>#<n>`, where `n` counts the non-empty lines of that file, and `MATERIAL_HASH` is a short sha256 of the bundled sources.

After any change under `material/`, from the repository root:

```sh
python scripts/bundle_material.py          # rewrites worker/src/material.ts
python scripts/bundle_material.py --check  # exit 1 if material.ts is out of date
```

Commit the regenerated `material.ts` together with the material change. CI runs the `--check` form and the bundler's unit tests:

```sh
python -m unittest discover -s scripts -v
```

Do not edit `worker/src/material.ts` by hand; the next run overwrites it.

## Fill in the placeholders (owner only)

`worker/wrangler.toml` ships with `<fill-in>` placeholders. Replace them locally; never commit real ids.

| Placeholder | Where to get it |
| --- | --- |
| `account_id` | Cloudflare dashboard, Workers & Pages overview |
| `RATE_LIMIT` KV `id` / `preview_id` | `npx wrangler kv namespace create RATE_LIMIT` (and `--preview`) |
| `SPEND` KV `id` / `preview_id` | `npx wrangler kv namespace create SPEND` (and `--preview`) |

The monthly spend cap is not a placeholder in this file; it lives in KV (next section) so it can be changed without a deploy.

## Secrets (owner only)

The Anthropic API key is a Worker secret, never a file in the repo:

```sh
cd worker
npx wrangler secret put ANTHROPIC_API_KEY
```

For `wrangler dev` locally, put it in `worker/.dev.vars` (gitignored):

```
ANTHROPIC_API_KEY=...
```

## Switches in KV (owner only)

The Worker answers only when four values in the `SPEND` namespace say it may. Anything missing or malformed makes every `/ask` return `503 {"answer": "Not available right now.", "refused": true}` without calling the model (fail closed). Set them once after creating the namespaces, and again when they change:

```sh
cd worker
npx wrangler kv key put --binding SPEND enabled 1                 # anything but "1" switches the bot off
npx wrangler kv key put --binding SPEND spend_cap_usd 5           # monthly USD ceiling, decimal string
npx wrangler kv key put --binding SPEND material_hash <hash>      # the MATERIAL_HASH in worker/src/material.ts
```

- `enabled`: the kill switch. `npx wrangler kv key put --binding SPEND enabled 0` stops the bot immediately, no deploy needed.
- `spend_cap_usd`: the Worker refuses a question when this month's total plus a worst-case estimate of the next call would exceed it. Any model error leaves the total unchanged.
- `material_hash`: pins the material version that may answer. The Worker compares it with the hash bundled at deploy time and refuses on mismatch, so a deploy that does not match what you approved answers nothing until you update the pin. Read the current hash with `python scripts/bundle_material.py --check` (it prints it) or from `worker/src/material.ts`.
- `spend_<yyyy-mm>` (for example `spend_2026-10`, UTC month): the running total in USD, written by the Worker. Read it with `npx wrangler kv key get --binding SPEND spend_2026-10`; delete it to reset a month. You never need to set it.

Add `--preview` to the commands above to set the same keys for `wrangler dev`. Per-IP rate-limit counters live in the `RATE_LIMIT` namespace under `ip:<sha256 of the ip>` and expire on their own after the window.

## Run locally

```sh
cd worker
npm run dev
```

`wrangler dev` uses the `preview_id` namespaces and `.dev.vars` for the key. `/ask` requires the `CF-Connecting-IP` header (`wrangler dev` sets it itself from the connecting socket, so neither `curl` nor a browser has to) and only answers requests whose `Origin` is `https://atxxl.github.io` or absent; for example:

```sh
curl -s localhost:8787/ask -H 'content-type: application/json' -d '{"question": "What is in the material?"}'
curl -s localhost:8787/material-hash
curl -s localhost:8787/material
```

## Try the widget locally

`web/demo.html` is a placeholder page (no CV content) that mounts the widget against `http://localhost:8787`. A browser sends an `Origin` header with every question and the Worker only answers its `ALLOWED_ORIGIN`, so the page cannot simply be opened from `file://` (origin `null`, refused): serve `web/` over http and let the Worker allow that origin for this run. `ALLOWED_ORIGIN` must be `https`, except that `localhost` and `127.0.0.1` may be plain `http`; that exception exists for exactly this.

Terminal 1, the Worker, with the page's origin in place of the one in `wrangler.toml` (`--var` overrides a `[vars]` entry for this run only; a line `ALLOWED_ORIGIN=http://localhost:8000` in `.dev.vars` does the same permanently):

```sh
cd worker
npx wrangler dev --var ALLOWED_ORIGIN:http://localhost:8000
```

Terminal 2, the page:

```sh
python3 -m http.server 8000 --directory web
```

Open <http://localhost:8000/demo.html>. `CF-Connecting-IP` needs nothing from you: `wrangler dev` sets it from the connecting socket (`127.0.0.1` or `::1`), so the rate limit counts your browser as one IP. Without an API key in `.dev.vars`, or with the `--preview` switches unset, every question comes back as "Not available right now."; that is the Worker failing closed, and it still exercises the request path, the refusal rendering and `GET /material`. With the key and the switches set, answers render with their citations as expandable quotes and the material version under them.

## Deploy (owner only)

```sh
cd worker
npm run deploy                                                    # wrangler deploy
npx wrangler kv key put --binding SPEND material_hash <hash>      # when the material changed
```

After a deploy that changed `material/`, update the pin or the bot stays off. Order does not matter: between the two commands the Worker refuses with "not available right now" rather than answering from unpinned material.

### Endpoints

| Request | Response |
| --- | --- |
| `POST /ask` `{"question": "..."}` (max 500 characters) | `200 {"answer", "citations": ["mai#3", ...], "refused": false, "material_hash"}` |
| same, refused (bad input `400`, origin `403`, rate limit `429`, everything else `503`) | `{"answer": "<short reason or Not available right now.>", "citations": [], "refused": true, "material_hash"}` |
| `GET /material-hash` | `200 {"hash": "..."}` |
| `GET /material` | `200 {"hash": "...", "lines": [{"id": "mai#1", "text": "..."}, ...]}`, the whole bundled material; `cache-control: public, max-age=3600`; no rate limit, no log line |
| anything else | `404` |

The Worker logs one JSON line per `/ask`: question length, refusal flag and reason, latency, token counts, cost. Never the question or the answer.
