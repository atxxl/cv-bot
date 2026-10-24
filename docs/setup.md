# Setup

How to get a clean machine from `git clone` to a working local Worker.

## Prerequisites

- Node.js 20 or newer (`node --version`)
- Python 3.11 or newer (`python3 --version`), only needed for `evals/`
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
python evals/checks.py
```

This is what CI runs on every pull request. `evals/` has no third-party Python dependencies.

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
| `MONTHLY_SPEND_CAP_USD` | The monthly USD ceiling you are willing to spend |

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

## Run locally

```sh
cd worker
npm run dev
```

Until issue 3 (Worker v1) lands, every request returns a 503 "not available right now" and no model is called.

## Deploy (owner only)

```sh
cd worker
npm run deploy
```
