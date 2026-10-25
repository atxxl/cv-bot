// The one place that talks to the Anthropic Messages API, plus the price
// table used for the spend cap. Raw fetch, no SDK: the Worker has no runtime
// dependencies, and the request is a single JSON POST.

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
const MODEL_TIMEOUT_MS = 30_000;

/** USD per million tokens. Only models listed here may be called: the cap needs a price. */
export const PRICES_USD_PER_MTOK: Readonly<
  Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }>
> = {
  // Claude Haiku 4.5: $1 in, $5 out; 5-minute cache writes 1.25x, cache reads 0.1x.
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ModelAnswer {
  text: string;
  usage: Usage;
  stopReason: string | null;
}

export class ModelError extends Error {
  constructor(
    message: string,
    /** HTTP status of the API response, when there was one. */
    public readonly status?: number,
    /** `error.type` from the API error body, when there was one. Never the message. */
    public readonly errorType?: string,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

/** Cost of one call from the usage the API reported. */
export function costUsd(model: string, usage: Usage): number {
  const p = PRICES_USD_PER_MTOK[model];
  if (!p) throw new ModelError(`no price table for model ${model}`);
  return (
    (usage.input_tokens * p.input +
      usage.cache_creation_input_tokens * p.cacheWrite +
      usage.cache_read_input_tokens * p.cacheRead +
      usage.output_tokens * p.output) /
    1_000_000
  );
}

/**
 * Upper bound on what the next call can cost, used before calling: every
 * input character counted at a third of a token (an overestimate for English
 * prose) and priced as a cache write, plus the full output budget.
 */
export function worstCaseCostUsd(model: string, inputChars: number, maxTokens: number): number {
  const p = PRICES_USD_PER_MTOK[model];
  if (!p) throw new ModelError(`no price table for model ${model}`);
  const inputTokens = Math.ceil(inputChars / 3);
  return (inputTokens * p.cacheWrite + maxTokens * p.output) / 1_000_000;
}

export interface ModelRequest {
  apiKey: string;
  model: string;
  maxTokens: number;
  /** System prompt plus material; identical on every request so it can be cached. */
  system: string;
  question: string;
}

function usageFrom(raw: unknown): Usage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const u = raw as Record<string, unknown>;
  const num = (k: string): number => (typeof u[k] === "number" && Number.isFinite(u[k]) ? (u[k] as number) : 0);
  if (typeof u.input_tokens !== "number" || typeof u.output_tokens !== "number") return null;
  return {
    input_tokens: num("input_tokens"),
    output_tokens: num("output_tokens"),
    cache_creation_input_tokens: num("cache_creation_input_tokens"),
    cache_read_input_tokens: num("cache_read_input_tokens"),
  };
}

export async function askModel(fetchImpl: typeof fetch, req: ModelRequest): Promise<ModelAnswer> {
  const body = {
    model: req.model,
    max_tokens: req.maxTokens,
    temperature: 0,
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [{ type: "text", text: req.question }] }],
  };

  let response: Response;
  try {
    response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": req.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
  } catch {
    throw new ModelError("model request failed");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ModelError("model response is not JSON", response.status);
  }
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;

  if (!response.ok) {
    const err = (typeof p.error === "object" && p.error !== null ? p.error : {}) as Record<string, unknown>;
    throw new ModelError("model returned an error", response.status, typeof err.type === "string" ? err.type : undefined);
  }

  const usage = usageFrom(p.usage);
  if (!usage || !Array.isArray(p.content)) throw new ModelError("model response has an unexpected shape", response.status);
  const text = p.content
    .filter((b): b is { type: string; text: string } => typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
  if (text === "") throw new ModelError("model returned no text", response.status);

  return { text, usage, stopReason: typeof p.stop_reason === "string" ? p.stop_reason : null };
}
