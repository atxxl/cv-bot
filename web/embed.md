# Embedding the widget on the CV page

Three lines, pasted by hand into the CV page (`index.html` of the GitHub Pages site). Nothing in this repository edits that page, and the page needs no copy of the widget: the Worker serves `widget.js` and `widget.css` itself.

## Before you paste

1. **The Worker is deployed** with the current `main` (`docs/setup.md`, "Deploy").
2. **The switches are set in the deployed namespace**: `enabled`, `spend_cap_usd`, `material_hash` (`docs/runbook.md`, "Quick reference"; note the `--remote --preview false` on every command).
3. **It answers from the terminal.** Replace `<your-worker>` with the hostname `wrangler deploy` printed:

   ```sh
   curl -s https://<your-worker>.workers.dev/material-hash
   curl -s https://<your-worker>.workers.dev/ask -H 'content-type: application/json' -d '{"question": "What is in the material?"}'
   ```

   The second one should come back with `"refused": false` and at least one id in `"citations"`. It costs one question against the spend cap and one of your IP's 10 questions per 10 minutes. `"Not available right now."` means a switch is not set; `docs/runbook.md`, "Read the logs", says which one.
4. **Read the current widget version**, the `etag` of `/widget.js` without the quotes:

   ```sh
   curl -s -o /dev/null -D - https://<your-worker>.workers.dev/widget.js | grep -i '^etag'
   ```

## The snippet

```html
<link rel="stylesheet" href="https://<your-worker>.workers.dev/widget.css?v=<version>">
<div id="cv-bot" data-worker-url="https://<your-worker>.workers.dev"></div>
<script src="https://<your-worker>.workers.dev/widget.js?v=<version>" defer></script>
```

Replace `<your-worker>` (the same hostname in all three lines; `data-worker-url` has no path and no trailing slash) and `<version>` (step 4, both lines the same).

## Where it goes

- **The `<div>`** is where the widget appears. The current plan is right after the projects section; your call. One `#cv-bot` per page: the widget mounts on that id and nothing else.
- **The `<link>`** goes in `<head>`, so the box is styled on first paint. It also works next to the `<div>`.
- **The `<script>`** can go next to the `<div>` or just before `</body>`. `defer` runs it after the page is parsed, so its position does not matter.

The styles are scoped to `#cv-bot` and touch nothing else on the page. The widget sets no cookies, uses no storage, loads nothing else and talks only to the Worker (`web/README.md`).

## What `?v=` does

| The page asks for | The browser gets | Cached for |
| --- | --- | --- |
| `widget.js?v=<current version>` | the current file | a year (`immutable`) |
| `widget.js?v=<an older version>` | the current file | 5 minutes |
| `widget.js` (no `?v=`) | the current file | 5 minutes |

The version changes whenever `material/` or `web/widget.js`/`web/widget.css` changes and is deployed. After such a deploy, update `?v=` in both lines (step 4 again). Forgetting is harmless: visitors still get the current files, just with the 5-minute cache instead of the year-long one. The snippet without `?v=` works too, if you would rather never touch the page after a deploy.

## Check that it works

1. Reload the CV page (a hard reload, so the browser does not reuse an old copy of the page).
2. The box appears where the `<div>` is: a label "Ask a question about this CV", an input, an "Ask" button, and the line "This assistant only knows what is in the approved CV material. It will say so when it does not know."
3. Ask a question the material answers. The answer appears with a "From the material" list; expanding an id shows the quoted line. "Material version" under it shows the first seven characters of the material hash.
4. In the browser's developer tools, Network tab: `widget.js` and `widget.css` load from the Worker with 200, `ask` returns 200, `material` returns 200. The console shows no errors.

## If it does not work

| What you see | Likely cause | What to do |
| --- | --- | --- |
| No box at all | The script did not load (hostname typo, missing `https://`), or the `<div>` is missing, has another id, or has an empty `data-worker-url` | Network tab: is `widget.js` there with 200? Compare the three lines with the snippet above. |
| A box without styling | The `<link>` did not load | Network tab: is `widget.css` there with 200? |
| Every question says "Not available right now." | The kill switch is off, a switch is not set in the deployed namespace, the pinned material hash does not match the deploy, the month's cap is reached, or the API key is missing or revoked | `docs/runbook.md`, "Read the logs": the `reason` field names it. |
| `ask` returns 403 in the Network tab | The page's origin is not the Worker's `ALLOWED_ORIGIN` (for example the page moved to a custom domain) | Set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to the page's origin (`https://` + hostname, no path) and deploy. |
| Citations show only ids, no quotes | `GET /material` failed | Network tab: the `material` request and its status. |
| Console errors that mention Content-Security-Policy | The page has a CSP that does not allow the Worker | Allow `https://<your-worker>.workers.dev` in `script-src`, `style-src` and `connect-src`. |

## Taking it off the page

- **For a while** (incident, spend, anything): the kill switch, `docs/runbook.md`. The box stays on the page and answers every question with "Not available right now."; no deploy, no page edit.
- **For good**: delete the three lines from the CV page.
