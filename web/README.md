# web/

The chat widget embedded in the CV page. Vanilla JS, no framework, no build step, no dependencies.

## Files

| File | What it is |
| --- | --- |
| `widget.js` | The widget. Finds `#cv-bot`, reads `data-worker-url`, renders the input, the answer area and the footer, talks to the Worker. |
| `widget.css` | Its styles, all scoped to `#cv-bot`. System fonts only. |
| `demo.html` | A placeholder page that mounts the widget against `http://localhost:8787` for local testing. No CV content. |

`widget.js` + `widget.css` must stay under 12 KB unminified in total; `scripts/test_widget.py` checks that in CI.

## Embedding

```html
<link rel="stylesheet" href="widget.css">
<div id="cv-bot" data-worker-url="https://<your-worker>.workers.dev"></div>
<script src="widget.js" defer></script>
```

The Worker URL is the only configuration. The snippet for the real CV page is issue 7 (Embed); the owner adds it by hand.

## What it does

- A visible label, a single-line input, an "Ask" button, a remaining-characters counter. Enter sends. The button is disabled while a request is in flight, while the input is empty, and while it is over 500 characters (the Worker's limit).
- `POST <worker-url>/ask` with `{"question": "..."}`. The answer is rendered as text under an echo of the question. The first seven characters of `material_hash` are shown under it as "Material version".
- Each id in `citations` becomes an expandable quote (`<details>`/`<summary>`): the id, and the line of the material it points to. The line text comes from `GET <worker-url>/material`, fetched once per page load on the first answer that cites something (see `docs/decisions.md`, entry 3). An id that is not in the fetched material is shown as the id alone.
- `refused: true` renders the Worker's `answer` as a calm one-liner (the Worker sends a short reason for bad input and the rate limit, and "Not available right now." for everything else). A network failure, a non-JSON body, an unexpected shape or a 30-second timeout render "Not available right now." No status code or raw error ever reaches the page.
- The footer line is fixed: "This assistant only knows what is in the approved CV material. It will say so when it does not know."

## What it never does

- Interpret anything from the network as HTML. Every string is set with `textContent`; `innerHTML` and friends do not appear in the file (checked in CI).
- Set cookies, use `localStorage`/`sessionStorage`, load third-party scripts or fonts, or make any request other than the two Worker endpoints (checked in CI: no http(s) URL appears in `widget.js` or `widget.css`).
- Say anything about the owner. All text in the widget is fixed UI copy; everything about the owner comes from the Worker's answers.

## Accessibility

The input has a visible `<label>`, the counter is linked with `aria-describedby`, the answer area is `aria-live="polite"`, every control (input, button, each `<summary>`) is keyboard reachable with a visible focus ring, and the colours are chosen for at least 4.5:1 contrast. Lighthouse accessibility on `demo.html` is reported in the PR that introduces each change.

## Trying it

`docs/setup.md`, "Try the widget locally": serve `web/` over http, run `wrangler dev` with that origin allowed, open `demo.html`.

## Tests

```sh
python -m unittest scripts/test_widget.py -v
```

Static checks only: size budget, forbidden APIs, no external URLs, the demo page references nothing but the local Worker.
