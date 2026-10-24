import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        // wrangler.toml has placeholder ids, which would make both bindings
        // one namespace in tests. Give each its own local store.
        kvNamespaces: { RATE_LIMIT: "test-rate-limit", SPEND: "test-spend" },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Worker log lines are shown only for failing tests.
    silent: "passed-only",
  },
});
