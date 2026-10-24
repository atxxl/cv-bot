// cv-bot Worker entrypoint: the real material, its hash and the system prompt
// wired into the handler in worker.ts. See CLAUDE.md for the architecture.

import { MATERIAL, MATERIAL_HASH } from "./material";
import { SYSTEM_PROMPT } from "./prompt";
import { createWorker } from "./worker";

export default createWorker({ material: MATERIAL, materialHash: MATERIAL_HASH, systemPrompt: SYSTEM_PROMPT });
