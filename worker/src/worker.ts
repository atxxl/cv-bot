// The request handler. `createWorker` takes the material, its hash and the
// system prompt as inputs so tests can run it against made-up material; the
// real entrypoint (index.ts) wires in the bundled ones.
//
// Response shape for /ask, on every status:
//   { answer: string, citations: string[], refused: boolean, material_hash: string }
// `refused` means the Worker did not return a model answer (limit, cap,
// switch off, bad input, any error). A model answer that itself says "not
// done" or declines is still `refused: false`: the Worker only reports what
// it did, not what the model decided.
//
// GET /material returns the bundled material itself,
//   { hash: string, lines: [{ id: string, text: string }, ...] }
// so the widget can quote the lines an answer cites. It is public and cheap
// (no model call, no KV, no rate limit) and cacheable for an hour.

import { extractCitations } from "./citations";
import { ConfigError, KV_KEYS, MAX_BODY_BYTES, MAX_QUESTION_CHARS, readAllowedOrigin, readConfig, type Config, type Env } from "./config";
import {
  KvError,
  formatUsd,
  kvGet,
  kvPut,
  monthOf,
  parseUsd,
  rateLimitKey,
  readRateLimit,
  recordRequest,
  type RateLimitState,
} from "./kv";
import type { MaterialLine } from "./material";
import { ModelError, askModel, costUsd, worstCaseCostUsd, type Usage } from "./model";

export interface WorkerDeps {
  material: readonly MaterialLine[];
  materialHash: string;
  systemPrompt: string;
  /** Outbound fetch for the model call. Tests inject a fake. */
  fetch?: typeof fetch;
  /** Clock in epoch ms. Tests inject a fixed one. */
  now?: () => number;
}

export const NOT_AVAILABLE = "Not available right now.";
/** GET /material changes only with a deploy; an hour of caching keeps repeat visitors from re-fetching it. */
export const MATERIAL_CACHE_CONTROL = "public, max-age=3600";
const ROUTES: ReadonlySet<string> = new Set(["/ask", "/material-hash", "/material"]);
const TOO_LONG = `Questions can be at most ${MAX_QUESTION_CHARS} characters.`;
const BAD_REQUEST = "Please send a question.";
const RATE_LIMITED = "You have asked several questions in a short time. Please try again in a few minutes.";

/** Why a request did not get a model answer. Logged; never contains text from the request. */
type RefusalReason =
  | "origin"
  | "bad_request"
  | "too_long"
  | "no_ip"
  | "config"
  | "no_material"
  | "kv_error"
  | "disabled"
  | "material_hash"
  | "cap_unknown"
  | "spend_unknown"
  | "rate_limited"
  | "spend_cap"
  | "model_error"
  | "internal";

interface AskLog {
  event: "ask";
  status: number;
  refused: boolean;
  reason: RefusalReason | null;
  question_length: number | null;
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd?: number;
  stop_reason?: string | null;
  model_status?: number;
  model_error_type?: string;
  spend_write_failed?: boolean;
}

class Refusal extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: RefusalReason,
    public readonly answer: string = NOT_AVAILABLE,
    public readonly headers: Record<string, string> = {},
    cause?: unknown,
  ) {
    super(reason, { cause });
    this.name = "Refusal";
  }
}

/** The system block sent to the model: prompt, then one line per material entry, prefixed with its id. */
export function buildSystemBlock(systemPrompt: string, material: readonly MaterialLine[]): string {
  const lines = material.map((line) => `${line.id}: ${line.text}`);
  return `${systemPrompt.trimEnd()}\n\n# Material\n\n${lines.join("\n")}\n`;
}

const BASE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function corsHeaders(origin: string | null, allowedOrigin: string | null, preflight = false): Record<string, string> {
  if (!origin || !allowedOrigin || origin !== allowedOrigin) return {};
  const headers: Record<string, string> = { "access-control-allow-origin": allowedOrigin, vary: "Origin" };
  if (preflight) {
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "Content-Type";
    headers["access-control-max-age"] = "86400";
  }
  return headers;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

/** `null` when the origin may call us (allowed, or no Origin header: not a browser cross-origin request). */
function originRejected(origin: string | null, allowedOrigin: string | null): boolean {
  return origin !== null && origin !== allowedOrigin;
}

/** ALLOWED_ORIGIN, or `null` when it is missing or malformed: then no origin is allowed. */
function allowedOriginOf(env: Env): string | null {
  try {
    return readAllowedOrigin(env);
  } catch {
    return null;
  }
}

async function readQuestion(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new Refusal(400, "bad_request", BAD_REQUEST);
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new Refusal(400, "bad_request", BAD_REQUEST);
  }
  if (text.length > MAX_BODY_BYTES) throw new Refusal(400, "bad_request", BAD_REQUEST);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Refusal(400, "bad_request", BAD_REQUEST);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Refusal(400, "bad_request", BAD_REQUEST);
  }
  const question = (parsed as Record<string, unknown>).question;
  if (typeof question !== "string") throw new Refusal(400, "bad_request", BAD_REQUEST);
  return question;
}

export function createWorker(deps: WorkerDeps): ExportedHandler<Env> {
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
  const knownIds: ReadonlySet<string> = new Set(deps.material.map((line) => line.id));
  const systemBlock = buildSystemBlock(deps.systemPrompt, deps.material);
  const materialBody = { hash: deps.materialHash, lines: deps.material.map(({ id, text }) => ({ id, text })) };

  function log(record: AskLog): void {
    console.log(JSON.stringify(record));
  }

  async function ask(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
    const started = now();
    let questionLength: number | null = null;
    let spendWriteFailed = false;

    const refuse = (r: Refusal): Response => {
      log({
        event: "ask",
        status: r.status,
        refused: true,
        reason: r.reason,
        question_length: questionLength,
        latency_ms: now() - started,
        ...(r.reason === "model_error" && r.cause instanceof ModelError
          ? { model_status: r.cause.status, model_error_type: r.cause.errorType }
          : {}),
      });
      return json(
        r.status,
        { answer: r.answer, citations: [], refused: true, material_hash: deps.materialHash },
        { ...cors, ...r.headers },
      );
    };

    try {
      // 1. Input. Nothing here touches KV or the model.
      const rawQuestion = await readQuestion(request);
      questionLength = rawQuestion.length;
      if (rawQuestion.length > MAX_QUESTION_CHARS) throw new Refusal(400, "too_long", TOO_LONG);
      const question = rawQuestion.trim();
      if (question === "") throw new Refusal(400, "bad_request", BAD_REQUEST);

      const ip = request.headers.get("cf-connecting-ip");
      if (!ip) throw new Refusal(503, "no_ip");

      let config: Config;
      try {
        config = readConfig(env);
      } catch (e) {
        if (e instanceof ConfigError) throw new Refusal(503, "config");
        throw e;
      }
      if (deps.material.length === 0) throw new Refusal(503, "no_material");

      // 2. Everything the Worker must verify before it may call the model.
      //    Read together, judged in a fixed order so the reason is stable.
      const month = monthOf(started);
      const rlKey = await rateLimitKey(ip);
      const windowMs = config.rateLimitWindowSeconds * 1000;
      let enabled: string | null;
      let pinnedHash: string | null;
      let capRaw: string | null;
      let spentRaw: string | null;
      let rate: RateLimitState;
      try {
        [enabled, pinnedHash, capRaw, spentRaw, rate] = await Promise.all([
          kvGet(env.SPEND, KV_KEYS.enabled),
          kvGet(env.SPEND, KV_KEYS.materialHash),
          kvGet(env.SPEND, KV_KEYS.spendCapUsd),
          kvGet(env.SPEND, KV_KEYS.spendMonth(month)),
          readRateLimit(env.RATE_LIMIT, rlKey, started, config.rateLimitQuestions, windowMs),
        ]);
      } catch (e) {
        if (e instanceof KvError) throw new Refusal(503, "kv_error");
        throw e;
      }

      if (enabled !== "1") throw new Refusal(503, "disabled");
      if (pinnedHash === null || pinnedHash.trim() !== deps.materialHash) throw new Refusal(503, "material_hash");
      const cap = parseUsd(capRaw);
      if (cap === null || cap <= 0) throw new Refusal(503, "cap_unknown");
      const spent = spentRaw === null ? 0 : parseUsd(spentRaw);
      if (spent === null) throw new Refusal(503, "spend_unknown");
      if (!rate.allowed) {
        throw new Refusal(429, "rate_limited", RATE_LIMITED, { "retry-after": String(rate.retryAfterSeconds) });
      }
      let estimate: number;
      try {
        estimate = worstCaseCostUsd(config.model, systemBlock.length + question.length, config.maxTokens);
      } catch {
        // No price table for the configured model: the cap cannot be enforced.
        throw new Refusal(503, "cap_unknown");
      }
      if (spent + estimate > cap) throw new Refusal(503, "spend_cap");

      // The slot is consumed before the call so a failing model cannot be retried for free.
      try {
        await recordRequest(env.RATE_LIMIT, rlKey, rate, started, config.rateLimitWindowSeconds);
      } catch (e) {
        if (e instanceof KvError) throw new Refusal(503, "kv_error");
        throw e;
      }

      // 3. The model.
      let answer;
      try {
        answer = await askModel(fetchImpl, {
          apiKey: config.apiKey,
          model: config.model,
          maxTokens: config.maxTokens,
          system: systemBlock,
          question,
        });
      } catch (e) {
        if (e instanceof ModelError) throw new Refusal(503, "model_error", NOT_AVAILABLE, {}, e);
        throw e;
      }
      const usage: Usage = answer.usage;
      const cost = costUsd(config.model, usage);

      // 4. Account for what was just spent. The money is gone either way, so a
      //    failed write does not withhold the answer; it is logged, and the next
      //    request fails closed on its own rate-limit write if KV stays down.
      try {
        await kvPut(env.SPEND, KV_KEYS.spendMonth(month), formatUsd(spent + cost));
      } catch {
        spendWriteFailed = true;
      }

      const citations = extractCitations(answer.text, knownIds);
      log({
        event: "ask",
        status: 200,
        refused: false,
        reason: null,
        question_length: questionLength,
        latency_ms: now() - started,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cost_usd: cost,
        stop_reason: answer.stopReason,
        ...(spendWriteFailed ? { spend_write_failed: true } : {}),
      });
      return json(200, { answer: answer.text, citations, refused: false, material_hash: deps.materialHash }, cors);
    } catch (e) {
      if (e instanceof Refusal) return refuse(e);
      // Anything unexpected is still a closed failure, logged without detail
      // that could carry request text.
      return refuse(new Refusal(503, "internal"));
    }
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      const allowedOrigin = allowedOriginOf(env);
      const route = ROUTES.has(url.pathname) ? url.pathname : null;

      if (route === null) return json(404, { error: "not found" });

      if (originRejected(origin, allowedOrigin)) {
        if (url.pathname === "/ask" && request.method === "POST") {
          log({ event: "ask", status: 403, refused: true, reason: "origin", question_length: null, latency_ms: 0 });
        }
        return json(403, { answer: NOT_AVAILABLE, citations: [], refused: true, material_hash: deps.materialHash });
      }

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigin, true) });
      }
      const cors = corsHeaders(origin, allowedOrigin);

      if (route === "/material-hash" && request.method === "GET") {
        return json(200, { hash: deps.materialHash }, cors);
      }
      if (route === "/material" && request.method === "GET") {
        // Public material, no switches, no KV, no log line. `Vary: Origin` is
        // sent even without CORS headers because the response is cacheable.
        return json(200, materialBody, { ...cors, vary: "Origin", "cache-control": MATERIAL_CACHE_CONTROL });
      }
      if (route === "/ask" && request.method === "POST") {
        return ask(request, env, cors);
      }
      return json(404, { error: "not found" }, cors);
    },
  };
}
