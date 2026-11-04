// The kill switch from docs/runbook.md: `enabled=false` in the SPEND namespace
// takes the widget offline. /ask answers "Not available right now." without
// touching the model, the rate limit or the spend total; the widget files and
// the material keep loading so the page does not break; putting "1" back
// turns it on again without a deploy.

import { afterEach, describe, expect, it, vi } from "vitest";
import { KV_KEYS } from "../src/config";
import {
  FAKE_HASH,
  FAKE_MATERIAL,
  FAKE_WIDGET_CSS,
  FAKE_WIDGET_JS,
  MONTH_KEY,
  askJson,
  askRequest,
  call,
  enableBot,
  fakeModel,
  request,
  testEnv,
  worker,
} from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

const OFFLINE = { answer: "Not available right now.", citations: [], refused: true, material_hash: FAKE_HASH };
const QUESTION = "What did the umbrella project count?";

describe("kill switch: enabled=false", () => {
  it("refuses /ask with the not-available response and never calls the model", async () => {
    const env = testEnv();
    await enableBot(env); // everything else would let the question through
    await env.SPEND.put(KV_KEYS.enabled, "false");
    const model = fakeModel();
    const res = await call(worker({ fetch: model.fetch }), askRequest(QUESTION), env);
    expect(res.status).toBe(503);
    expect(await askJson(res)).toEqual(OFFLINE);
    expect(model.calls).toHaveLength(0);
  });

  it("uses no rate-limit slot and adds nothing to the month's spend", async () => {
    const env = testEnv();
    await enableBot(env, { spent: "1.25" });
    await env.SPEND.put(KV_KEYS.enabled, "false");
    const res = await call(worker({ fetch: fakeModel().fetch }), askRequest(QUESTION), env);
    expect(res.status).toBe(503);
    expect((await env.RATE_LIMIT.list()).keys).toEqual([]);
    expect(await env.SPEND.get(MONTH_KEY)).toBe("1.25");
  });

  it('logs reason "disabled" and no question text, so the logs show the switch is what refused', async () => {
    const env = testEnv();
    await enableBot(env);
    await env.SPEND.put(KV_KEYS.enabled, "false");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    await call(worker({ fetch: fakeModel().fetch }), askRequest(QUESTION), env);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record).toMatchObject({ event: "ask", status: 503, refused: true, reason: "disabled", question_length: QUESTION.length });
    expect(lines[0]).not.toContain("umbrella");
  });

  it('reports "disabled" even when the other switches are missing too', async () => {
    const env = testEnv();
    await env.SPEND.put(KV_KEYS.enabled, "false"); // no pin, no cap
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const res = await call(worker({ fetch: fakeModel().fetch }), askRequest(QUESTION), env);
    expect(res.status).toBe(503);
    expect(JSON.parse(lines[0]).reason).toBe("disabled");
  });

  it.each(["false", "FALSE", "False", "0", "off", "no", "true"])(
    "treats %j as off: only \"1\" turns the bot on (fail closed)",
    async (value) => {
      const env = testEnv();
      await enableBot(env);
      await env.SPEND.put(KV_KEYS.enabled, value);
      const model = fakeModel();
      const res = await call(worker({ fetch: model.fetch }), askRequest(QUESTION), env);
      expect(res.status).toBe(503);
      expect(await askJson(res)).toEqual(OFFLINE);
      expect(model.calls).toHaveLength(0);
    },
  );

  it("keeps serving the widget files and the material, so the page still renders the widget", async () => {
    const env = testEnv();
    await enableBot(env);
    await env.SPEND.put(KV_KEYS.enabled, "false");
    const handler = worker({ fetch: fakeModel().fetch });

    const js = await call(handler, request("/widget.js"), env);
    expect(js.status).toBe(200);
    expect(await js.text()).toBe(FAKE_WIDGET_JS);

    const css = await call(handler, request("/widget.css"), env);
    expect(css.status).toBe(200);
    expect(await css.text()).toBe(FAKE_WIDGET_CSS);

    const material = await call(handler, request("/material"), env);
    expect(material.status).toBe(200);
    expect(await material.json()).toEqual({ hash: FAKE_HASH, lines: FAKE_MATERIAL });

    const hash = await call(handler, request("/material-hash"), env);
    expect(await hash.json()).toEqual({ hash: FAKE_HASH });
  });

  it('turns back on when "1" is put back, without a new Worker (no deploy)', async () => {
    const env = testEnv();
    await enableBot(env);
    const model = fakeModel();
    const handler = worker({ fetch: model.fetch });

    expect((await call(handler, askRequest(QUESTION), env)).status).toBe(200);

    await env.SPEND.put(KV_KEYS.enabled, "false");
    const off = await call(handler, askRequest(QUESTION), env);
    expect(off.status).toBe(503);
    expect(await askJson(off)).toEqual(OFFLINE);

    await env.SPEND.put(KV_KEYS.enabled, "1");
    const on = await call(handler, askRequest(QUESTION), env);
    expect(on.status).toBe(200);
    expect((await askJson(on)).refused).toBe(false);

    expect(model.calls).toHaveLength(2);
  });
});
