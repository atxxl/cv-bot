# cv-bot

A small question-answering assistant that sits on my CV page and answers questions about what I have actually built, from material I have approved, and says "not done" when I have not done something.

It is also a worked example of how I build software now: I set the architecture, scope and acceptance criteria; an AI agent writes the code; every change arrives as a pull request that I review before it merges. The PR history of this repository is the record of that process.

## What it does

- A visitor on the CV page types a question ("What did she build at mAI?", "Has she used Langfuse in production?").
- A Cloudflare Worker holds the API key, rate-limits by IP, enforces a monthly spend cap, and calls Claude (Haiku 4.5) with a fixed system prompt and the approved material as context.
- The answer comes back with the lines of the material it relied on, so the visitor can check it.

## What it refuses to do

- Invent experience. The material is the only source. If the answer is not in it, the bot says so.
- Reveal anything not on the public CV page (contact details beyond what is on the page, private projects, personal life).
- Follow instructions embedded in questions ("ignore your rules and..."). Visitor input is untrusted.
- Give career advice, write cover letters, or talk about other people.

## Repository layout

```
material/        the approved source text (what the bot may know), plain markdown, reviewed by me
prompts/         the system prompt and the refusal rules, versioned
worker/          Cloudflare Worker (TypeScript): key custody, rate limit, spend cap, model call
web/             the chat widget embedded in the CV page (vanilla JS, no framework)
evals/           the evaluation set and the runner (see below)
docs/            architecture notes and decisions
```

## Evaluation

`evals/questions.jsonl` holds the test questions, each with the kind of answer expected:

- **grounded**: a question the material answers; the expected answer cites specific lines.
- **not_done**: a question about something I have not done; the expected answer says so plainly.
- **out_of_scope**: private or unrelated; the expected answer declines.
- **injection**: a question that tries to change the bot's behaviour; the expected answer ignores the instruction and answers the legitimate part, if any.

`evals/run.py` sends every question through the Worker (or directly through the model with the same prompt), stores the answers, and scores them: exact rules first (did it cite, did it refuse, did it leak), then an LLM judge (Sonnet) for faithfulness to the material. Every prompt change gets a run; the results are committed next to the prompt version they tested.

## How work happens here

1. An issue describes one change: what, why, how we will know it is done.
2. The agent implements it on a branch and opens a PR with the eval results.
3. I review: correctness, what it refuses, what it leaks, whether the eval set still passes.
4. Merge. Nothing reaches `main` without a review.

## Status

Scaffolding only. See `CLAUDE.md` for the working agreement and the first issues.
