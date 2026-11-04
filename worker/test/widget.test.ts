// GET /widget.js and GET /widget.css: the widget files served by the Worker so
// the CV page needs no copy (issue 7). The files here are made-up stand-ins;
// entrypoint.test.ts checks that the real ones from web/ are wired in.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WIDGET_CACHE_UNVERSIONED,
  WIDGET_CACHE_VERSIONED,
  etagMatches,
  widgetVersion,
} from "../src/assets";
import {
  ALLOWED_ORIGIN,
  FAKE_HASH,
  FAKE_WIDGET_CSS,
  FAKE_WIDGET_JS,
  IP_A,
  OTHER_ORIGIN,
  askRequest,
  call,
  clock,
  enableBot,
  fakeModel,
  request,
  testEnv,
  unreadableKv,
  worker,
} from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

const ASSETS = [
  { path: "/widget.js", body: FAKE_WIDGET_JS, type: "text/javascript; charset=utf-8" },
  { path: "/widget.css", body: FAKE_WIDGET_CSS, type: "text/css; charset=utf-8" },
] as const;

async function currentVersion(): Promise<string> {
  return widgetVersion(FAKE_HASH, FAKE_WIDGET_JS, FAKE_WIDGET_CSS);
}

describe("widgetVersion", () => {
  it("is 12 lowercase hex characters and deterministic", async () => {
    const v = await currentVersion();
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(await currentVersion()).toBe(v);
  });

  it("changes when the material hash changes (versioned by material hash)", async () => {
    const v = await currentVersion();
    expect(await widgetVersion("ffffffffffff", FAKE_WIDGET_JS, FAKE_WIDGET_CSS)).not.toBe(v);
  });

  it("changes when only widget.js or only widget.css changes", async () => {
    const v = await currentVersion();
    expect(await widgetVersion(FAKE_HASH, FAKE_WIDGET_JS + " ", FAKE_WIDGET_CSS)).not.toBe(v);
    expect(await widgetVersion(FAKE_HASH, FAKE_WIDGET_JS, FAKE_WIDGET_CSS + " ")).not.toBe(v);
  });

  it("does not let text move between the two files without changing", async () => {
    expect(await widgetVersion(FAKE_HASH, "ab", "c")).not.toBe(await widgetVersion(FAKE_HASH, "a", "bc"));
  });
});

describe("etagMatches", () => {
  const etag = '"0123456789ab"';
  it.each([
    ['"0123456789ab"', true],
    ['W/"0123456789ab"', true],
    ['"zzz", W/"0123456789ab"', true],
    ["*", true],
    ['"ffffffffffff"', false],
    ["0123456789ab", false],
    ["", false],
  ])("If-None-Match %j -> %s", (header, expected) => {
    expect(etagMatches(header, etag)).toBe(expected);
  });

  it("is false without the header", () => {
    expect(etagMatches(null, etag)).toBe(false);
  });
});

describe.each(ASSETS)("GET $path", ({ path, body, type }) => {
  it("returns the bundled file with its content type and nosniff", async () => {
    const res = await call(worker(), request(path), testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(res.headers.get("content-type")).toBe(type);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("carries the shared version as a strong ETag", async () => {
    const res = await call(worker(), request(path), testEnv());
    expect(res.headers.get("etag")).toBe(`"${await currentVersion()}"`);
  });

  it("is cached for 5 minutes without ?v=", async () => {
    const res = await call(worker(), request(path), testEnv());
    expect(res.headers.get("cache-control")).toBe(WIDGET_CACHE_UNVERSIONED);
    expect(WIDGET_CACHE_UNVERSIONED).toBe("public, max-age=300");
  });

  it("is immutable for a year when ?v= is the current version", async () => {
    const res = await call(worker(), request(`${path}?v=${await currentVersion()}`), testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(res.headers.get("cache-control")).toBe(WIDGET_CACHE_VERSIONED);
    expect(WIDGET_CACHE_VERSIONED).toBe("public, max-age=31536000, immutable");
  });

  it.each(["ffffffffffff", "", "0123", "<old>"])(
    "serves the current file with the short cache when ?v=%j is not the current version",
    async (stale) => {
      const res = await call(worker(), request(`${path}?v=${encodeURIComponent(stale)}`), testEnv());
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(body);
      expect(res.headers.get("cache-control")).toBe(WIDGET_CACHE_UNVERSIONED);
    },
  );

  it("uses the long cache only for the version of the files it serves", async () => {
    // Same material hash, different widget: the old version string no longer earns the long cache.
    const oldVersion = await currentVersion();
    const changed = worker({ widgetJs: FAKE_WIDGET_JS + "// fix\n", widgetCss: FAKE_WIDGET_CSS + "/* fix */\n" });
    const res = await call(changed, request(`${path}?v=${oldVersion}`), testEnv());
    expect(res.headers.get("cache-control")).toBe(WIDGET_CACHE_UNVERSIONED);
    expect(res.headers.get("etag")).not.toBe(`"${oldVersion}"`);
  });

  it.each([
    ["strong", (v: string) => `"${v}"`],
    ["weak (Cloudflare compression)", (v: string) => `W/"${v}"`],
  ])("answers a matching %s If-None-Match with 304 and no body", async (_kind, tag) => {
    const v = await currentVersion();
    const res = await call(worker(), request(path, { headers: { "if-none-match": tag(v) } }), testEnv());
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBe(`"${v}"`);
    expect(res.headers.get("cache-control")).toBe(WIDGET_CACHE_UNVERSIONED);
  });

  it("answers a non-matching If-None-Match with the full file", async () => {
    const res = await call(worker(), request(path, { headers: { "if-none-match": '"ffffffffffff"' } }), testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it("answers the allowed origin with Access-Control-Allow-Origin and varies on Origin", async () => {
    const res = await call(worker(), request(path), testEnv());
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("serves a request without an Origin header (a plain <script>/<link> load) without CORS headers", async () => {
    const res = await call(worker(), request(path, {}, { origin: null }), testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("rejects any other origin with 403 and does not send the file", async () => {
    const res = await call(worker(), request(path, {}, { origin: OTHER_ORIGIN }), testEnv());
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(await res.text()).not.toContain(body.trim());
  });

  it("needs no switches, no KV, no API key and no client IP", async () => {
    const env = testEnv({ ANTHROPIC_API_KEY: undefined }); // nothing enabled in KV either
    const broken = { ...env, SPEND: unreadableKv(env.SPEND), RATE_LIMIT: unreadableKv(env.RATE_LIMIT) };
    const res = await call(worker(), request(path), broken); // request() sets no cf-connecting-ip
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it("is not rate limited: still served to an IP that has used up its /ask slots", async () => {
    const env = testEnv();
    await enableBot(env);
    const c = clock();
    const handler = worker({ fetch: fakeModel().fetch, now: c.now });
    for (let i = 0; i < 10; i++) {
      c.t += 1000;
      expect((await call(handler, askRequest("Q?", { ip: IP_A }), env)).status).toBe(200);
    }
    c.t += 1000;
    expect((await call(handler, askRequest("Q?", { ip: IP_A }), env)).status).toBe(429);
    const res = await call(handler, request(path, { headers: { "cf-connecting-ip": IP_A } }), env);
    expect(res.status).toBe(200);
  });

  it("writes nothing to KV, logs nothing and never calls the model", async () => {
    const env = testEnv();
    const model = fakeModel();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await call(worker({ fetch: model.fetch }), request(path), env);
    expect(res.status).toBe(200);
    expect(log).not.toHaveBeenCalled();
    expect(model.calls).toHaveLength(0);
    expect((await env.SPEND.list()).keys).toEqual([]);
    expect((await env.RATE_LIMIT.list()).keys).toEqual([]);
  });

  it("answers the preflight for the allowed origin", async () => {
    const res = await call(worker(), request(path, { method: "OPTIONS" }), testEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it.each(["POST", "PUT", "DELETE"])("%s is 404", async (method) => {
    const res = await call(worker(), request(path, { method }), testEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});

describe("widget routing", () => {
  it.each(["/widget", "/widget.js/extra", "/widget.css/", "/web/widget.js", "/widget.mjs", "/demo.html"])(
    "GET %s is 404",
    async (path) => {
      const res = await call(worker(), request(path), testEnv());
      expect(res.status).toBe(404);
    },
  );

  it("serves both files under the same version", async () => {
    const handler = worker();
    const js = await call(handler, request("/widget.js"), testEnv());
    const css = await call(handler, request("/widget.css"), testEnv());
    expect(js.headers.get("etag")).toBe(css.headers.get("etag"));
  });
});
