// web/widget.js and web/widget.css are bundled as text modules (wrangler.toml
// `[[rules]]`), so GET /widget.js and GET /widget.css always serve exactly the
// files in the repo and the CV page's repository needs no copy of them.
import widgetJs from "../../web/widget.js";
import widgetCss from "../../web/widget.css";

export const WIDGET_JS: string = widgetJs;
export const WIDGET_CSS: string = widgetCss;
