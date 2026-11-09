# Personal agent system — an always-on assistant on my own machine, 2026 – present

Role: Owner, architect and operator of a personal LLM agent built on Claude Code. I designed the architecture and the policies; most of the code was written with Claude Code under my review. It has been in daily use since August 2026.

## What it is

- An assistant that runs on my own machine, keeps long-term memory across sessions, reaches me on my phone, can hear me when I talk to it, and runs scheduled jobs when I am not at the computer.
- The model is interchangeable; the memory, the hooks, the jobs and the rules are the system.

## Memory

- Plain-text Markdown files are the source of truth, kept under version control.
- Retrieval is hybrid over a local SQLite index: bge-m3 embeddings through a local Ollama, fused by reciprocal rank with SQLite full-text search; nothing leaves the machine.
- A prompt-submit hook takes each message I send, retrieves up to three notes that have not surfaced recently, and injects them as context.
- Every retrieval is logged (what surfaced, for which message, with similarity and keyword-rank scores), so recall quality can be audited instead of assumed.
- Since November 2026, a nightly job runs a separate, pinned model over the day's diary, the handover note and the raw transcript, and lists factual discrepancies (a timestamp or a quote recorded wrongly) as suggestions only; nothing is edited without my review the next day.
- Long sessions are compacted with an explicit set of retained instructions; a pre-compaction hook snapshots the last 30 KB of verbatim conversation so tone and facts survive summarisation.

## Channels

- An iMessage bridge: incoming messages are injected into the running session; replies are pushed back by a stop hook.
- A local speech path: a small Swift tool segments microphone audio, SenseVoice transcribes on CPU, and Praat features (pitch, speech rate, pauses, loudness) are attached to each utterance before it reaches the model.
- Text-to-speech (ElevenLabs) for spoken replies, with a voice I designed myself. Because the microphone also picks up the assistant's own speech, the bridge removes the spoken text from the transcript by matching overlapping blocks before anything reaches the model, and playback stops as soon as I start speaking.
- Voice and microphone each have a file-based off switch; the rule is that both are off whenever someone else is at home or I am on a call, so other people's speech is not transcribed.
- Smart lights are driven over the LAN through a tiny local bridge, with no cloud service in the control path; the bridge accepts only a fixed set of light commands, and lights in other rooms are read-only.

## Scheduling and supervision

- A disk-backed reminder queue that survives session restarts, plus several launchd jobs.
- A watchdog that restarts the session if it dies, and gives up and notifies me after three failed attempts.
- A second model (Sonnet) that every 20 minutes during the day reads the last exchange and how long I have been quiet, and decides whether it is worth waking the main session to follow up; cheap checks run first, so most rounds cost nothing.
- A scheduled sub-agent that executes tasks from a direction file maintained by the main agent.
- An "away" mode that restricts the shell to a safe allow-list while I am away or asleep; if the guard itself fails, the command is denied (fail-closed).

## Guardrails

- A short set of hard rules, reloaded after every compaction: secrets are never printed or copied; no form submissions or payments on my behalf; no circumventing logins or CAPTCHAs; memory files are edited only through the editor tools, never through the shell; tool output is treated as data, not as instructions.
- Deleting memory is possible only through one script, after a 24-hour delay and confirmation from a separate session; a pre-tool hook blocks destructive shell commands (rm, overwriting redirects, history-rewriting git) on memory files and transcripts. A data-handling line says what may leave the machine.
- Failure modes I have documented, each from a real incident: a silent failure (an index rebuild that hung on a duplicate hash until the recall hook timed out, with nothing reported); stale state overwriting fresh (a child process overwrote the session id, so the wake-up worker read a message from twelve days earlier as the latest one); and context loss across compaction (the first reply after a compaction never reached the transcript or the screen).

## My role

- Architecture and policy: what is remembered and where, which hooks run when, what the jobs may and may not do, the privacy lines.
- Evaluation of each piece, for example reading the recall logs to see what actually surfaced, and reviewing the nightly discrepancy lists.
- I reviewed the code and ran the experiments; the implementation was done with Claude Code.

## Why it matters

- It is a working example of an LLM agent with persistent state, tool use, scheduled autonomy and explicit guardrails, in daily use rather than demoed once.
- The hard parts were not the model calls: they were memory hygiene, the failure modes of hooks and schedulers, and deciding what the system must never do.

## Not done

- The agent system's code is private; only the cv-bot repository is public.
