import { KV_KEYS, MAX_QUESTION_CHARS } from "../src/config";
import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION } from "../src/model";
import { MATERIAL_CACHE_CONTROL } from "../src/worker";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_ORIGIN,
  DEFAULT_ANSWER,
  DEFAULT_COST_USD,
  FAKE_HASH,
  FAKE_MATERIAL,
  FAKE_PROMPT,
  IP_A,
  IP_B,
  MONTH_KEY,
  NOW,
  OTHER_ORIGIN,
  askJson,
  askRequest,
  call,
  clock,
  enableBot,
  fakeModel,
  modelError,
  modelReply,
  request,
  testEnv,
  unreadableKv,
  unwritableKv,
  worker,
} from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("routing", () => {
  it.each([
    ["GET", "/"],
    ["GET", "/ask"],
    ["POST", "/material-hash"],
    ["POST", "/material"],
    ["GET", "/material/extra"],
    ["GET", "/nope"],
    ["POST", "/ask/extra"],
    ["DELETE", "/ask"],
  ])("%s %s is 404", async (method, path) => {
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), request(path, { method }), testEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(model.calls).toHaveLength(0);
  });

  it("GET /material-hash returns the bundled hash", async () => {
    const res = await call(worker(), request("/material-hash"), testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash: FAKE_HASH });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /material", () => {
  it("returns the bundled hash and every line with its id, without touching the model", async () => {
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), request("/material"), testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash: FAKE_HASH, lines: FAKE_MATERIAL });
    expect(model.calls).toHaveLength(0);
  });

  it("reports the same hash as /ask and /material-hash", async () => {
    const env = testEnv();
    await enableBot(env);
    const handler = worker({ fetch: fakeModel().fetch });
    const material = (await (await call(handler, request("/material"), env)).json()) as { hash: string };
    const hashOnly = (await (await call(handler, request("/material-hash"), env)).json()) as { hash: string };
    const asked = await askJson(await call(handler, askRequest("What was built?"), env));
    expect(material.hash).toBe(FAKE_HASH);
    expect(hashOnly.hash).toBe(FAKE_HASH);
    expect(asked.material_hash).toBe(FAKE_HASH);
  });

  it("is JSON, cacheable for an hour, and varies on Origin", async () => {
    const res = await call(worker(), request("/material"), testEnv());
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe(MATERIAL_CACHE_CONTROL);
    expect(MATERIAL_CACHE_CONTROL).toBe("public, max-age=3600");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("answers the allowed origin with Access-Control-Allow-Origin", async () => {
    const res = await call(worker(), request("/material"), testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });

  it("rejects any other origin with 403 and does not leak a line", async () => {
    const res = await call(worker(), request("/material", {}, { origin: OTHER_ORIGIN }), testEnv());
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const text = await res.text();
    for (const line of FAKE_MATERIAL) {
      expect(text).not.toContain(line.id);
      expect(text).not.toContain(line.text);
    }
  });

  it("serves a request without an Origin header without CORS headers, still varying on Origin", async () => {
    const res = await call(worker(), request("/material", {}, { origin: null }), testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("cache-control")).toBe(MATERIAL_CACHE_CONTROL);
  });

  it("answers the preflight for the allowed origin", async () => {
    const res = await call(worker(), request("/material", { method: "OPTIONS" }), testEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("needs no switches, no KV and no client IP", async () => {
    const env = testEnv(); // nothing enabled in KV, no key needed
    const broken = { ...env, SPEND: unreadableKv(env.SPEND), RATE_LIMIT: unreadableKv(env.RATE_LIMIT) };
    const res = await call(worker(), request("/material"), broken); // request() sets no cf-connecting-ip
    expect(res.status).toBe(200);
    expect(((await res.json()) as { hash: string }).hash).toBe(FAKE_HASH);
  });

  it("is not rate limited: still answers an IP that has used up its /ask slots", async () => {
    const env = testEnv();
    await enableBot(env);
    const c = clock();
    const model = fakeModel();
    const handler = worker({ fetch: model.fetch, now: c.now });
    for (let i = 0; i < 10; i++) {
      c.t += 1000;
      expect((await call(handler, askRequest("Q?", { ip: IP_A }), env)).status).toBe(200);
    }
    c.t += 1000;
    expect((await call(handler, askRequest("Q?", { ip: IP_A }), env)).status).toBe(429);
    const res = await call(handler, request("/material", { headers: { "cf-connecting-ip": IP_A } }), env);
    expect(res.status).toBe(200);
    expect(model.calls).toHaveLength(10);
  });

  it("writes nothing to KV and logs nothing", async () => {
    const env = testEnv();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await call(worker(), request("/material"), env);
    expect(res.status).toBe(200);
    expect(log).not.toHaveBeenCalled();
    expect((await env.SPEND.list()).keys).toEqual([]);
    expect((await env.RATE_LIMIT.list()).keys).toEqual([]);
  });

  it("returns an empty list for an empty bundle", async () => {
    const res = await call(worker({ material: [] }), request("/material"), testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash: FAKE_HASH, lines: [] });
  });
});

describe("CORS", () => {
  it("answers the allowed origin with Access-Control-Allow-Origin", async () => {
    const env = testEnv();
    await enableBot(env);
    const res = await call(worker({ fetch: fakeModel().fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("rejects any other origin with 403 and never calls the model", async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?", { origin: OTHER_ORIGIN }), env);
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect((await askJson(res)).refused).toBe(true);
    expect(model.calls).toHaveLength(0);
  });

  it("rejects a foreign origin on /material-hash too", async () => {
    const res = await call(worker(), request("/material-hash", {}, { origin: OTHER_ORIGIN }), testEnv());
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves a request without an Origin header (not a browser) without CORS headers", async () => {
    const env = testEnv();
    await enableBot(env);
    const res = await call(worker({ fetch: fakeModel().fetch }), askRequest("What was built?", { origin: null }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers the preflight for the allowed origin", async () => {
    const res = await call(worker(), request("/ask", { method: "OPTIONS" }), testEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");
  });

  it("refuses the preflight for any other origin", async () => {
    const res = await call(worker(), request("/ask", { method: "OPTIONS" }, { origin: OTHER_ORIGIN }), testEnv());
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("fails closed when ALLOWED_ORIGIN is not configured", async () => {
    const env = testEnv({ ALLOWED_ORIGIN: undefined });
    await enableBot(env);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(403);
    expect(model.calls).toHaveLength(0);
  });

  it.each(["http://localhost:8000", "http://localhost", "http://127.0.0.1:8000", "http://[::1]:8000"])(
    "accepts %s as ALLOWED_ORIGIN over plain http (local demo page against wrangler dev)",
    async (local) => {
      const env = testEnv({ ALLOWED_ORIGIN: local });
      await enableBot(env);
      const res = await call(worker({ fetch: fakeModel().fetch }), askRequest("What was built?", { origin: local }), env);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe(local);
      const material = await call(worker(), request("/material", {}, { origin: local }), env);
      expect(material.status).toBe(200);
      expect(material.headers.get("access-control-allow-origin")).toBe(local);
    },
  );

  it("still rejects other origins when ALLOWED_ORIGIN is a local http origin", async () => {
    const env = testEnv({ ALLOWED_ORIGIN: "http://localhost:8000" });
    await enableBot(env);
    const model = fakeModel();
    for (const origin of [OTHER_ORIGIN, ALLOWED_ORIGIN, "http://localhost:8001", "null"]) {
      const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?", { origin }), env);
      expect(res.status, origin).toBe(403);
    }
    expect(model.calls).toHaveLength(0);
  });

  it.each([
    "http://atxxl.github.io",
    "http://example.com:8000",
    "http://localhost.evil.example",
    "http://evil.example/localhost",
    "https://atxxl.github.io/",
    "ftp://localhost",
  ])("fails closed when ALLOWED_ORIGIN is %s (not https, not a bare localhost origin)", async (bad) => {
    const env = testEnv({ ALLOWED_ORIGIN: bad });
    await enableBot(env);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?", { origin: bad }), env);
    expect(res.status).toBe(403);
    expect(model.calls).toHaveLength(0);
  });
});

describe("input validation", () => {
  it(`refuses a question longer than ${MAX_QUESTION_CHARS} characters without calling the model`, async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("x".repeat(MAX_QUESTION_CHARS + 1)), env);
    expect(res.status).toBe(400);
    const body = await askJson(res);
    expect(body.refused).toBe(true);
    expect(body.citations).toEqual([]);
    expect(body.answer).toMatch(/500/);
    expect(model.calls).toHaveLength(0);
  });

  it(`accepts a question of exactly ${MAX_QUESTION_CHARS} characters`, async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("y".repeat(MAX_QUESTION_CHARS)), env);
    expect(res.status).toBe(200);
    expect(model.calls).toHaveLength(1);
  });

  it.each([
    ["not JSON", "this is not json"],
    ["a JSON array", "[1,2]"],
    ["no question field", JSON.stringify({ q: "hi" })],
    ["a non-string question", JSON.stringify({ question: 42 })],
    ["an empty question", JSON.stringify({ question: "   " })],
    ["an oversized body", JSON.stringify({ question: "a", padding: "p".repeat(20_000) })],
  ])("refuses %s with 400", async (_name, rawBody) => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("", { rawBody }), env);
    expect(res.status).toBe(400);
    expect((await askJson(res)).refused).toBe(true);
    expect(model.calls).toHaveLength(0);
  });
});

describe("switches that must be verified before the model is called", () => {
  it("refuses when the enabled flag is missing", async () => {
    const env = testEnv();
    await enableBot(env);
    await env.SPEND.delete(KV_KEYS.enabled);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(await askJson(res)).toEqual({ answer: "Not available right now.", citations: [], refused: true, material_hash: FAKE_HASH });
    expect(model.calls).toHaveLength(0);
  });

  it.each(["0", "true", "yes", " 1"])("refuses when the enabled flag is %j instead of \"1\"", async (value) => {
    const env = testEnv();
    await enableBot(env);
    await env.SPEND.put(KV_KEYS.enabled, value);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it("refuses when the pinned material hash is missing", async () => {
    const env = testEnv();
    await enableBot(env);
    await env.SPEND.delete(KV_KEYS.materialHash);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it("refuses when the pinned material hash does not match the bundled one", async () => {
    const env = testEnv();
    await enableBot(env, { hash: "ffffffffffff" });
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it("refuses when there is no material to answer from", async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch, material: [] }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it("refuses when the API key is not configured", async () => {
    const env = testEnv({ ANTHROPIC_API_KEY: undefined });
    await enableBot(env);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it("refuses when the client IP is unknown (nothing to rate-limit on)", async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?", { ip: null }), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it("refuses when the SPEND namespace cannot be read", async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const broken = { ...env, SPEND: unreadableKv(env.SPEND) };
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), broken);
    expect(res.status).toBe(503);
    expect((await askJson(res)).refused).toBe(true);
    expect(model.calls).toHaveLength(0);
  });

  it("refuses when the RATE_LIMIT namespace cannot be read", async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const broken = { ...env, RATE_LIMIT: unreadableKv(env.RATE_LIMIT) };
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), broken);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it("refuses when the rate-limit slot cannot be recorded", async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const broken = { ...env, RATE_LIMIT: unwritableKv(env.RATE_LIMIT) };
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), broken);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });
});

describe("spend cap", () => {
  it("refuses when the cap is not set", async () => {
    const env = testEnv();
    await enableBot(env);
    await env.SPEND.delete(KV_KEYS.spendCapUsd);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it.each(["abc", "", "0", "-1", "1e3", "$5"])("refuses when the cap is %j", async (cap) => {
    const env = testEnv();
    await enableBot(env, { cap });
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it("refuses when the running total is unreadable", async () => {
    const env = testEnv();
    await enableBot(env, { spent: "lots" });
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it("refuses when the next call could push the month over the cap", async () => {
    const env = testEnv();
    await enableBot(env, { cap: "5", spent: "4.9999" });
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect((await askJson(res)).refused).toBe(true);
    expect(model.calls).toHaveLength(0);
    expect(await env.SPEND.get(MONTH_KEY)).toBe("4.9999");
  });

  it("refuses when the cap is already reached", async () => {
    const env = testEnv();
    await enableBot(env, { cap: "5", spent: "5" });
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });

  it("adds the cost of a successful call to this month's total", async () => {
    const env = testEnv();
    await enableBot(env, { cap: "5", spent: "1" });
    const res = await call(worker({ fetch: fakeModel().fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(200);
    expect(Number(await env.SPEND.get(MONTH_KEY))).toBeCloseTo(1 + DEFAULT_COST_USD, 8);
  });

  it("starts the month at zero when there is no total yet", async () => {
    const env = testEnv();
    await enableBot(env, { cap: "5" });
    const res = await call(worker({ fetch: fakeModel().fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(200);
    expect(Number(await env.SPEND.get(MONTH_KEY))).toBeCloseTo(DEFAULT_COST_USD, 8);
  });

  it("prices cache reads and writes separately", async () => {
    const env = testEnv();
    await enableBot(env, { cap: "5" });
    const model = fakeModel(() =>
      modelReply(DEFAULT_ANSWER, {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 10_000,
      }),
    );
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(200);
    // 100 * 1 + 1000 * 1.25 + 10000 * 0.1 + 200 * 5 = 3350 micro-dollars
    expect(Number(await env.SPEND.get(MONTH_KEY))).toBeCloseTo(0.00335, 8);
  });

  it("refuses a model it has no price for, so the cap can always be enforced", async () => {
    const env = testEnv({ MODEL: "claude-made-up-model" });
    await enableBot(env);
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(model.calls).toHaveLength(0);
  });
});

describe("rate limit", () => {
  it("allows 10 questions per IP in 10 minutes and refuses the 11th", async () => {
    const env = testEnv();
    await enableBot(env);
    const c = clock();
    const model = fakeModel();
    const handler = worker({ fetch: model.fetch, now: c.now });

    for (let i = 0; i < 10; i++) {
      c.t += 1000;
      const res = await call(handler, askRequest(`Question ${i}?`), env);
      expect(res.status, `question ${i + 1}`).toBe(200);
    }
    expect(model.calls).toHaveLength(10);

    c.t += 1000;
    const refused = await call(handler, askRequest("One more?"), env);
    expect(refused.status).toBe(429);
    expect((await askJson(refused)).refused).toBe(true);
    const retryAfter = Number(refused.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);
    expect(model.calls).toHaveLength(10);
  });

  it("frees a slot once the oldest question leaves the window", async () => {
    const env = testEnv();
    await enableBot(env);
    const c = clock();
    const model = fakeModel();
    const handler = worker({ fetch: model.fetch, now: c.now });

    const first = c.t;
    for (let i = 0; i < 10; i++) {
      c.t = first + i * 1000;
      expect((await call(handler, askRequest(`Question ${i}?`), env)).status).toBe(200);
    }
    c.t = first + 10 * 1000;
    expect((await call(handler, askRequest("Blocked?"), env)).status).toBe(429);

    // 10 minutes after the first question it no longer counts; one slot is free again.
    c.t = first + 600 * 1000 + 1;
    expect((await call(handler, askRequest("Allowed again?"), env)).status).toBe(200);
    expect((await call(handler, askRequest("Blocked again?"), env)).status).toBe(429);
    expect(model.calls).toHaveLength(11);
  });

  it("counts each IP separately", async () => {
    const env = testEnv();
    await enableBot(env);
    const c = clock();
    const model = fakeModel();
    const handler = worker({ fetch: model.fetch, now: c.now });
    for (let i = 0; i < 10; i++) {
      c.t += 1000;
      expect((await call(handler, askRequest("Q?", { ip: IP_A }), env)).status).toBe(200);
    }
    c.t += 1000;
    expect((await call(handler, askRequest("Q?", { ip: IP_A }), env)).status).toBe(429);
    expect((await call(handler, askRequest("Q?", { ip: IP_B }), env)).status).toBe(200);
  });

  it("consumes a slot even when the model call fails", async () => {
    const env = testEnv();
    await enableBot(env);
    const c = clock();
    const model = fakeModel(() => modelError(500, "api_error", "boom"));
    const handler = worker({ fetch: model.fetch, now: c.now });
    for (let i = 0; i < 10; i++) {
      c.t += 1000;
      expect((await call(handler, askRequest("Q?"), env)).status).toBe(503);
    }
    c.t += 1000;
    expect((await call(handler, askRequest("Q?"), env)).status).toBe(429);
    expect(model.calls).toHaveLength(10);
  });

  it("does not store the raw IP address", async () => {
    const env = testEnv();
    await enableBot(env);
    await call(worker({ fetch: fakeModel().fetch }), askRequest("Q?", { ip: IP_A }), env);
    const keys = (await env.RATE_LIMIT.list()).keys.map((k) => k.name);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(IP_A);
    expect(keys[0]).toMatch(/^ip:[0-9a-f]{64}$/);
  });
});

describe("model call", () => {
  it("sends the fixed request shape with a cacheable system block", async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    await call(worker({ fetch: model.fetch }), askRequest("  What was built?  "), env);

    expect(model.calls).toHaveLength(1);
    const c = model.calls[0];
    expect(c.url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(c.method).toBe("POST");
    expect(c.headers["x-api-key"]).toBe("test-key-not-real");
    expect(c.headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(c.headers["content-type"]).toContain("application/json");

    expect(c.body.model).toBe("claude-haiku-4-5-20251001");
    expect(c.body.max_tokens).toBe(600);
    expect(c.body.temperature).toBe(0);

    expect(c.body.system).toHaveLength(1);
    expect(c.body.system[0].type).toBe("text");
    expect(c.body.system[0].cache_control).toEqual({ type: "ephemeral" });
    const system: string = c.body.system[0].text;
    expect(system.startsWith(FAKE_PROMPT)).toBe(true);
    expect(system).toContain("# Material");
    for (const line of FAKE_MATERIAL) expect(system).toContain(`${line.id}: ${line.text}`);

    expect(c.body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "What was built?" }] }]);
    expect(c.body.stream).toBeUndefined();
  });

  it("sends a byte-identical system block on every request (prompt caching)", async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const handler = worker({ fetch: model.fetch });
    await call(handler, askRequest("First?"), env);
    await call(handler, askRequest("Second, different question?"), env);
    expect(model.calls[0].body.system).toEqual(model.calls[1].body.system);
  });

  it("returns the answer, its citations and the material hash", async () => {
    const env = testEnv();
    await enableBot(env);
    const res = await call(worker({ fetch: fakeModel().fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(200);
    expect(await askJson(res)).toEqual({ answer: DEFAULT_ANSWER, citations: ["sample#2"], refused: false, material_hash: FAKE_HASH });
  });

  it.each([
    ["an API error", () => modelError(500, "api_error", "boom")],
    ["an authentication error", () => modelError(401, "authentication_error", "bad key")],
    ["an overloaded response", () => modelError(529, "overloaded_error", "busy")],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
    ["a non-JSON body", () => new Response("<html>oops</html>", { status: 200 })],
    ["a reply without text", () => Response.json({ content: [], usage: { input_tokens: 1, output_tokens: 0 } })],
    ["a reply without usage", () => Response.json({ content: [{ type: "text", text: "hi" }] })],
  ])("fails closed on %s", async (_name, reply) => {
    const env = testEnv();
    await enableBot(env, { spent: "1" });
    const model = fakeModel(reply as () => Response | Promise<Response>);
    const res = await call(worker({ fetch: model.fetch }), askRequest("What was built?"), env);
    expect(res.status).toBe(503);
    expect(await askJson(res)).toEqual({ answer: "Not available right now.", citations: [], refused: true, material_hash: FAKE_HASH });
    expect(model.calls).toHaveLength(1);
    expect(await env.SPEND.get(MONTH_KEY)).toBe("1");
  });
});

describe("citations", () => {
  it("keeps ids that exist in the material, in order, once each, and drops invented ones", async () => {
    const env = testEnv();
    await enableBot(env);
    const answer =
      "Counted umbrellas [sample#2] with Zorblax [sample#3, sample#9] and [bogus#1]; taught it [other#1][sample#2]. Also [not an id] and [mai#1].";
    const res = await call(worker({ fetch: fakeModel(() => modelReply(answer)).fetch }), askRequest("What was built?"), env);
    const body = await askJson(res);
    expect(body.citations).toEqual(["sample#2", "sample#3", "other#1"]);
    expect(body.answer).toBe(answer);
  });

  it("returns no citations when the model cites nothing real", async () => {
    const env = testEnv();
    await enableBot(env);
    const res = await call(worker({ fetch: fakeModel(() => modelReply("Not done. [sample#42]")).fetch }), askRequest("Did they fly?"), env);
    const body = await askJson(res);
    expect(body.citations).toEqual([]);
    expect(body.refused).toBe(false);
  });
});

describe("logging", () => {
  const QUESTION_MARKER = "zorblax-question-7f3a";
  const ANSWER_MARKER = "quintessa-answer-9b2c";

  function captureConsole(): string[] {
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    return lines;
  }

  it("logs length, refusal flag, latency, tokens and cost, never the question or the answer", async () => {
    const env = testEnv();
    await enableBot(env);
    const lines = captureConsole();
    const question = `Tell me about ${QUESTION_MARKER} please`;
    const answer = `${ANSWER_MARKER} [sample#2]`;
    const res = await call(worker({ fetch: fakeModel(() => modelReply(answer)).fetch }), askRequest(question), env);
    expect(res.status).toBe(200);

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(QUESTION_MARKER);
    expect(lines[0]).not.toContain(ANSWER_MARKER);
    const record = JSON.parse(lines[0]);
    expect(record).toMatchObject({
      event: "ask",
      status: 200,
      refused: false,
      question_length: question.length,
      input_tokens: 1000,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cost_usd: DEFAULT_COST_USD,
    });
    expect(typeof record.latency_ms).toBe("number");
    expect(Object.keys(record).sort()).toEqual(
      [
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
        "cost_usd",
        "event",
        "input_tokens",
        "latency_ms",
        "output_tokens",
        "question_length",
        "reason",
        "refused",
        "status",
        "stop_reason",
      ].sort(),
    );
  });

  it("logs refusals the same way, without the text", async () => {
    const env = testEnv();
    await enableBot(env);
    const lines = captureConsole();
    const question = `${QUESTION_MARKER} ${"x".repeat(MAX_QUESTION_CHARS)}`;
    const res = await call(worker({ fetch: fakeModel().fetch }), askRequest(question), env);
    expect(res.status).toBe(400);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(QUESTION_MARKER);
    expect(JSON.parse(lines[0])).toMatchObject({ event: "ask", status: 400, refused: true, reason: "too_long", question_length: question.length });
  });

  it("does not log the body of a model error either", async () => {
    const env = testEnv();
    await enableBot(env);
    const lines = captureConsole();
    const question = `What about ${QUESTION_MARKER}?`;
    const model = fakeModel(() => modelError(400, "invalid_request_error", `echo of the prompt: ${QUESTION_MARKER} ${ANSWER_MARKER}`));
    const res = await call(worker({ fetch: model.fetch }), askRequest(question), env);
    expect(res.status).toBe(503);
    expect(lines.join("\n")).not.toContain(QUESTION_MARKER);
    expect(lines.join("\n")).not.toContain(ANSWER_MARKER);
    expect(JSON.parse(lines[0])).toMatchObject({ event: "ask", status: 503, refused: true, reason: "model_error", model_status: 400, model_error_type: "invalid_request_error" });
  });

  it("logs nothing about the question when the request is rejected before parsing", async () => {
    const lines = captureConsole();
    const res = await call(worker({ fetch: fakeModel().fetch }), askRequest(QUESTION_MARKER, { origin: OTHER_ORIGIN }), testEnv());
    expect(res.status).toBe(403);
    expect(lines.join("\n")).not.toContain(QUESTION_MARKER);
  });
});

describe("timing", () => {
  it("uses the UTC month of the request for the spend key", async () => {
    const env = testEnv();
    await enableBot(env);
    // 2026-11-01T00:00:30Z: a few seconds into November, UTC.
    const res = await call(worker({ fetch: fakeModel().fetch, now: () => Date.UTC(2026, 10, 1, 0, 0, 30) }), askRequest("Q?"), env);
    expect(res.status).toBe(200);
    expect(await env.SPEND.get(KV_KEYS.spendMonth("2026-11"))).not.toBeNull();
    expect(await env.SPEND.get(MONTH_KEY)).toBeNull();
    expect(NOW).toBeLessThan(Date.UTC(2026, 10, 1));
  });
});

describe("namespaces", () => {
  it("keeps rate-limit state out of the SPEND namespace and vice versa", async () => {
    const env = testEnv();
    await enableBot(env);
    await call(worker({ fetch: fakeModel().fetch }), askRequest("Q?", { ip: IP_A }), env);
    const rateKeys = (await env.RATE_LIMIT.list()).keys.map((k) => k.name);
    const spendKeys = (await env.SPEND.list()).keys.map((k) => k.name);
    expect(rateKeys.every((k) => k.startsWith("ip:"))).toBe(true);
    expect(spendKeys.sort()).toEqual([KV_KEYS.enabled, KV_KEYS.materialHash, KV_KEYS.spendCapUsd, MONTH_KEY].sort());
  });
});
