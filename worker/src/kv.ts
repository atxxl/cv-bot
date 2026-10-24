// KV access for the two things the Worker must verify before calling the
// model: the per-IP rate limit and the monthly spend. Every KV failure is a
// KvError; the handler maps it to a 503 and never calls the model.

export class KvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KvError";
  }
}

export async function kvGet(kv: KVNamespace, key: string): Promise<string | null> {
  try {
    return await kv.get(key);
  } catch {
    throw new KvError(`cannot read ${key}`);
  }
}

export async function kvPut(
  kv: KVNamespace,
  key: string,
  value: string,
  options?: KVNamespacePutOptions,
): Promise<void> {
  try {
    await kv.put(key, value, options);
  } catch {
    throw new KvError(`cannot write ${key}`);
  }
}

/** Parse a non-negative USD amount stored as a decimal string. `null` when it is not one. */
export function parseUsd(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Fixed-point USD string for KV. Eight decimals is far below one token's price. */
export function formatUsd(amount: number): string {
  return amount.toFixed(8);
}

/** `yyyy-mm` in UTC for the spend key of the month containing `now` (epoch ms). */
export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** Rate-limit key for a client IP. The IP itself is never stored, only its SHA-256. */
export async function rateLimitKey(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `ip:${hex}`;
}

export interface RateLimitState {
  /** Request timestamps (epoch ms) still inside the window, oldest first. */
  stamps: number[];
  allowed: boolean;
  /** Seconds until the oldest counted request leaves the window. 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * Sliding-window log: the value under `key` is a JSON array of request
 * timestamps. A request is allowed while fewer than `limit` of them fall
 * inside the last `windowMs`.
 */
export async function readRateLimit(
  kv: KVNamespace,
  key: string,
  now: number,
  limit: number,
  windowMs: number,
): Promise<RateLimitState> {
  const raw = await kvGet(kv, key);
  let stamps: number[] = [];
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        stamps = parsed.filter((t): t is number => typeof t === "number" && Number.isFinite(t));
      }
    } catch {
      // An unreadable value counts as an empty window rather than a lockout;
      // the next write replaces it.
      stamps = [];
    }
  }
  const cutoff = now - windowMs;
  stamps = stamps.filter((t) => t > cutoff && t <= now).sort((a, b) => a - b);
  if (stamps.length >= limit) {
    const oldest = stamps[stamps.length - limit] ?? stamps[0];
    return { stamps, allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }
  return { stamps, allowed: true, retryAfterSeconds: 0 };
}

/** Append `now` to the window and persist it. The entry expires with the window. */
export async function recordRequest(
  kv: KVNamespace,
  key: string,
  state: RateLimitState,
  now: number,
  windowSeconds: number,
): Promise<void> {
  const stamps = [...state.stamps, now];
  // KV requires expirationTtl >= 60 seconds.
  await kvPut(kv, key, JSON.stringify(stamps), { expirationTtl: Math.max(60, windowSeconds) });
}
