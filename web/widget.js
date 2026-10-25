/* cv-bot widget v1.
 *
 * Mount:    <div id="cv-bot" data-worker-url="<worker url>"></div>
 * Loads:    this file and widget.css. Nothing else.
 * Talks to: POST <worker-url>/ask and GET <worker-url>/material. Nothing else.
 * Stores:   nothing (no cookies, no storage, no analytics).
 * Everything that arrives over the network is rendered as text
 * (textContent), never as HTML.
 */
(function () {
  "use strict";

  var MAX_CHARS = 500; // the Worker's MAX_QUESTION_CHARS, counted the same way (string length)
  var TIMEOUT_MS = 30000;
  var NOT_AVAILABLE = "Not available right now.";
  var FOOTER = "This assistant only knows what is in the approved CV material. It will say so when it does not know.";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function init() {
    var mount = document.getElementById("cv-bot");
    if (!mount) return;
    var workerUrl = (mount.getAttribute("data-worker-url") || "").trim().replace(/\/+$/, "");
    if (!workerUrl) return;

    // -- UI -------------------------------------------------------------------
    var form = el("form", "cvb-form");
    var label = el("label", "cvb-label", "Ask a question about this CV");
    label.htmlFor = "cvb-question";
    var row = el("div", "cvb-row");
    var input = el("input", "cvb-input");
    input.type = "text";
    input.id = "cvb-question";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("enterkeyhint", "send");
    input.setAttribute("aria-describedby", "cvb-count");
    var button = el("button", "cvb-send", "Ask");
    button.type = "submit";
    var counter = el("p", "cvb-count");
    counter.id = "cvb-count";
    var asked = el("p", "cvb-asked");
    var live = el("div", "cvb-answer");
    live.setAttribute("aria-live", "polite");
    var footer = el("p", "cvb-footer", FOOTER);

    row.appendChild(input);
    row.appendChild(button);
    form.appendChild(label);
    form.appendChild(row);
    form.appendChild(counter);
    clear(mount);
    mount.appendChild(form);
    mount.appendChild(asked);
    mount.appendChild(live);
    mount.appendChild(footer);

    // -- material (the quotes behind citations) -------------------------------
    var materialRequest = null; // Promise of {hash, byId} or null, shared by every answer
    var materialReloaded = false;

    function fetchMaterial(init) {
      return fetch(workerUrl + "/material", init)
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || typeof body.hash !== "string" || !Array.isArray(body.lines)) return null;
          var byId = Object.create(null);
          body.lines.forEach(function (line) {
            if (line && typeof line.id === "string" && typeof line.text === "string") byId[line.id] = line.text;
          });
          return { hash: body.hash, byId: byId };
        })
        .catch(function () { return null; });
    }

    // Fetched once per page load, on the first answer that cites something.
    // A failed fetch is retried on the next answer. If an answer reports a
    // different material version than the copy held here (a deploy in the
    // meantime), the material is fetched once more, past the HTTP cache.
    function materialFor(hash) {
      if (!materialRequest) {
        materialRequest = fetchMaterial().then(function (m) {
          if (!m) materialRequest = null;
          return m;
        });
      }
      return materialRequest.then(function (m) {
        if (m && hash && m.hash !== hash && !materialReloaded) {
          materialReloaded = true;
          materialRequest = fetchMaterial({ cache: "reload" }).then(function (fresh) { return fresh || m; });
          return materialRequest;
        }
        return m;
      });
    }

    // -- rendering ------------------------------------------------------------
    function note(text) {
      return [el("p", "cvb-note", text)];
    }

    function show(nodes) {
      clear(live);
      nodes.forEach(function (node) { live.appendChild(node); });
    }

    function citation(id, text) {
      if (typeof text !== "string") return el("p", "cvb-cite cvb-cite-bare", id);
      var details = el("details", "cvb-cite");
      details.appendChild(el("summary", "", id));
      details.appendChild(el("blockquote", "", text));
      return details;
    }

    // `body` is whatever JSON came back. Only the documented shape is
    // rendered; anything else, and any error, is "not available".
    function render(body) {
      if (!body || typeof body !== "object" || typeof body.answer !== "string" || typeof body.refused !== "boolean") {
        return Promise.resolve(note(NOT_AVAILABLE));
      }
      if (body.refused) {
        return Promise.resolve(note(body.answer.split("\n")[0].trim() || NOT_AVAILABLE));
      }
      var ids = Array.isArray(body.citations)
        ? body.citations.filter(function (id) { return typeof id === "string"; })
        : [];
      var hash = typeof body.material_hash === "string" ? body.material_hash : "";
      var nodes = [el("p", "cvb-text", body.answer)];
      return (ids.length ? materialFor(hash) : Promise.resolve(null)).then(function (m) {
        if (ids.length) {
          var cites = el("div", "cvb-cites");
          cites.appendChild(el("p", "cvb-cites-title", "From the material"));
          ids.forEach(function (id) { cites.appendChild(citation(id, m ? m.byId[id] : undefined)); });
          nodes.push(cites);
        }
        if (hash) {
          var version = el("p", "cvb-hash", "Material version ");
          version.appendChild(el("code", "", hash.slice(0, 7)));
          nodes.push(version);
        }
        return nodes;
      });
    }

    // -- asking ---------------------------------------------------------------
    var busy = false;

    function chars(n) {
      return n + (n === 1 ? " character" : " characters");
    }

    function update() {
      var left = MAX_CHARS - input.value.length;
      counter.textContent = left >= 0 ? chars(left) + " left" : chars(-left) + " too many";
      counter.classList.toggle("cvb-over", left < 0);
      button.disabled = busy || left < 0 || input.value.trim() === "";
    }

    function ask(question) {
      busy = true;
      update();
      clear(asked);
      asked.appendChild(el("span", "cvb-asked-label", "You asked: "));
      asked.appendChild(document.createTextNode(question));
      show(note("Asking..."));

      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
      fetch(workerUrl + "/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: question }),
        signal: controller.signal,
      })
        .then(function (res) { return res.json(); })
        .then(render, function () { return note(NOT_AVAILABLE); })
        .then(show, function () { show(note(NOT_AVAILABLE)); })
        .then(function () {
          clearTimeout(timer);
          busy = false;
          update();
        });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var question = input.value;
      if (busy || question.trim() === "" || question.length > MAX_CHARS) return;
      input.value = "";
      input.focus();
      ask(question);
    });
    input.addEventListener("input", update);
    update();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
