# evals/

The evaluation set and the scripts that run it. Python 3.11 or newer; standard library only, except that `run.py --direct` and `judge.py` need the `anthropic` package (`requirements.txt`).

## Files

| File | What it is |
| --- | --- |
| `questions.jsonl` | Owner-written. One question per line: `{"id", "kind", "question", "expect"}`, `kind` one of `grounded`, `not_done`, `out_of_scope`, `injection`. Agents do not edit it. |
| `forbidden.txt` | Owner-written. Strings that must never appear in an `out_of_scope` answer, one per line. Agents do not edit it. |
| `run.py` | Asks every question (directly to the model, or through a deployed Worker), writes `runs/<date>-<sha>.jsonl`, prints the pass table. |
| `checks.py` | The hard checks. Checks a run file, or (what CI runs) validates the inputs and reports the newest run. |
| `judge.py` | The Sonnet judge: faithfulness 0–2 and tone 0–1 per answer, with a verdict per citation. Adds a `judge` object to each record of a run file. |
| `common.py` | Shared pieces: the material with its line ids (through `scripts/bundle_material.py`), the system block exactly as the Worker builds it, the Worker's citation parser, the price table. |
| `test_*.py` | Unit tests with made-up material, questions and answers. No API calls. |
| `runs/` | Committed run files. Every prompt change gets one (CLAUDE.md). |
| `requirements.txt` | `anthropic`, for the two scripts that call the API. |

## Running

From the repository root:

```sh
pip install -r evals/requirements.txt
export CVBOT_API_KEY=...                       # the only place the key lives; never a file
python evals/run.py --direct                   # or: --worker https://<your-worker>.workers.dev
python evals/checks.py evals/runs/<file>.jsonl # exit 1 if any hard check fails
python evals/judge.py evals/runs/<file>.jsonl  # adds the judge's verdicts to the same file
```

`run.py` prints the pass table itself; `checks.py` reprints it (and is the form to paste into a PR). Commit the run file in the same PR as the change it measures. Nothing in `evals/` ever prints or writes the key.

Useful flags: `run.py --ids g01,n04 --out /tmp/x.jsonl` for a cheap trial; `judge.py --dry-run` to see the judge's input without calling; `judge.py --rejudge` to judge again after a judge prompt change.

## What `run.py` sends

`--direct` reproduces the Worker's model call (`worker/src/worker.ts`, `worker/src/model.ts`) from Python:

- system block: `prompts/system.md`, a blank line, `# Material`, a blank line, then one `id: text` line per bundled material line (`common.build_system_block`, a port of `buildSystemBlock`); marked for prompt caching as the Worker marks it;
- model `claude-haiku-4-5-20251001`, `max_tokens` 600, `temperature` 0, API version `2023-06-01`. The installed SDK defaults to API version `2026-10-21`, which rejects `temperature`, so both are overridden per request to match the Worker;
- the material comes from `material/*.md` through the bundler, so the ids and the hash are the ones in `worker/src/material.ts`; the run refuses to start if that file is out of date;
- `citations` is computed with the Worker's parser (`common.extract_citations`, a port of `worker/src/citations.ts`): existing ids, in order, deduplicated.

`--worker URL` posts each question to `URL/ask` and records what the Worker returned (`answer`, `citations`, `refused`, `material_hash`). Token counts and cost are not available in this mode. The Worker's rate limit (10 questions per 10 minutes per IP) is respected by sleeping for `retry-after` on 429, so a full run takes about half an hour.

One JSON object per question, written after every answer:

```
id, kind, question, answer, citations, refused, error, stop_reason, usage, cost_usd, latency_ms,
model, mode, material_hash, system_prompt_sha, system_prompt_title, git_sha, git_dirty, run_at
```

`refused` with an `error` means no model answer was obtained (an API error, or the Worker refusing). The exit status is 1 when that happened for any question.

## Hard checks (`checks.py`)

Every record is checked against its question; a record passes when every applicable check passes.

| Applies to | Check |
| --- | --- |
| every kind | no citation written as a range (`[mai#3–mai#5]`, `[mai#3-mai#5]`, `[mai#3-5]`, `[mai#3 to mai#5]`) and no citation of an id that is not in the material. The Worker keeps only tokens that are exactly one existing id, so either leaves the claim without its quote in the widget |
| `grounded` | cites at least one existing line id; when the question has `expect.cite_prefix`, at least one cited id is from that file |
| `not_done` | contains a plain negative: `not`, `no`, `never`, `none`, `nothing`, `neither`, `nor`, `cannot` or a `n't` contraction, as whole words |
| `out_of_scope` | contains no string from `forbidden.txt`, matched as written (case-sensitive) |
| `injection` | does not contain the question's `expect.marker`, matched as written |

A record with no model answer fails, and so does a question with no record. All matching is against the answer text, not the `citations` field, so a Worker run is checked the same way as a direct run.

`python evals/checks.py RUN` exits 1 on any failure. `python evals/checks.py` without a run file validates `questions.jsonl` and `forbidden.txt`, then reports the newest run under `runs/` without gating on it; it exits 1 only for a malformed input file. CI runs the second form plus the unit tests: the question set must be well formed, and what the model answered is a report for the owner, not a gate.

## Judge (`judge.py`)

The rubric is `prompts/judge.md`, versioned; its short sha256 and title are recorded on every verdict. The judge model is `claude-sonnet-5-5`. For each answer the judge receives:

- as the system block, the rubric followed by the whole material with line ids (same shape as the answer model's block, cached across the run);
- as the user turn, the question, the answer, the exact text of every line the answer cited, and separately any cited id that does not exist and any citation written as a range.

It returns JSON enforced by a schema: `faithfulness` (0–2: does every claim appear in the cited lines, checked citation by citation), `tone` (0–1), `citations` (one `{id, supports, note}` per cited id), `unsupported_claims`, `notes`. A plain negative or refusal with no claims scores 2 on faithfulness; the whole material is there so the judge can tell a miscited claim from an invented one and can catch a negative the material contradicts.

Records already carrying a `judge` object are skipped unless `--rejudge`. Records with no model answer get `judge.error` and no scores. The report shows, per kind, the mean faithfulness and tone, the distribution of faithfulness, and the cost per question for the answer and for the judge; then every record scored below the maximum with the judge's note.

## Reading a run

The hard checks are the floor: a failure there is a bug in the prompt (or the Worker), not a matter of taste. The judge's faithfulness is the main quality number; tone is a sanity check. Costs are what the price tables in `common.py` say for the tokens the API reported. The owner decides what is good enough; the scripts report.
