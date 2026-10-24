// Citations are line ids such as `mai#3`, written by the model inside square
// brackets: `[mai#3]` or `[mai#3, mai#4]` (format defined in prompts/system.md).
// Only ids that exist in the bundled material are kept; anything else the
// model writes is dropped.

const LINE_ID = /^[A-Za-z0-9_.-]+#\d+$/;

export function extractCitations(answer: string, knownIds: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of answer.matchAll(/\[([^\[\]]{1,300})\]/g)) {
    for (const token of match[1].split(/[\s,;]+/)) {
      const id = token.trim();
      if (!LINE_ID.test(id) || !knownIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      found.push(id);
    }
  }
  return found;
}
