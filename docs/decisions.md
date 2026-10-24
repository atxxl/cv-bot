# Decisions

One entry per decision. Newest at the bottom. Each entry says what was decided, why, and what would make us revisit it.

## 1. Cloudflare Worker + Claude Haiku 4.5 (2026-10)

**Decision.** The bot runs as a single Cloudflare Worker that holds the Anthropic API key and calls `claude-haiku-4-5-20251001` with `max_tokens` 600 and temperature 0. The widget on the CV page talks only to the Worker.

**Why: key custody.** The CV page is static and public. Any key shipped to the browser is public too. A Worker keeps the key in Cloudflare's secret store (`wrangler secret put`), so the browser never sees it and the repo never contains it.

**Why: cost ceiling.** The Worker sits in front of every model call, so it can enforce a per-IP rate limit (10 questions / 10 minutes) and a monthly USD spend cap stored in KV, and refuse before calling the model when either is exceeded. If it cannot read either value, it fails closed. Haiku 4.5 is the cheapest model that handles grounded question answering with citations well enough for this use; the answer set is small and the context (system prompt + material) is short, so per-question cost stays in fractions of a cent and the monthly cap can be set low.

**Why not alternatives.** A serverless function on another provider would work the same way; Cloudflare was chosen because the Worker free tier and KV cover this traffic, and `wrangler` keeps the deploy to one command. A larger model (Sonnet) is reserved for the eval judge in `evals/`, where cost per call matters less and judgement quality matters more.

**Revisit if.** The spend cap is hit regularly on real traffic, Haiku's faithfulness score in the evals is not good enough, or Cloudflare changes Worker/KV pricing in a way that makes the free tier insufficient.
