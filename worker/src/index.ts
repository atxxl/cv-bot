// cv-bot Worker entrypoint: the real material, its hash, the system prompt and
// the widget files wired into the handler in worker.ts. See CLAUDE.md for the
// architecture.

import { MATERIAL, MATERIAL_HASH } from "./material";
import { SYSTEM_PROMPT } from "./prompt";
import { WIDGET_CSS, WIDGET_JS } from "./widget";
import { createWorker } from "./worker";

export default createWorker({
  material: MATERIAL,
  materialHash: MATERIAL_HASH,
  systemPrompt: SYSTEM_PROMPT,
  widgetJs: WIDGET_JS,
  widgetCss: WIDGET_CSS,
});
