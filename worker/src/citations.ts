// Citations are line ids such as `mai#3`, written by the model inside square
// brackets: `[mai#3]` or `[mai#3, mai#4]` (format defined in prompts/system.md).
// Only ids that exist in the bundled material are kept; anything else the
// model writes is dropped.
//
// The prompt says never to write a range, but the model sometimes does. As a
// safety net, a short range inside the brackets is expanded to one id per line,
// in order, before the filter above: `[x#8–x#14]`, `[x#8-x#14]`,
// `[x#8 – x#14]`, `[x#8 through x#14]`, `[x#8 to x#14]` and `[x#8–14]` all
// stand for x#8, x#9, ..., x#14. Both ends must be in the same file, the start
// must be lower than the end, and the range may cover at most MAX_RANGE_LINES
// lines. A range that breaks any of these is dropped whole, endpoints included.
// evals/common.py ports this parser; worker/test/citation-cases.json holds the
// examples both are tested on.

const LINE_ID = /^[A-Za-z0-9_.-]+#\d+$/;
const BRACKET = /\[([^\[\]]{1,300})\]/g;
const SEPARATORS = /[\s,;]+/;

const MAX_RANGE_LINES = 8;

// A start id, then a hyphen or en dash (spaces optional) or the word `to` or
// `through` (spaces required), then the end: an id or a bare line number. The
// range must stand alone: preceded and followed by a separator (whitespace,
// comma, semicolon) or the edge of the bracket.
const RANGE =
  /(?<![^\s,;])([A-Za-z0-9_.-]+)#(\d+)(?:\s*[-\u2013]\s*|\s+(?:to|through)\s+)(?:([A-Za-z0-9_.-]+)#)?(\d+)(?![^\s,;])/g;

export function extractCitations(answer: string, knownIds: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of answer.matchAll(BRACKET)) {
    for (const id of idsInBracket(match[1])) {
      if (!LINE_ID.test(id) || !knownIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      found.push(id);
    }
  }
  return found;
}

/** Every token inside one pair of brackets, in order, with each range replaced by the ids it expands to. */
function idsInBracket(inside: string): string[] {
  const ids: string[] = [];
  let rest = 0;
  for (const range of inside.matchAll(RANGE)) {
    ids.push(...tokens(inside.slice(rest, range.index)));
    ids.push(...expandRange(range));
    rest = range.index + range[0].length;
  }
  ids.push(...tokens(inside.slice(rest)));
  return ids;
}

function tokens(text: string): string[] {
  return text.split(SEPARATORS).map((token) => token.trim());
}

/** The ids a RANGE match stands for, or none when it breaks a rule. */
function expandRange(range: RegExpMatchArray): string[] {
  const [, file, startText, endFile, endText] = range;
  const start = Number(startText);
  const end = Number(endText);
  if (endFile !== undefined && endFile !== file) return [];
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return [];
  if (start >= end || end - start > MAX_RANGE_LINES - 1) return [];
  const ids: string[] = [];
  for (let line = start; line <= end; line++) ids.push(`${file}#${line}`);
  return ids;
}
