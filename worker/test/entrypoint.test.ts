// The real entrypoint (src/index.ts) through the test runner's service
// binding. These tests only check wiring; they assert nothing about the
// content of the real material.

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MATERIAL_HASH } from "../src/material";

describe("entrypoint", () => {
  it("serves the bundled material hash", async () => {
    const res = await SELF.fetch("https://cv-bot.example/material-hash");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash: MATERIAL_HASH });
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
