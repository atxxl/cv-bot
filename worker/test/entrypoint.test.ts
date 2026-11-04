// The real entrypoint (src/index.ts) through the test runner's service
// binding. These tests only check wiring; they assert nothing about the
// content of the real material.

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WIDGET_CACHE_VERSIONED, widgetVersion } from "../src/assets";
import { MATERIAL, MATERIAL_HASH } from "../src/material";
import { WIDGET_CSS, WIDGET_JS } from "../src/widget";

describe("entrypoint", () => {
  it("serves the bundled material hash", async () => {
    const res = await SELF.fetch("https://cv-bot.example/material-hash");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash: MATERIAL_HASH });
  });

  it("serves the bundled material under the same hash, cacheable", async () => {
    const res = await SELF.fetch("https://cv-bot.example/material");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await res.json()).toEqual({ hash: MATERIAL_HASH, lines: MATERIAL });
  });

  it("serves web/widget.js as JavaScript", async () => {
    const res = await SELF.fetch("https://cv-bot.example/widget.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const body = await res.text();
    expect(body).toBe(WIDGET_JS);
    // The real file, not an empty or placeholder module.
    expect(body).toMatch(/^\/\* cv-bot widget/);
    expect(body).toContain('getElementById("cv-bot")');
  });

  it("serves web/widget.css as CSS", async () => {
    const res = await SELF.fetch("https://cv-bot.example/widget.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    const body = await res.text();
    expect(body).toBe(WIDGET_CSS);
    expect(body).toMatch(/^\/\* cv-bot widget/);
    expect(body).toContain("#cv-bot {");
  });

  it("versions both widget files by the bundled material hash and the files", async () => {
    const version = await widgetVersion(MATERIAL_HASH, WIDGET_JS, WIDGET_CSS);
    for (const path of ["/widget.js", "/widget.css"]) {
      const res = await SELF.fetch(`https://cv-bot.example${path}?v=${version}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("etag")).toBe(`"${version}"`);
      expect(res.headers.get("cache-control")).toBe(WIDGET_CACHE_VERSIONED);
    }
  });

  it("returns 404 for anything else", async () => {
    const res = await SELF.fetch("https://cv-bot.example/");
    expect(res.status).toBe(404);
  });

  it("fails closed on /ask when nothing is switched on in KV", async () => {
    const res = await SELF.fetch("https://cv-bot.example/ask", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.1" },
      body: JSON.stringify({ question: "Anything?" }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ answer: "Not available right now.", citations: [], refused: true, material_hash: MATERIAL_HASH });
  });
});
