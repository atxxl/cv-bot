// Every test starts with empty KV namespaces, so no state leaks between tests.
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

async function clear(kv: KVNamespace): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await kv.list({ cursor });
    await Promise.all(page.keys.map((k) => kv.delete(k.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

beforeEach(async () => {
  await clear(env.RATE_LIMIT);
  await clear(env.SPEND);
});
