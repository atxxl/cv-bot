// Markdown files are bundled as text (wrangler.toml `[[rules]]` type = "Text").
declare module "*.md" {
  const text: string;
  export default text;
}

// The widget is bundled as text too (same rule), so the Worker can serve the
// exact files in web/ at GET /widget.js and GET /widget.css.
declare module "*.css" {
  const text: string;
  export default text;
}
declare module "*/web/widget.js" {
  const text: string;
  export default text;
}
