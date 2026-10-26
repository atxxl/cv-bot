# Decisions

One entry per decision. Newest at the bottom. Each entry says what was decided, why, and what would make us revisit it.

## 1. Cloudflare Worker + Claude Haiku 4.5 (2026-10)

**Decision.** The bot runs as a single Cloudflare Worker that holds the Anthropic API key and calls `claude-haiku-4-5-20251001` with `max_tokens` 600 and temperature 0. The widget on the CV page talks only to the Worker.

**Why: key custody.** The CV page is static and public. Any key shipped to the browser is public too. A Worker keeps the key in Cloudflare's secret store (`wrangler secret put`), so the browser never sees it and the repo never contains it.

**Why: cost ceiling.** The Worker sits in front of every model call, so it can enforce a per-IP rate limit (10 questions / 10 minutes) and a monthly USD spend cap stored in KV, and refuse before calling the model when either is exceeded. If it cannot read either value, it fails closed. Haiku 4.5 is the cheapest model that handles grounded question answering with citations well enough for this use; the answer set is small and the context (system prompt + material) is short, so per-question cost stays in fractions of a cent and the monthly cap can be set low.

**Why not alternatives.** A serverless function on another provider would work the same way; Cloudflare was chosen because the Worker free tier and KV cover this traffic, and `wrangler` keeps the deploy to one command. A larger model (Sonnet) is reserved for the eval judge in `evals/`, where cost per call matters less and judgement quality matters more.

**Revisit if.** The spend cap is hit regularly on real traffic, Haiku's faithfulness score in the evals is not good enough, or Cloudflare changes Worker/KV pricing in a way that makes the free tier insufficient.

## 2. Rate limit and switches in KV, not in a Durable Object (2026-10)

**Decision.** The per-IP rate limit is a sliding-window log in Workers KV: one key per hashed IP holding the timestamps of the last requests, expiring with the window. The spend cap, the monthly running total, the kill switch (`enabled`) and the pinned material hash are plain KV keys in the `SPEND` namespace that the owner sets with `wrangler kv key put`. No Durable Object.

**Why: enough for the traffic, nothing to operate.** A CV page gets a handful of questions a day. KV is already in the stack for the spend cap, the free tier covers the reads, and a key the owner can read and write from the command line doubles as the operations console: switching the bot off, raising the cap, resetting a month, or pinning a material version is one command and no deploy. A Durable Object would give exact counting under concurrency but adds a class, a migration and a second storage model to review.

**What KV does not give.** KV is eventually consistent and has no atomic increment, so two requests from the same IP in the same instant can both pass the limit check, and two concurrent model calls can both pass the cap check. The counters are therefore approximate by a request or two. The cap check uses a worst-case estimate of the next call (all input priced as a cache write plus the full output budget), so the total can only overshoot the cap by the few concurrent calls that slip through, not by a whole call's unknown price. KV also allows one write per second per key; a client hammering one IP will see writes fail, and a failed write fails closed.

**Fail closed, in order.** `/ask` reads the switches and the counters before anything else and refuses, without a model call, when any of them is missing, malformed or unreadable: `enabled` not `"1"`, `material_hash` not equal to the bundled hash, no parsable `spend_cap_usd`, an unparsable monthly total, KV errors, no client IP, no API key, no price table for the configured model, an empty material bundle. A model error also refuses and leaves the total untouched. The pinned hash is the one check that needs an owner action after a material change; it is deliberate: the deployed material must be the version the owner approved.

**Revisit if.** Real traffic shows the approximate counting matters (the cap is overshot or an IP gets past the limit), in which case a Durable Object per IP (and one for the monthly total) is the drop-in replacement; or if the pin step turns out to be more nuisance than safety.

## 3. Citation text comes from `GET /material`, not from a static `web/material.json` (2026-10)

**Decision.** The Worker serves the bundled material at `GET /material` as `{hash, lines: [{id, text}]}`, with the same origin check and CORS headers as the other routes, `cache-control: public, max-age=3600`, no rate limit and no log line. The widget fetches it lazily, once per page load, the first time an answer cites something, and renders each cited id as an expandable quote of that line. A cited id that is not in the fetched material is shown as the id alone.

**Why: one bundle, one hash, nothing to keep in sync.** The alternative was a `web/material.json` written by `scripts/bundle_material.py` next to `material.ts` and copied onto the CV page by hand. That is a second artefact of the same material living in a different repository, and the two would drift: a material change deployed to the Worker but not copied to the page would show quotes from one version under answers from another, with no way for the visitor to tell. With the endpoint, the Worker that answered is the Worker that quotes, and the `hash` in `/material` is the `material_hash` in `/ask`; the widget compares the two and refetches past the HTTP cache once if they differ (a deploy between two questions).

**Why it is safe and cheap.** The material is public by definition (it is the CV page's content, and the model quotes it in answers), so serving it whole leaks nothing. There is no model call and no KV read behind the route, so it needs no spend cap and no rate limit; a Worker invocation that returns a few kilobytes of static JSON is within the free tier at any plausible traffic. An hour of caching means a returning visitor fetches it at most once per hour.

**What it costs.** One extra `GET` per page load that gets an answer with citations, a public route that lists the material (the whole bundle, not just cited lines), and the `localhost`-only plain-http exception in `ALLOWED_ORIGIN` added in the same change so the demo page can talk to `wrangler dev` without a certificate.

**Revisit if.** The material grows past what is reasonable to send whole (tens of kilobytes), in which case the route can take `?ids=` and return only the cited lines; or the CV page and the Worker end up with a shared build, in which case a static file generated by that build is the simpler artefact.
