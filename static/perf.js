// Records every FHIR API call the page makes (via the app's /api proxy) and shows them in a Performance drawer.
(() => {
  const KEY = "fhirconnect.perf";
  const MAX = 300;
  const SLOW_MS = 1000;
  let entries = [];
  try { entries = JSON.parse(sessionStorage.getItem(KEY)) || []; } catch {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX))); } catch {} };

  const LABELS = {
    Observation: "Load vital signs",
    Condition: "Load conditions",
    MedicationRequest: "Load medications",
  };

  function describe(method, url) {
    const path = url.pathname.slice(4); // strip "/api"
    if (path === "/next") {
      let target = url.searchParams.get("url") || "";
      try { const t = new URL(target); target = t.pathname + t.search; } catch {}
      return { label: "Load next page of results", request: `${method} ${decodeURIComponent(target)}` };
    }
    const [, type, id] = path.split("/");
    let label = `${method} ${type}`;
    if (type === "Patient") {
      if (method === "POST") label = "Create patient";
      else if (method === "PUT") label = "Update patient";
      else if (id) label = "Read patient";
      else label = url.searchParams.get("name") ? "Search patients by name" : "List patients";
    } else if (LABELS[type]) label = LABELS[type];
    return { label, request: `${method} ${decodeURIComponent(path + url.search)}` };
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/") || url.pathname === "/api/config") {
      return nativeFetch(input, init);
    }
    const method = (init.method || (input.method) || "GET").toUpperCase();
    const entry = { at: Date.now(), ...describe(method, url), status: null, total: null, fhir: null, bytes: null, page: location.pathname };
    const start = performance.now();
    const finish = () => { entry.total = performance.now() - start; entries.push(entry); save(); update(); };
    let res;
    try {
      res = await nativeFetch(input, init);
    } catch (err) {
      entry.status = "Network error";
      finish();
      throw err;
    }
    entry.status = res.status;
    const m = /fhir;dur=([\d.]+)/.exec(res.headers.get("Server-Timing") || "");
    if (m) entry.fhir = Number(m[1]);
    res.clone().arrayBuffer().then(buf => { entry.bytes = buf.byteLength; finish(); }, finish);
    return res;
  };

  // ---------- UI ----------
  let drawer, backdrop, countEl, open = false;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ms = (v) => v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
  const size = (b) => b == null ? "—" : b >= 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;
  const clock = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };

  function build() {
    const actions = el("div", "header-actions");
    const btn = el("button", "perf-btn");
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.append("Performance");
    countEl = el("span", "count", "0");
    btn.appendChild(countEl);
    btn.addEventListener("click", () => toggle(true));
    const header = document.querySelector(".header-inner");
    const server = document.getElementById("server");
    if (server) actions.appendChild(server);
    actions.appendChild(btn);
    header.appendChild(actions);

    backdrop = el("div", "perf-backdrop");
    backdrop.hidden = true;
    backdrop.addEventListener("click", () => toggle(false));
    drawer = el("aside", "perf-drawer");
    drawer.hidden = true;
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-label", "API performance");
    drawer.innerHTML = `
      <div class="perf-head">
        <div><h2>Performance</h2>
          <p>Every FHIR API call made in this browser tab, newest first. <b>Response time</b> is measured in the browser, end to end. <b>FHIR server</b> is the time the FHIR server took to answer, measured by the app server.</p></div>
        <div class="actions"><button type="button" class="secondary" data-act="clear">Clear</button><button type="button" class="secondary" data-act="close">Close</button></div>
      </div>
      <div class="perf-sum"></div>
      <div class="perf-body"></div>`;
    drawer.querySelector('[data-act="close"]').addEventListener("click", () => toggle(false));
    drawer.querySelector('[data-act="clear"]').addEventListener("click", () => { entries = []; save(); update(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) toggle(false); });
    document.body.append(backdrop, drawer);
    update();
    if (location.hash === "#performance") toggle(true);
  }

  function toggle(state) {
    open = state;
    drawer.hidden = backdrop.hidden = !open;
    if (open) { render(); drawer.querySelector('[data-act="close"]').focus(); }
  }

  function update() {
    if (!countEl) return;
    countEl.textContent = entries.length;
    if (open) render();
  }

  function render() {
    const totals = entries.map(e => e.total).filter(v => v != null);
    const errors = entries.filter(e => typeof e.status !== "number" || e.status >= 400).length;
    const sum = drawer.querySelector(".perf-sum");
    sum.innerHTML = "";
    for (const [label, value] of [["API calls", entries.length], ["Median response", ms(median(totals))],
      ["Slowest", ms(totals.length ? Math.max(...totals) : null)], ["Errors", errors]]) {
      const d = el("div"); d.append(el("div", "label", label), el("div", "value", String(value))); sum.appendChild(d);
    }
    const body = drawer.querySelector(".perf-body");
    body.innerHTML = "";
    if (!entries.length) { body.appendChild(el("div", "perf-empty", "No API calls recorded yet.")); return; }
    const max = Math.max(...totals, 1);
    const table = el("table");
    table.innerHTML = `<thead><tr><th>Time</th><th>API call</th><th>Request</th><th>Status</th><th style="text-align:right">Response time</th><th style="text-align:right">FHIR server</th><th class="col-size" style="text-align:right">Size</th></tr></thead>`;
    const tbody = el("tbody");
    for (const e of [...entries].reverse()) {
      const tr = el("tr");
      tr.appendChild(el("td", "t", clock(e.at)));
      const call = el("td"); call.appendChild(el("div", "", e.label)); tr.appendChild(call);
      const req = el("td"); const r = el("div", "req");
      const sp = e.request.indexOf(" ");
      r.append(el("span", "method " + e.request.slice(0, sp), e.request.slice(0, sp)), e.request.slice(sp + 1));
      req.appendChild(r); tr.appendChild(req);
      const ok = typeof e.status === "number" && e.status < 400;
      tr.appendChild(el("td", "code " + (ok ? "ok" : "bad"), String(e.status ?? "—")));
      const t = el("td", "n", ms(e.total));
      const bar = el("div", "perf-bar" + (e.total > SLOW_MS ? " slow" : ""));
      bar.style.width = `${Math.max(4, Math.round((e.total || 0) / max * 100))}%`;
      t.appendChild(bar); tr.appendChild(t);
      tr.appendChild(el("td", "n", ms(e.fhir)));
      tr.appendChild(el("td", "n col-size", size(e.bytes)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
