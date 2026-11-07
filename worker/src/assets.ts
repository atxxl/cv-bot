// Caching rules for the widget files served at GET /widget.js and GET /widget.css.
//
// Both files share one version: 12 hex chars of sha256 over the material hash
// and the two files. It changes when the material changes (as issue 7 asks)
// and also when only the widget changes, so a CSS fix is never stuck behind a
// year-long cache because the material stayed the same.
//
// The embed snippet may carry `?v=<version>`:
//   - `v` equals the current version: the response is immutable for a year.
//   - no `v`, or any other `v` (an outdated snippet, or one pasted before the
//     deploy that matches it): the same current files, cached for 5 minutes.
// So a stale snippet never pins old files and never caches new files under an
// old version for long. Every response carries `ETag: "<version>"`, which is
// also how the owner reads the current version (web/embed.md).

/** `?v=` matches the current version: the URL names exactly these bytes. */
export const WIDGET_CACHE_VERSIONED = "public, max-age=31536000, immutable";
/** No `?v=` or a different one: current files, short cache, revalidated by ETag. */
export const WIDGET_CACHE_UNVERSIONED = "public, max-age=300";

export const WIDGET_CONTENT_TYPES = {
  "/widget.js": "text/javascript; charset=utf-8",
  "/widget.css": "text/css; charset=utf-8",
} as const;

export type WidgetPath = keyof typeof WIDGET_CONTENT_TYPES;

export function isWidgetPath(path: string): path is WidgetPath {
  return Object.prototype.hasOwnProperty.call(WIDGET_CONTENT_TYPES, path);
}

/** The shared version of the widget files: first 12 hex chars of sha256 over the material hash and both files. */
export async function widgetVersion(materialHash: string, js: string, css: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([materialHash, js, css]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 12);
}

/**
 * Whether an If-None-Match header matches `etag` (a quoted strong tag).
 * Weak comparison, as RFC 9110 prescribes for If-None-Match: `W/"x"` matches
 * `"x"`. Cloudflare turns strong ETags weak when it compresses a response, so
 * browsers send them back weak.
 */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  return ifNoneMatch.split(",").some((raw) => {
    const tag = raw.trim();
    if (tag === "*") return true;
    return (tag.startsWith("W/") ? tag.slice(2) : tag) === etag;
  });
}
