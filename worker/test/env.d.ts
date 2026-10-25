// Types the `env` that cloudflare:workers / cloudflare:test provide in tests as our Env.
import type { Env as WorkerEnv } from "../src/config";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

export {};
