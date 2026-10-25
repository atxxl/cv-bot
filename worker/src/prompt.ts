// prompts/system.md is bundled as a text module (wrangler.toml `[[rules]]`),
// so the deployed prompt is always exactly the file in the repo.
import systemPrompt from "../../prompts/system.md";

export const SYSTEM_PROMPT: string = systemPrompt;
