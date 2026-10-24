// Shared test fixtures. Everything here is made up: the material is invented
// text, not the owner's, so no fact about the owner lives in the tests.

import { createExecutionContext } from "cloudflare:test";
import { env as baseEnv } from "cloudflare:workers";
import type { Env } from "../src/config";
import { KV_KEYS } from "../src/config";
import type { MaterialLine } from "../src/material";
import type { Usage } from "../src/model";
import { createWorker, type WorkerDeps } from "../src/worker";

export const ALLOWED_ORIGIN = "https://atxxl.github.io";
export const OTHER_ORIGIN = "https://evil.example";
export const IP_A = "203.0.113.10";
export const IP_B = "203.0.113.11";

/** 2026-10-24T12:00:00Z. Spend for this month lives under `spend_2026-10`. */
export const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
export const MONTH_KEY = KV_KEYS.spendMonth("2026-10");

export const FAKE_MATERIAL: MaterialLine[] = [
  { id: "sample#1", text: "# Sample project" },
  { id: "sample#2", text: "Built a widget that counts purple umbrellas." },
  { id: "sample#3", text: "Used the Zorblax framework for the counting." },
  { id: "other#1", text: "Taught umbrella counting to a team of three." },
];
export const FAKE_HASH = "0123456789ab";
export const FAKE_PROMPT = "Answer from the material only and cite line ids in square brackets.";
export const DEFAULT_ANSWER = "A widget that counts purple umbrellas [sample#2].";
export const DEFAULT_USAGE: Usage = {
  input_tokens: 1000,
  output_tokens: 100,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};
/** Cost of DEFAULT_USAGE at Haiku 4.5 prices: 1000 * $1/M + 100 * $5/M. */
export const DEFAULT_COST_USD = 0.0015;

export interface ModelCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

export interface FakeModel {
  fetch: typeof fetch;
  calls: ModelCall[];
}

export function modelReply(text: string, usage: Partial<Usage> = {}, stopReason = "end_turn"): Response {
  return Response.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    usage: { ...DEFAULT_USAGE, ...usage },
  });
}

export function modelError(status: number, type: string, message: string): Response {
  return Response.json({ type: "error", error: { type, message } }, { status });
}

/** A stand-in for the Anthropic API: records every request and answers with `reply`. */
export function fakeModel(reply: (call: ModelCall) => Response | Promise<Response> = () => modelReply(DEFAULT_ANSWER)): FakeModel {
  const calls: ModelCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const call: ModelCall = { url: request.url, method: request.method, headers, body: await request.json() };
    calls.push(call);
    return reply(call);
  };
  return { fetch: fetchImpl, calls };
}

export interface Clock {
  t: number;
  now: () => number;
}

export function clock(start = NOW): Clock {
  const c: Clock = { t: start, now: () => c.t };
  return c;
}

export function worker(overrides: Partial<WorkerDeps> = {}): ExportedHandler<Env> {
  return createWorker({
    material: FAKE_MATERIAL,
    materialHash: FAKE_HASH,
    systemPrompt: FAKE_PROMPT,
    now: () => NOW,
    ...overrides,
  });
}

/** The test env from wrangler.toml, plus a fake key. Spread overrides to vary one thing. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...baseEnv, ANTHROPIC_API_KEY: "test-key-not-real", ALLOWED_ORIGIN, ...overrides } as Env;
}

/** Flip every KV switch to "answering" with a $5 monthly cap. */
export async function enableBot(env: Env, options: { cap?: string; spent?: string; hash?: string } = {}): Promise<void> {
  await env.SPEND.put(KV_KEYS.enabled, "1");
  await env.SPEND.put(KV_KEYS.materialHash, options.hash ?? FAKE_HASH);
  await env.SPEND.put(KV_KEYS.spendCapUsd, options.cap ?? "5");
  if (options.spent !== undefined) await env.SPEND.put(MONTH_KEY, options.spent);
}

/** A KV namespace whose reads fail, to simulate KV being down. Writes still go to `real`. */
export function unreadableKv(real: KVNamespace): KVNamespace {
  return {
    get: () => Promise.reject(new Error("kv unavailable")),
    put: (...args: Parameters<KVNamespace["put"]>) => real.put(...args),
  } as unknown as KVNamespace;
}

/** Same, but writes fail and reads work. */
export function unwritableKv(real: KVNamespace): KVNamespace {
  return {
    get: (...args: Parameters<KVNamespace["get"]>) => (real.get as (...a: unknown[]) => Promise<unknown>)(...args),
    put: () => Promise.reject(new Error("kv unavailable")),
  } as unknown as KVNamespace;
}

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

export interface AskOptions {
  origin?: string | null;
  ip?: string | null;
  /** Raw body instead of `{question}`. */
  rawBody?: string;
  headers?: Record<string, string>;
}

export function askRequest(question: string, options: AskOptions = {}): Request<unknown, IncomingRequestCfProperties> {
  const headers = new Headers({ "content-type": "application/json", ...(options.headers ?? {}) });
  if (options.origin !== null) headers.set("origin", options.origin ?? ALLOWED_ORIGIN);
  if (options.ip !== null) headers.set("cf-connecting-ip", options.ip ?? IP_A);
  return new IncomingRequest("https://cv-bot.example/ask", {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify({ question }),
  });
}

export interface SimpleInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export function request(path: string, init: SimpleInit = {}, options: { origin?: string | null } = {}): Request<unknown, IncomingRequestCfProperties> {
  const headers = new Headers(init.headers);
  if (options.origin !== null) headers.set("origin", options.origin ?? ALLOWED_ORIGIN);
  return new IncomingRequest(`https://cv-bot.example${path}`, { method: init.method, body: init.body, headers });
}

export async function call(handler: ExportedHandler<Env>, req: Request<unknown, IncomingRequestCfProperties>, env: Env): Promise<Response> {
  if (!handler.fetch) throw new Error("handler has no fetch");
  return handler.fetch(req, env, createExecutionContext());
}

export interface AskBody {
  answer: string;
  citations: string[];
  refused: boolean;
  material_hash: string;
}

export async function askJson(res: Response): Promise<AskBody> {
  return (await res.json()) as AskBody;
}
