# Runbook

Operating the deployed Worker: take the widget offline, rotate the API key, change the spend cap, read the logs. Owner only. First-time setup is in `docs/setup.md`; the CV page snippet in `web/embed.md`.

Every command runs from `worker/`, logged in with `npx wrangler login`, with the real namespace ids filled into your local `wrangler.toml` (never committed).

> **Every `wrangler kv key` command here carries `--remote --preview false`.** Wrangler 4 reads and writes local dev storage unless it is given `--remote`, and with both an `id` and a `preview_id` in `wrangler.toml` it refuses to guess the namespace unless it is given `--preview false` (production) or `--preview` (dev). A command without `--remote` still prints "Writing the value…", but production does not change.

## Quick reference

| Task | Command |
| --- | --- |
| Take the widget offline | `npx wrangler kv key put --remote --preview false --binding SPEND enabled false` |
| Bring it back | `npx wrangler kv key put --remote --preview false --binding SPEND enabled 1` |
| Is it on? | `npx wrangler kv key get --remote --preview false --binding SPEND enabled` |
| Set the monthly cap (USD) | `npx wrangler kv key put --remote --preview false --binding SPEND spend_cap_usd 5` |
| Read the cap | `npx wrangler kv key get --remote --preview false --binding SPEND spend_cap_usd` |
| This month's spend | `npx wrangler kv key get --remote --preview false --binding SPEND spend_$(date -u +%Y-%m)` |
| Pin the deployed material | `npx wrangler kv key put --remote --preview false --binding SPEND material_hash <hash>` |
| Rotate the API key | `npx wrangler secret put ANTHROPIC_API_KEY` |
| Live logs | `npx wrangler tail --format pretty` |

KV changes need no deploy. They reach every Cloudflare location within about a minute: the Worker reads KV through its edge cache, which holds a value for up to 60 seconds.

## Take the widget offline (kill switch)

```sh
npx wrangler kv key put --remote --preview false --binding SPEND enabled false
```

What it does:

- Every `POST /ask` returns `503 {"answer": "Not available right now.", "citations": [], "refused": true, ...}`. The model is not called, nothing is added to the month's spend, and no rate-limit slot is used.
- The widget stays on the page. `/widget.js`, `/widget.css`, `/material` and `/material-hash` keep working; the box renders and answers every question with "Not available right now."
- Each refused question logs one line with `"reason":"disabled"`. That is how you confirm the switch is what refused (next section).

Check it from the terminal (replace `<your-worker>`). A 503 with `"refused": true` means it is off:

```sh
curl -s -w '\n%{http_code}\n' https://<your-worker>.workers.dev/ask -H 'content-type: application/json' -d '{"question": "Are you on?"}'
```

Bring it back:

```sh
npx wrangler kv key put --remote --preview false --binding SPEND enabled 1
```

Only the exact value `1` turns the bot on. `false`, `0`, `off`, `true`, `yes`, ` 1` (with a space), an empty value, or a deleted key all keep it off. That is deliberate: the Worker fails closed on anything it does not recognise. `docs/decisions.md`, entry 2.

To remove the widget from the page altogether, delete the snippet from the CV page (`web/embed.md`, last section). The kill switch is for "off for now".

## Rotate the API key

1. In the Anthropic Console, create a new API key (a name with the date helps you tell keys apart later).
2. Put it into the Worker:

   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

   Paste the key at the prompt. Do not pass it as an argument or pipe it in with `echo`; either way it ends up in your shell history. The command creates a new version of the deployed Worker with the new secret, so the next question uses it. No `npm run deploy` needed.
3. Ask one question (the `curl` above). Expect `200` and `"refused": false`.
4. In the Console, revoke the old key.
5. Update the other places that held the old key, if any: `CVBOT_API_KEY` in the cloud environment that runs the evals or in your shell, and `worker/.dev.vars` for `wrangler dev`. All of them are outside the repository.

If the key leaked, change the order: take the widget offline, revoke the old key in the Console first, then steps 1 to 3, then bring the widget back. Check the Console's usage page for spend you did not expect. Between revoking and putting the new key, every question gets "Not available right now." and the logs show `"reason":"model_error"` with `"model_status":401`.

The key is never in the repository: not in a file, a commit message or an issue. `CLAUDE.md`, non-negotiable 2, has the `git grep` to run before every commit.

## Raise or lower the spend cap

```sh
npx wrangler kv key get --remote --preview false --binding SPEND spend_cap_usd                # current cap
npx wrangler kv key get --remote --preview false --binding SPEND spend_$(date -u +%Y-%m)      # spent this month (UTC), USD
npx wrangler kv key put --remote --preview false --binding SPEND spend_cap_usd 10             # new cap, USD
```

- The cap is a plain decimal number of US dollars: `10`, `2.50`, `0.50` (not `.50`). Anything else (`$10`, `1e3`, `0`, a negative number, an empty value) is unreadable, and the Worker then refuses every question with `"reason":"cap_unknown"`.
- Before each model call the Worker adds a worst-case estimate of that call to this month's total and refuses with `"reason":"spend_cap"` if the result would exceed the cap. So answers stop a fraction of a cent before the cap, not after it.
- **Raising** the cap takes effect within about a minute, mid-month included.
- **Lowering** it below what is already spent stops answers until the next UTC month starts or you raise it again.
- A new month starts at zero on its own: the total lives under `spend_<yyyy-mm>` and the Worker starts a new key each month. Old months stay as a record.
- To reset the current month (for example after your own testing):

  ```sh
  npx wrangler kv key delete --remote --preview false --binding SPEND spend_$(date -u +%Y-%m)
  ```

- The cap counts only what this Worker spends. Eval runs and anything else on the same Anthropic account are not in it; a spend limit in the Anthropic Console covers the whole account.
- KV has no atomic increment, so two questions in the same instant can both pass the check. The total can overshoot the cap by about the cost of a question or two (`docs/decisions.md`, entry 2).

## Read the logs

The Worker writes one JSON line per `POST /ask`, refused or answered, and nothing for the `GET` routes. **The line never contains the question or the answer** (`CLAUDE.md`). If you ever see question text in the logs, that is a bug: take the widget offline and open an issue.

**Live**, while you reproduce something:

```sh
npx wrangler tail --format pretty                                 # every request
npx wrangler tail --format pretty --search '"refused":true'       # only refusals
npx wrangler tail --format pretty --search '"reason":"spend_cap"' # one reason
```

**Stored**: `wrangler.toml` turns on Workers Logs (`[observability]`). In the Cloudflare dashboard, open Workers & Pages, then `cv-bot`, then its logs view, and filter on the fields below. Retention is a few days, depending on the plan.

### Fields

| Field | Meaning |
| --- | --- |
| `event` | Always `"ask"`. |
| `status` | HTTP status returned: `200` answered, `400` bad input, `403` wrong origin, `429` rate limit, `503` everything else. |
| `refused` | `true` when the visitor did not get a model answer. A model answer that says "not done" or declines is still `false`. |
| `reason` | Why it was refused (next table), or `null` for an answer. |
| `question_length` | Length of the question in characters. Not its text. |
| `latency_ms` | Time spent in the Worker, model call included. |
| `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` | Token counts the API reported (answers only). |
| `cost_usd` | What that call cost, added to `spend_<yyyy-mm>` (answers only). |
| `stop_reason` | `"end_turn"` normally; `"max_tokens"` means the answer was cut at the 600-token limit. |
| `model_status`, `model_error_type` | On `model_error` only: the API's HTTP status and error type. Never its message. |
| `spend_write_failed` | `true` on an answer whose cost could not be added to the month's total. The total undercounts by that `cost_usd`. |

### Reasons

| `reason` | Status | Meaning | What to do |
| --- | --- | --- | --- |
| `disabled` | 503 | The kill switch: `enabled` is not `1`. | Expected while you have it off. Otherwise put `enabled 1`. |
| `material_hash` | 503 | The pinned `material_hash` is missing or does not match the deployed material. | Pin the hash of the deploy (`python scripts/bundle_material.py --check`, run from the repository root, prints it), if you approved that material. |
| `cap_unknown` | 503 | `spend_cap_usd` is missing or unreadable, or the configured `MODEL` has no price table. | Set the cap (previous section). |
| `spend_unknown` | 503 | This month's `spend_<yyyy-mm>` is not a number. | Read it; delete it if it is garbage (the month restarts from zero). |
| `spend_cap` | 503 | The cap would be exceeded. | Raise the cap or wait for the next month. |
| `rate_limited` | 429 | That IP asked 10 questions in 10 minutes. | Nothing, unless it is you testing. |
| `model_error` | 503 | The Anthropic API failed. `model_status` 401: the key is wrong or revoked, rotate it. 429 or 529: rate limit or overload on the API side, usually passes. 400: often a billing problem on the account. No status: the request did not reach the API. | Per status. Nothing was added to the spend. |
| `config` | 503 | The API key secret is missing, or a `[vars]` value in `wrangler.toml` is malformed. | `npx wrangler secret put ANTHROPIC_API_KEY`; check `[vars]`. |
| `kv_error` | 503 | KV could not be read or written. | Usually transient; check the Cloudflare status page. |
| `no_material` | 503 | The deployed bundle has no material. | Bundle the material and deploy (`docs/setup.md`). |
| `no_ip` | 503 | No `CF-Connecting-IP` header. Should not happen on Cloudflare. | Open an issue if it shows up. |
| `origin` | 403 | A browser on another site called `/ask`. | Nothing, unless it is your own page: then `ALLOWED_ORIGIN` does not match it (`web/embed.md`). |
| `bad_request`, `too_long` | 400 | Not a JSON question, or over 500 characters. | Nothing. |
| `internal` | 503 | An unexpected error in the Worker. | Open an issue with the time and the log line. |

To total the month from the logs, add up `cost_usd`; it should match `spend_<yyyy-mm>` unless a line has `spend_write_failed`.

## After a deploy

- If `material/` changed: pin the new hash, or every question is refused with `material_hash` (`docs/setup.md`, "Deploy").
- If `material/` or `web/widget.js`/`web/widget.css` changed: the widget version changed. Update `?v=` in the CV page snippet (`web/embed.md`, "What `?v=` does"). Optional: an outdated `?v=` still gets the current files, with a 5-minute cache.
