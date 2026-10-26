// Bindings and non-secret configuration of the Worker.
//
// Everything here is read once per request and validated. Anything missing or
// malformed is a ConfigError, which the handler turns into a 503 "not available
// right now" before any model call (fail closed).

export interface Env {
  /** Per-IP sliding-window counters (wrangler.toml binding RATE_LIMIT). */
  RATE_LIMIT: KVNamespace;
  /** Operational switches and spend accounting (wrangler.toml binding SPEND). */
  SPEND: KVNamespace;
  /** Secret, set with `wrangler secret put ANTHROPIC_API_KEY`. Never in the repo. */
  ANTHROPIC_API_KEY?: string;
  MODEL?: string;
  MAX_TOKENS?: string;
  RATE_LIMIT_QUESTIONS?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  /** The only origin allowed to call the Worker from a browser. */
  ALLOWED_ORIGIN?: string;
}

export interface Config {
  apiKey: string;
  model: string;
  maxTokens: number;
  rateLimitQuestions: number;
  rateLimitWindowSeconds: number;
  allowedOrigin: string;
}

/** Longest question the Worker forwards to the model, in UTF-16 code units (JS string length). */
export const MAX_QUESTION_CHARS = 500;

/** Largest request body the Worker reads before giving up on it. */
export const MAX_BODY_BYTES = 16 * 1024;

/** Keys in the SPEND namespace. Documented in docs/setup.md. */
export const KV_KEYS = {
  /** Must be exactly "1" for the bot to answer at all. */
  enabled: "enabled",
  /** Must equal the MATERIAL_HASH bundled into the deployed Worker. */
  materialHash: "material_hash",
  /** Monthly USD ceiling, a decimal string such as "5" or "2.50". */
  spendCapUsd: "spend_cap_usd",
  /** Running total for one month, `spend_<yyyy-mm>` (UTC), a decimal string in USD. */
  spendMonth: (yyyyMm: string): string => `spend_${yyyyMm}`,
} as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function positiveInt(name: string, raw: string | undefined): number {
  const n = Number(raw);
  if (raw === undefined || raw.trim() === "" || !Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`${name} must be a positive integer`);
  }
  return n;
}

/** Hosts that may be allowed over plain http: a local demo page against `wrangler dev` (docs/setup.md). */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * ALLOWED_ORIGIN, validated: an https origin with no path, or an http origin
 * on localhost for local development. Read on every request, before anything else.
 */
export function readAllowedOrigin(env: Env): string {
  const raw = env.ALLOWED_ORIGIN;
  if (!raw) throw new ConfigError("ALLOWED_ORIGIN is not set");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError("ALLOWED_ORIGIN is not a valid origin");
  }
  if (parsed.origin !== raw) throw new ConfigError("ALLOWED_ORIGIN must be an origin without a path");
  const localHttp = parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new ConfigError("ALLOWED_ORIGIN must be an https origin (http is allowed for localhost only)");
  }
  return raw;
}

export function readConfig(env: Env): Config {
  if (!env.ANTHROPIC_API_KEY) throw new ConfigError("ANTHROPIC_API_KEY is not set");
  if (!env.MODEL) throw new ConfigError("MODEL is not set");
  return {
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.MODEL,
    maxTokens: positiveInt("MAX_TOKENS", env.MAX_TOKENS),
    rateLimitQuestions: positiveInt("RATE_LIMIT_QUESTIONS", env.RATE_LIMIT_QUESTIONS),
    rateLimitWindowSeconds: positiveInt("RATE_LIMIT_WINDOW_SECONDS", env.RATE_LIMIT_WINDOW_SECONDS),
    allowedOrigin: readAllowedOrigin(env),
  };
}
