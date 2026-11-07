(() => {
  "use strict";

  // ───────────────────────── Helpers ─────────────────────────
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const ON_APP_PORT = ["5184", "7184"].includes(window.location.port);
  const API_DEFAULT = ON_APP_PORT ? `${window.location.origin}/api/stock` : "http://localhost:5184/api/stock";
  const API_KEY = "equinox_api_base";
  const DEFAULT_SYMBOL = "NVDA";
  let apiBase = localStorage.getItem(API_KEY) || API_DEFAULT;
  if (ON_APP_PORT) {
    try { if (new URL(apiBase).origin !== window.location.origin) apiBase = API_DEFAULT; } catch { apiBase = API_DEFAULT; }
  }

  let latestAnalysis = null;

  const companies = {
    NVDA: "NVIDIA", MSFT: "Microsoft", AAPL: "Apple", AMZN: "Amazon", TSLA: "Tesla",
    SPY: "SPDR S&P 500 ETF (proxy)", QQQ: "Invesco Nasdaq-100 ETF (proxy)", DIA: "SPDR Dow Jones ETF (proxy)",
    IWM: "Russell 2000 ETF (proxy)", TLT: "20+ Year Treasury ETF", GLD: "Gold ETF"
  };
  const nameOf = s => companies[s] || s;
  const pageNames = { overview: "Overview", markets: "Market pulse", research: "AI research", watchlist: "Watchlist", portfolio: "Portfolio lab", reports: "Reports", settings: "Preferences" };

  const base = () => apiBase.replace(/\/+$/, "");
  const isNum = v => v != null && v !== "" && Number.isFinite(Number(v));
  const money = v => !isNum(v) ? "—" : Number(v).toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const number = (v, d = 2) => !isNum(v) ? "—" : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = v => !isNum(v) ? "—" : `${Number(v) > 0 ? "+" : ""}${number(v)}%`;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // The database stores UTC but the API returns it without a "Z"; add it so local time is shown correctly.
  const toDate = s => new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(String(s)) ? s : `${s}Z`);
  const fmtDateTime = s => toDate(s).toLocaleString();
  const todayStamp = () => new Date().toISOString().slice(0, 10);
  const smooth = () => document.body.classList.contains("reduce-motion") ? "auto" : "smooth";

  function toast(title, message, type = "info") {
    const stack = $("#toastStack"); if (!stack) return;
    const el = document.createElement("div"); el.className = `toast ${type}`;
    const icon = type === "error" ? "bi-exclamation-triangle" : type === "success" ? "bi-check-circle" : "bi-info-circle";
    el.innerHTML = `<i class="bi ${icon}"></i><div><b>${esc(title)}</b><p>${esc(message)}</p></div>`;
    stack.appendChild(el); setTimeout(() => el.remove(), 5000);
  }

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(`${base()}${path}`, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
    } catch {
      throw new Error(`Cannot reach ${base()}. Start the ASP.NET Core app and check Preferences → API connection.`);
    }
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
    if (!response.ok) throw new Error(data.message || data.title || `Request failed with HTTP ${response.status}.`);
    return data;
  }

  async function withButton(btn, fn) {
    if (btn) btn.disabled = true;
    try { await fn(); } finally { if (btn) btn.disabled = false; }
  }

  // ───────────────────────── PDF helpers (jsPDF + autoTable) ─────────────────────────
  // Standard PDF fonts only support basic Latin text, so everything written to a PDF goes through ascii().
  const ascii = v => String(v ?? "")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-").replace(/\u2026/g, "...")
    .replace(/[\u00B7\u2022]/g, "-").replace(/[^\x20-\x7E\n]/g, "");
  const cleanMarkdown = v => String(v ?? "").replace(/\*\*/g, "").replace(/__/g, "").replace(/^#{1,6}\s*/gm, "").replace(/^\s*[*-]\s+/gm, "- ");
  const pdfMoney = v => !isNum(v) ? "N/A" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pdfPct = v => !isNum(v) ? "N/A" : `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
  const pdfNum = (v, d = 2) => !isNum(v) ? "N/A" : Number(v).toFixed(d);

  const TABLE_STYLE = {
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: [30, 41, 59], lineColor: [220, 226, 236], lineWidth: 0.5 },
    headStyles: { fillColor: [16, 23, 40], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [246, 248, 252] },
    margin: { left: 40, right: 40, bottom: 50 }
  };

  function newPdf(title, subtitle) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("The PDF library could not be loaded. Check your internet connection and reload the page.");
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    if (typeof doc.autoTable !== "function") throw new Error("The PDF table plugin could not be loaded. Check your internet connection and reload the page.");
    const w = doc.internal.pageSize.getWidth();
    doc.setFillColor(16, 23, 40); doc.rect(0, 0, w, 74, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("Equinox Intelligence", 40, 34);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(170, 184, 214);
    doc.text(ascii(title), 40, 54);
    doc.text(ascii(subtitle), w - 40, 54, { align: "right" });
    doc.setTextColor(30, 41, 59);
    return doc;
  }

  function finishPdf(doc, filename) {
    const pages = doc.getNumberOfPages();
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 130, 150);
      doc.text("Educational information only - not investment advice. Verify data independently before making decisions.", 40, h - 24);
      doc.text(`Page ${i} of ${pages}`, w - 40, h - 24, { align: "right" });
    }
    doc.save(filename);
  }

  function pdfHeading(doc, text, y) {
    const h = doc.internal.pageSize.getHeight();
    if (y + 30 > h - 50) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(16, 23, 40);
    doc.text(ascii(text), 40, y);
    return y + 12;
  }

  function pdfParagraph(doc, heading, text, y) {
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    const lines = doc.splitTextToSize(ascii(text), w - 80);
    if (y + 40 > h - 50) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(16, 23, 40); doc.text(ascii(heading), 40, y); y += 16;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(51, 65, 85);
    for (const line of lines) {
      if (y > h - 50) { doc.addPage(); y = 50; }
      doc.text(line, 40, y); y += 13.5;
    }
    return y + 14;
  }

  function drawLineChart(doc, x, y, w, h, closes, dates) {
    const padL = 56, padR = 10, padT = 10, padB = 22;
    const cx = x + padL, cy = y + padT, cw = w - padL - padR, ch = h - padT - padB;
    const min = Math.min(...closes), max = Math.max(...closes), spread = max - min || 1;
    doc.setDrawColor(210, 216, 228); doc.setLineWidth(0.6); doc.rect(x, y, w, h);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(110, 120, 140);
    for (let i = 0; i <= 4; i++) {
      const gy = cy + ch * i / 4;
      doc.setDrawColor(228, 232, 240); doc.setLineWidth(0.4); doc.line(cx, gy, cx + cw, gy);
      doc.text(`$${(max - spread * i / 4).toFixed(2)}`, cx - 5, gy + 2.5, { align: "right" });
    }
    doc.setDrawColor(71, 119, 250); doc.setLineWidth(1.4);
    const n = closes.length;
    const px = i => cx + cw * i / Math.max(1, n - 1);
    const py = v => cy + ch * (max - v) / spread;
    for (let i = 1; i < n; i++) doc.line(px(i - 1), py(closes[i - 1]), px(i), py(closes[i]));
    doc.setLineWidth(0.5);
    [0, .25, .5, .75, 1].forEach((f, k) => {
      const i = Math.round((n - 1) * f);
      doc.setTextColor(110, 120, 140);
      doc.text(ascii(String(dates[i] || "").slice(0, 10)), px(i), y + h - 8, { align: k === 0 ? "left" : k === 4 ? "right" : "center" });
    });
  }

  // ───────────────────────── Navigation / search ─────────────────────────
  function setPage(name) {
    if (!pageNames[name]) name = "overview";
    $$(".page").forEach(p => p.classList.toggle("active", p.id === `page-${name}`));
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === name));
    if ($("#breadcrumbCurrent")) $("#breadcrumbCurrent").textContent = pageNames[name];
    $("#sidebar")?.classList.remove("open"); $("#commandBar")?.classList.remove("open");
    window.scrollTo({ top: 0, behavior: smooth() });
    if (name === "overview") { loadUniverse(); loadChart(); }
    if (name === "markets") loadMarketPulse();
    if (name === "watchlist") loadWatchlist();
    if (name === "portfolio") loadPortfolio();
    if (name === "reports") loadHistory();
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-page]"); if (b) { e.preventDefault(); setPage(b.dataset.page); } });
  $("#mobileMenu")?.addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#notificationBtn")?.addEventListener("click", () => $("#notificationModal").classList.remove("hidden"));
  $$(".close-modal").forEach(b => b.addEventListener("click", () => $("#notificationModal").classList.add("hidden")));
  $("#notificationModal")?.addEventListener("click", e => { if (e.target.id === "notificationModal") e.currentTarget.classList.add("hidden"); });
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#commandBar").classList.toggle("open"); $("#globalSearch").focus(); }
    if (e.key === "Escape") { $("#commandBar")?.classList.remove("open"); $("#searchResults")?.classList.remove("open"); $("#notificationModal")?.classList.add("hidden"); }
  });
  $("#globalSearchBtn")?.addEventListener("click", () => { $("#commandBar").classList.toggle("open"); $("#globalSearch").focus(); });
  $("#globalSearch")?.addEventListener("input", e => {
    const q = e.target.value.trim().toLowerCase();
    const known = { ...companies };
    universe.items.forEach(x => { if (!known[x.symbol]) known[x.symbol] = x.symbol; });
    const pages = Object.entries(pageNames).filter(([k, v]) => `${k} ${v}`.toLowerCase().includes(q)).map(([key, label]) => ({ type: "page", key, label, sub: "Workspace page" }));
    const tickers = Object.entries(known).filter(([s, n]) => `${s} ${n}`.toLowerCase().includes(q)).map(([key, label]) => ({ type: "ticker", key, label: `${key} · ${label}`, sub: "Run live analysis" }));
    const results = [...pages, ...tickers].slice(0, 10);
    $("#searchResults").innerHTML = results.map(r => `<button class="search-result" data-search-type="${r.type}" data-search-key="${esc(r.key)}"><span>${esc(r.label)}</span><small>${esc(r.sub)}</small></button>`).join("");
    $("#searchResults").classList.toggle("open", !!q && results.length > 0);
  });
  $("#searchResults")?.addEventListener("click", e => {
    const b = e.target.closest("[data-search-key]"); if (!b) return;
    if (b.dataset.searchType === "page") setPage(b.dataset.searchKey);
    else { $("#symbolInput").value = b.dataset.searchKey; setPage("research"); }
    $("#commandBar").classList.remove("open"); $("#searchResults").classList.remove("open"); $("#globalSearch").value = "";
  });

  // ───────────────────────── Overview: universe + chart ─────────────────────────
  const universe = { items: [], latest: new Map(), asOfUtc: null };
  const chartState = { symbol: DEFAULT_SYMBOL, range: "1M", data: null };
  let chartRequest = 0;

  function overviewMetric(title, value, foot) {
    return `<article class="metric-card"><div class="metric-top"><span>${esc(title)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-foot"><span class="mini-pill neutral">${esc(foot)}</span></div></article>`;
  }

  function renderUniverse() {
    const rows = $("#universeRows"); if (!rows) return;
    const items = universe.items;
    const latestBySymbol = universe.latest;

    const tape = $("#overviewTickerTape");
    if (tape) {
      tape.innerHTML = items.map(x => {
        const sel = x.symbol === chartState.symbol ? " selected" : "";
        return x.error
          ? `<div class="ticker-item${sel}" data-symbol="${esc(x.symbol)}"><span>${esc(x.symbol)}</span><b>Unavailable</b><em>${esc(x.error)}</em></div>`
          : `<div class="ticker-item${sel}" data-symbol="${esc(x.symbol)}"><span>${esc(x.symbol)}</span><b>${money(x.price)}</b><em class="${Number(x.return20DayPercent) >= 0 ? "positive" : "negative"}">${pct(x.return20DayPercent)} · 20D</em></div>`;
      }).join("") || "No stocks in the research universe.";
    }

    rows.innerHTML = items.map(x => {
      const sel = x.symbol === chartState.symbol ? " selected" : "";
      const removeBtn = x.isCustom ? `<button class="row-action remove-universe" data-symbol="${esc(x.symbol)}" title="Remove ${esc(x.symbol)} from the universe" aria-label="Remove ${esc(x.symbol)}">✕</button>` : "";
      const actions = `<div class="row-actions"><button class="row-action analyze-symbol" data-symbol="${esc(x.symbol)}" title="Run AI analysis" aria-label="Analyze ${esc(x.symbol)}">↗</button>${removeBtn}</div>`;
      if (x.error) {
        return `<tr class="universe-row${sel}" data-symbol="${esc(x.symbol)}" data-company="${esc(nameOf(x.symbol))}"><td><b>${esc(x.symbol)}</b><small>${esc(nameOf(x.symbol))}</small></td><td colspan="5">Live data unavailable: ${esc(x.error)}</td><td>${actions}</td></tr>`;
      }
      const saved = latestBySymbol.get(x.symbol);
      const action = String(saved?.action || "").toUpperCase();
      const tag = x.isCustom ? " · Custom" : "";
      return `<tr class="universe-row${sel}" data-symbol="${esc(x.symbol)}" data-company="${esc(nameOf(x.symbol))}">`
        + `<td><div class="asset-cell"><div class="company-logo">${esc(x.symbol.slice(0, 1))}</div><div><b>${esc(nameOf(x.symbol))}</b><small>${esc(x.symbol)} · Provider daily close${tag}</small></div></div></td>`
        + `<td class="mono">${money(x.price)}</td>`
        + `<td class="mono ${Number(x.return20DayPercent) >= 0 ? "positive" : "negative"}">${pct(x.return20DayPercent)} <small>(20-day)</small></td>`
        + `<td class="mono">${saved ? esc(saved.score) : "—"}</td>`
        + `<td>${saved ? `<span class="signal-chip ${esc(action.toLowerCase())}">${esc(action)}</span>` : '<span class="risk-label">Not analyzed</span>'}</td>`
        + `<td class="risk-label">${x.volatilityPercent == null ? "—" : `${number(x.volatilityPercent)}% vol.`}</td>`
        + `<td>${actions}</td></tr>`;
    }).join("") || `<tr><td colspan="7">No live market data returned.</td></tr>`;

    const count = $("#universeCount"); if (count) count.textContent = `${items.length} asset${items.length === 1 ? "" : "s"}`;
    applyUniverseFilter();
  }

  function applyUniverseFilter() {
    const q = ($("#universeFilter")?.value || "").toLowerCase();
    $$("#universeRows tr[data-symbol]").forEach(r => r.classList.toggle("hidden", !`${r.dataset.symbol || ""} ${r.dataset.company || ""}`.toLowerCase().includes(q)));
  }

  async function loadUniverse() {
    const rows = $("#universeRows"); if (!rows) return;
    rows.innerHTML = '<tr><td colspan="7">Loading live market data…</td></tr>';
    try {
      const data = await api("/universe");
      const items = data.rows || [];
      let previous = [];
      try { previous = await api("/history?take=200"); } catch { /* history is optional here */ }
      const latestBySymbol = new Map();
      for (const record of previous) if (!latestBySymbol.has(record.symbol)) latestBySymbol.set(record.symbol, record);
      universe.items = items; universe.latest = latestBySymbol; universe.asOfUtc = data.asOfUtc;

      let symbolChanged = false;
      if (items.length && !items.some(x => x.symbol === chartState.symbol)) { chartState.symbol = items[0].symbol; symbolChanged = true; }
      renderUniverse();

      const grid = $("#page-overview .metric-grid");
      if (grid) grid.innerHTML = [
        overviewMetric("Live symbols returned", items.filter(x => !x.error).length, "Provider response"),
        overviewMetric("Tracked universe", `${items.length} symbols`, "Defaults + your additions"),
        overviewMetric("Previously analyzed", items.filter(x => !x.error && latestBySymbol.has(x.symbol)).length, "Stored SQL Server analyses"),
        overviewMetric("Data timestamp", new Date(data.asOfUtc || Date.now()).toLocaleTimeString(), "Backend response time")
      ].join("");
      const note = $("#page-overview .micro-label");
      if (note) note.textContent = `Provider response · ${new Date(data.asOfUtc || Date.now()).toLocaleString()}`;
      if (symbolChanged) loadChart();
    } catch (err) {
      rows.innerHTML = `<tr><td colspan="7">${esc(err.message)}</td></tr>`;
      const grid = $("#page-overview .metric-grid");
      if (grid) grid.innerHTML = overviewMetric("Live market data", "Unavailable", err.message);
    }
  }

  // Pick a stock → the chart (and the highlighted row) follow it.
  function selectSymbol(symbol, scroll = true) {
    chartState.symbol = symbol;
    $$("#universeRows tr[data-symbol]").forEach(r => r.classList.toggle("selected", r.dataset.symbol === symbol));
    $$("#overviewTickerTape .ticker-item").forEach(t => t.classList.toggle("selected", t.dataset.symbol === symbol));
    loadChart();
    if (scroll) $(".chart-panel")?.scrollIntoView({ behavior: smooth(), block: "center" });
  }

  $("#universeRows")?.addEventListener("click", e => {
    const analyze = e.target.closest(".analyze-symbol");
    if (analyze) { $("#symbolInput").value = analyze.dataset.symbol; setPage("research"); return; }
    const remove = e.target.closest(".remove-universe");
    if (remove) { removeUniverseStock(remove.dataset.symbol); return; }
    const row = e.target.closest("tr[data-symbol]");
    if (row) selectSymbol(row.dataset.symbol);
  });
  $("#overviewTickerTape")?.addEventListener("click", e => {
    const item = e.target.closest(".ticker-item[data-symbol]");
    if (item) selectSymbol(item.dataset.symbol);
  });
  $("#universeFilter")?.addEventListener("input", applyUniverseFilter);
  $("#refreshUniverse")?.addEventListener("click", () => { loadUniverse(); loadChart(); });

  // Add / remove custom stocks (stored in SQL Server, validated against the market-data provider).
  $("#addStockForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#addStockInput");
    const symbol = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,10}$/.test(symbol)) { toast("Invalid ticker", "Use 1–10 letters, digits, dots or hyphens.", "error"); return; }
    await withButton($("#addStockBtn"), async () => {
      try {
        await api("/universe", { method: "POST", body: JSON.stringify({ symbol }) });
        input.value = "";
        chartState.symbol = symbol;
        toast("Stock added", `${symbol} was added to your research universe and is now shown in the chart.`, "success");
        await loadUniverse();
        loadChart();
      } catch (err) { toast("Could not add stock", err.message, "error"); }
    });
  });

  async function removeUniverseStock(symbol) {
    if (!confirm(`Remove ${symbol} from your research universe?`)) return;
    try {
      await api(`/universe/${encodeURIComponent(symbol)}`, { method: "DELETE" });
      if (chartState.symbol === symbol) chartState.symbol = DEFAULT_SYMBOL;
      toast("Stock removed", `${symbol} was removed from the research universe.`, "success");
      await loadUniverse();
      loadChart();
    } catch (err) { toast("Could not remove stock", err.message, "error"); }
  }

  async function loadChart() {
    const svg = $(".performance-chart"); if (!svg) return;
    const symbol = chartState.symbol, range = chartState.range;
    const ticket = ++chartRequest;
    const title = $("#chartTitle"), sub = $("#chartSub"), legend = $("#chartLegend"), yl = $("#chartYLabels"), xl = $("#chartXLabels");
    const linePath = svg.querySelector(".line-blue"), areaPath = svg.querySelector(".area-path");
    if (title) title.textContent = `${nameOf(symbol)} (${symbol})`;
    if (sub) sub.textContent = `Loading ${symbol} ${range} provider history…`;
    try {
      const data = await api(`/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}`);
      if (ticket !== chartRequest) return; // a newer selection replaced this request
      if (!Array.isArray(data.closes) || data.closes.length < 2) throw new Error(data.note || "Provider returned insufficient daily prices.");
      const prices = data.closes, dates = data.dates || [];
      const width = 760, height = 220, pad = 12;
      const min = Math.min(...prices), max = Math.max(...prices), spread = max - min || 1;
      const points = prices.map((p, i) => [i / (prices.length - 1) * width, pad + (max - p) / spread * (height - pad * 2)]);
      const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
      linePath?.setAttribute("d", line);
      areaPath?.setAttribute("d", `${line} L${width} ${height} L0 ${height} Z`);

      const change = prices[0] ? (prices[prices.length - 1] / prices[0] - 1) * 100 : null;
      if (legend) legend.innerHTML = `<span><i class="legend-dot blue-dot"></i> ${esc(data.symbol)}</span> <span class="${Number(change) >= 0 ? "positive" : "negative"}">${pct(change)} over ${esc(range)}</span>`;
      if (sub) sub.textContent = `${data.symbol} daily closes · ${prices.length} observations · USD${data.note ? ` · ${data.note}` : ""}`;
      if (yl) yl.innerHTML = [max, max - spread * .25, max - spread * .5, max - spread * .75, min].map(v => `<span>${money(v)}</span>`).join("");
      if (xl) {
        const last = dates.length - 1;
        const ix = [0, Math.floor(last * .25), Math.floor(last * .5), Math.floor(last * .75), last];
        xl.innerHTML = ix.map(i => `<span>${esc(dates[i] || `Point ${i + 1}`)}</span>`).join("");
      }
      chartState.data = { symbol: data.symbol, range, closes: prices, dates };
    } catch (err) {
      if (ticket !== chartRequest) return;
      chartState.data = null;
      if (sub) sub.textContent = `Live chart unavailable: ${err.message}`;
      linePath?.setAttribute("d", ""); areaPath?.setAttribute("d", "");
      if (legend) legend.textContent = "No verified chart data";
      if (xl) xl.textContent = ""; if (yl) yl.textContent = "";
      toast("Chart unavailable", err.message, "error");
    }
  }
  $("#chartRange")?.addEventListener("click", e => {
    const b = e.target.closest("button[data-range]"); if (!b) return;
    $$("#chartRange button").forEach(x => x.classList.toggle("selected", x === b));
    chartState.range = b.dataset.range; loadChart();
  });

  // Overview → Export snapshot (PDF): universe table + chart of the currently selected stock.
  $("#exportOverview")?.addEventListener("click", () => withButton($("#exportOverview"), async () => {
    try {
      if (!universe.items.length) await loadUniverse();
      if (!universe.items.length) throw new Error("No market data is available to export.");
      if (!chartState.data || chartState.data.symbol !== chartState.symbol) await loadChart();
      const items = universe.items, latest = universe.latest, chart = chartState.data;

      const doc = newPdf("Market snapshot", new Date().toLocaleString());
      let y = 104;
      y = pdfHeading(doc, "Research universe - latest provider daily closes", y);
      doc.autoTable({
        ...TABLE_STYLE, startY: y + 6,
        head: [["Symbol", "Company", "Latest close", "20-day return", "Volatility (ann.)", "Score", "Model view"]],
        body: items.map(x => {
          const saved = latest.get(x.symbol);
          if (x.error) return [x.symbol, nameOf(x.symbol), "Unavailable", "-", "-", "-", "-"];
          return [x.symbol, nameOf(x.symbol), pdfMoney(x.price), pdfPct(x.return20DayPercent), x.volatilityPercent == null ? "N/A" : `${pdfNum(x.volatilityPercent)}%`, saved ? String(saved.score) : "-", saved ? String(saved.action) : "Not analyzed"];
        }),
        didParseCell: d => {
          if (d.section !== "body") return;
          if (d.column.index === 3) { const t = String(d.cell.raw); if (t.startsWith("+")) d.cell.styles.textColor = [22, 163, 110]; else if (t.startsWith("-")) d.cell.styles.textColor = [225, 60, 85]; }
          if (d.column.index === 6) { const t = String(d.cell.raw); if (t === "BUY") d.cell.styles.textColor = [22, 163, 110]; else if (t === "SELL") d.cell.styles.textColor = [225, 60, 85]; }
        }
      });
      y = doc.lastAutoTable.finalY + 26;

      const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
      if (chart) {
        if (y + 330 > pageH - 50) { doc.addPage(); y = 50; }
        y = pdfHeading(doc, `Price chart - ${nameOf(chart.symbol)} (${chart.symbol}), ${chart.range}`, y);
        drawLineChart(doc, 40, y + 8, pageW - 80, 210, chart.closes, chart.dates);
        y += 8 + 210 + 16;
        const first = chart.closes[0], last = chart.closes[chart.closes.length - 1];
        doc.autoTable({
          ...TABLE_STYLE, startY: y,
          head: [["Observations", "First close", "Last close", "Change", "High", "Low"]],
          body: [[String(chart.closes.length), pdfMoney(first), pdfMoney(last), pdfPct((last / first - 1) * 100), pdfMoney(Math.max(...chart.closes)), pdfMoney(Math.min(...chart.closes))]]
        });
        y = doc.lastAutoTable.finalY + 20;
      } else {
        y = pdfParagraph(doc, "Price chart", "Chart data for the selected stock was unavailable when this snapshot was created.", y);
      }
      pdfParagraph(doc, "Notes", "Prices are the market-data provider's latest available daily closes, not real-time quotes. Volatility is the annualized standard deviation of the last 20 daily returns. Model scores appear only for stocks that have been analyzed. This document is decision support, not financial advice.", y);
      finishPdf(doc, `equinox-snapshot-${todayStamp()}.pdf`);
      toast("Snapshot exported", "The PDF was downloaded.", "success");
    } catch (e) { toast("Export failed", e.message, "error"); }
  }));

  // ───────────────────────── Research ─────────────────────────
  $$(".quick-symbols button").forEach(b => b.addEventListener("click", () => $("#symbolInput").value = b.dataset.symbol));
  $("#analysisForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const symbol = $("#symbolInput").value.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,10}$/.test(symbol)) { toast("Invalid ticker", "Use 1–10 letters, digits, dots or hyphens.", "error"); return; }
    await runAnalysis(symbol);
  });
  $("#runAgain")?.addEventListener("click", () => runAnalysis($("#resultSymbol").textContent));

  async function runAnalysis(symbol) {
    setPage("research");
    $("#resultEmpty").classList.add("hidden"); $("#analysisOutput").classList.add("hidden"); $("#analysisLoading").classList.remove("hidden"); $("#runAnalysis").disabled = true;
    try {
      const data = await api("/analyze", { method: "POST", body: JSON.stringify({ symbol, includeAiExplanation: $("#includeAi").checked, horizon: $("#horizonSelect").value }) });
      if (data.technicalMetrics?.latestPrice == null) throw new Error("The provider returned no verified latest price; no score was generated.");
      data.generatedUtc = new Date().toISOString();
      latestAnalysis = data; renderAnalysis(data); setApiState(true);
      toast("Analysis complete", data.id != null ? `${symbol} analyzed and added to your Watchlist.` : `${symbol} analyzed, but not saved because SQL Server is unavailable.`, "success");
    } catch (err) {
      $("#resultEmpty").classList.remove("hidden"); setApiState(false); toast("Analysis failed", err.message, "error");
    } finally {
      $("#analysisLoading").classList.add("hidden"); $("#runAnalysis").disabled = false;
    }
  }
  function setApiState(ok) {
    const el = $("#apiState"); if (!el) return;
    el.classList.toggle("connected", ok); el.classList.toggle("error", !ok);
    el.innerHTML = `<span class="pulse"></span> ${ok ? "API connected" : "API/data unavailable"}`;
  }
  function renderAnalysis(d) {
    $("#analysisOutput").classList.remove("hidden"); $("#resultEmpty").classList.add("hidden");
    const symbol = String(d.symbol || "UNKNOWN");
    $("#resultSymbol").textContent = symbol; $("#resultSubtitle").textContent = `${nameOf(symbol)} · provider-backed price analysis`;
    $("#resultLogo").textContent = symbol[0] || "?"; $("#resultTimestamp").textContent = `Provider response ${new Date().toLocaleString()}`;
    const score = d.scorecard?.score, action = String(d.scorecard?.action || "UNAVAILABLE").toUpperCase();
    $("#resultScore").textContent = score == null ? "—" : `${Number(score) > 0 ? "+" : ""}${score}`;
    const degree = score == null ? 0 : Math.max(0, Math.min(300, (Number(score) + 100) / 200 * 300));
    $("#scoreGauge").style.background = `conic-gradient(from 0deg, ${action === "BUY" ? "#4bd6a0" : action === "SELL" ? "#ff6e83" : "#779aff"} 0deg, #a58bff ${degree}deg, #26334d ${degree}deg 360deg)`;
    $("#resultAction").textContent = action;
    $("#resultAction").className = `verdict-badge ${["BUY", "SELL", "HOLD"].includes(action) ? action.toLowerCase() : "hold"}`;
    $("#resultHeadline").textContent = action === "BUY" ? "Positive price-derived signal" : action === "SELL" ? "Negative price-derived signal" : "Neutral price-derived signal";
    $("#resultSummary").textContent = d.scorecard?.summary || "No score summary returned.";
    const m = d.technicalMetrics || {};
    $("#resultPrice").textContent = money(m.latestPrice); $("#resultReturn").textContent = pct(m.return20DayPercent);
    $("#resultReturn").className = Number(m.return20DayPercent) >= 0 ? "positive" : "negative";
    $("#resultVolatility").textContent = m.annualizedVolatility20DayPercent == null ? "—" : `${number(m.annualizedVolatility20DayPercent)}%`;
    const fs = d.scorecard?.factorScores || {};
    [["trend", "factorTrend", "barTrend"], ["momentum", "factorMomentum", "barMomentum"], ["valuation_quality", "factorValuation", "barValuation"], ["risk", "factorRisk", "barRisk"], ["sentiment", "factorSentiment", "barSentiment"]].forEach(([k, nid, bid]) => {
      const v = fs[k], el = $(`#${nid}`), bar = $(`#${bid}`);
      el.textContent = v == null ? "N/A" : `${Number(v) > 0 ? "+" : ""}${v}`;
      bar.style.width = v == null ? "0" : `${Math.min(100, Math.abs(Number(v)))}%`;
      bar.style.left = Number(v) < 0 ? `${50 - Math.min(100, Math.abs(Number(v))) / 2}%` : "50%";
    });
    const missing = d.scorecard?.missingFactors || [];
    $("#missingFactors").classList.toggle("hidden", !missing.length);
    $("#missingFactors").querySelector("span").textContent = missing.length ? `Unavailable factors: ${missing.join(", ")}. N/A is not zero; the score uses only available price-derived factors.` : "";
    $("#aiNarrative").textContent =
    d.aiExplanation ||
    "AI explanation is temporarily unavailable for this analysis. See the provider error below.";
    $("#aiError").classList.toggle("hidden", !d.aiExplanationError); $("#aiError").textContent = d.aiExplanationError || "";
    $("#resultDataLabel").textContent = d.dataNote || "Verified provider daily-close data";
  }

  // Normalise a live API result or a saved SQL Server record into one shape for PDF output.
  const FACTOR_ROWS = [["trend", "Trend", "30%"], ["momentum", "Momentum", "20%"], ["valuation_quality", "Valuation & quality", "20%"], ["risk", "Risk", "15%"], ["sentiment", "Sentiment", "15%"]];
  const parseJson = (v, fallback) => { try { return JSON.parse(v) ?? fallback; } catch { return fallback; } };
  const fromLive = d => ({
    symbol: d.symbol, createdUtc: d.generatedUtc || new Date().toISOString(), horizon: d.researchHorizon,
    price: d.technicalMetrics?.latestPrice, return20: d.technicalMetrics?.return20DayPercent, vol: d.technicalMetrics?.annualizedVolatility20DayPercent,
    score: d.scorecard?.score, action: d.scorecard?.action, summary: d.scorecard?.summary,
    factors: d.scorecard?.factorScores || {}, missing: d.scorecard?.missingFactors || [], ai: d.aiExplanation, aiError: d.aiExplanationError, note: d.dataNote
  });
  const fromRecord = r => ({
    symbol: r.symbol, createdUtc: r.createdUtc, price: r.latestPrice, return20: r.return20DayPercent, vol: r.annualizedVolatility20DayPercent,
    score: r.score, action: r.action, summary: r.summary, factors: parseJson(r.factorScoresJson, {}), missing: parseJson(r.missingFactorsJson, []), ai: r.aiExplanation, note: r.dataNote
  });

  function buildAnalysisPdf(rec) {
    const doc = newPdf("Stock analysis report", `${rec.symbol} - ${fmtDateTime(rec.createdUtc)}`);
    let y = 104;
    y = pdfHeading(doc, `${nameOf(rec.symbol)} (${rec.symbol})`, y);
    doc.autoTable({
      ...TABLE_STYLE, startY: y + 6, head: [["Metric", "Value"]],
      body: [
        ["Model view", String(rec.action || "N/A")],
        ["Model score (-100 to +100)", rec.score == null ? "N/A" : String(rec.score)],
        ["Latest daily close", pdfMoney(rec.price)],
        ["20-day return", pdfPct(rec.return20)],
        ["20-day annualized volatility", rec.vol == null ? "N/A" : `${pdfNum(rec.vol)}%`],
        ...(rec.horizon ? [["Research horizon", String(rec.horizon)]] : [])
      ],
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 190 } }
    });
    y = doc.lastAutoTable.finalY + 22;
    y = pdfParagraph(doc, "Summary", rec.summary || "No summary was returned.", y);
    y = pdfHeading(doc, "Factor contribution", y);
    doc.autoTable({
      ...TABLE_STYLE, startY: y + 6, head: [["Factor", "Weight", "Score"]],
      body: FACTOR_ROWS.map(([k, label, weight]) => [label, weight, rec.factors[k] == null ? "N/A (not available)" : `${rec.factors[k] > 0 ? "+" : ""}${rec.factors[k]}`])
    });
    y = doc.lastAutoTable.finalY + 14;
    if (rec.missing?.length) y = pdfParagraph(doc, "Unavailable factors", `${rec.missing.join(", ")}. N/A is not zero; the score uses only the available price-derived factors, re-weighted.`, y);
    y = pdfParagraph(doc, "AI narrative", rec.ai ? cleanMarkdown(rec.ai) : (rec.aiError || "No AI explanation was saved for this analysis."), y);
    if (rec.note) y = pdfParagraph(doc, "Data note", rec.note, y);
    return doc;
  }

  $("#saveAnalysis")?.addEventListener("click", async () => {
    if (!latestAnalysis) return toast("Nothing to save", "Run an analysis first.", "error");
    try {
      await api("/watchlist", { method: "POST", body: JSON.stringify({ symbol: latestAnalysis.symbol, label: nameOf(latestAnalysis.symbol) }) });
      toast("Watchlist updated", `${latestAnalysis.symbol} is saved in SQL Server. Analysis history was recorded by the backend.`, "success");
    } catch (e) {
      if (/already|duplicate/i.test(e.message)) toast("Already tracked", e.message); else toast("Save failed", e.message, "error");
    }
  });
  $("#copyResult")?.addEventListener("click", async () => {
    if (!latestAnalysis) return;
    const r = fromLive(latestAnalysis);
    const text = [
      `Equinox analysis - ${r.symbol} (${nameOf(r.symbol)})`,
      `Model view: ${r.action} (score ${r.score})`,
      `Latest daily close: ${pdfMoney(r.price)} | 20-day return: ${pdfPct(r.return20)} | Volatility: ${r.vol == null ? "N/A" : pdfNum(r.vol) + "%"}`,
      `Summary: ${r.summary || ""}`,
      "Educational information only - not investment advice."
    ].join("\n");
    try { await navigator.clipboard.writeText(text); toast("Copied", "Analysis summary copied to clipboard.", "success"); }
    catch { toast("Copy failed", "Your browser blocked clipboard access. Use Download PDF instead.", "error"); }
  });
  $("#downloadResult")?.addEventListener("click", () => {
    if (!latestAnalysis) return;
    try { finishPdf(buildAnalysisPdf(fromLive(latestAnalysis)), `${latestAnalysis.symbol.toLowerCase()}-analysis-${todayStamp()}.pdf`); }
    catch (e) { toast("PDF failed", e.message, "error"); }
  });

  // ───────────────────────── Watchlist ─────────────────────────
  async function loadWatchlist() {
    const body = $("#watchlistRows"); if (!body) return;
    body.innerHTML = '<tr><td colspan="6">Loading watchlist…</td></tr>';
    try {
      const items = await api("/watchlist");
      $("#watchCount").textContent = items.length;
      const stamps = items.map(w => w.lastAnalyzedUtc).filter(Boolean).sort();
      $("#watchLast").textContent = stamps.length ? fmtDateTime(stamps[stamps.length - 1]) : "No saved analysis";
      items.sort((a, b) => (b.score ?? -9999) - (a.score ?? -9999));
      body.innerHTML = items.map(w => {
        const analyzed = w.action != null;
        const action = String(w.action || "").toUpperCase();
        return `<tr><td><div class="asset-cell"><div class="company-logo">${esc(w.symbol[0])}</div><div><b>${esc(w.symbol)}</b><small>${esc(w.label || nameOf(w.symbol))}</small></div></div></td>`
          + `<td class="mono">${money(w.latestPrice)}</td>`
          + `<td class="mono">${w.score == null ? "—" : esc(w.score)}</td>`
          + `<td>${analyzed ? `<span class="signal-chip ${esc(action.toLowerCase())}" title="${esc(w.summary || "")}">${esc(action)}</span>` : '<span class="risk-label">Not analyzed</span>'}</td>`
          + `<td>${w.lastAnalyzedUtc ? esc(fmtDateTime(w.lastAnalyzedUtc)) : "—"}</td>`
          + `<td><button class="btn btn-secondary btn-small watch-analyze" data-symbol="${esc(w.symbol)}">Analyze</button> <button class="btn btn-danger-outline btn-small watch-remove" data-symbol="${esc(w.symbol)}">Remove</button></td></tr>`;
      }).join("") || `<tr><td colspan="6">Watchlist is empty. Run an analysis in AI research and the stock appears here automatically.</td></tr>`;
    } catch (e) { body.innerHTML = `<tr><td colspan="6">${esc(e.message)}</td></tr>`; }
  }
  $("#watchlistRows")?.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.classList.contains("watch-analyze")) { $("#symbolInput").value = b.dataset.symbol; setPage("research"); return; }
    if (b.classList.contains("watch-remove")) {
      try { await api(`/watchlist/${encodeURIComponent(b.dataset.symbol)}`, { method: "DELETE" }); await loadWatchlist(); toast("Removed", `${b.dataset.symbol} removed from SQL Server watchlist.`, "success"); }
      catch (err) { toast("Remove failed", err.message, "error"); }
    }
  });
  $("#clearSaved")?.addEventListener("click", async () => {
    if (!confirm("Delete all saved analysis history from SQL Server? This cannot be undone.")) return;
    try { await api("/history", { method: "DELETE" }); await loadWatchlist(); toast("History cleared", "Saved analysis records were deleted from SQL Server.", "success"); }
    catch (e) { toast("Could not clear history", e.message, "error"); }
  });

  // ───────────────────────── Market pulse ─────────────────────────
  async function loadMarketPulse() {
    const page = $("#page-markets"); if (!page) return;
    page.innerHTML = `<div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> LIVE PROVIDER DATA</div><h1>Market <span class="gradient-text">pulse.</span></h1><p class="page-subtitle">Latest available daily closes for ETF proxies and 20-day price-derived metrics. These are not the underlying indexes.</p></div><div class="heading-actions"><button class="btn btn-secondary" id="refreshMarketPulse">Refresh data</button></div></div><div class="table-panel"><div class="table-toolbar"><div><h3>Market proxies</h3><p class="muted" id="marketPulseStamp">Loading provider data…</p></div></div><div class="responsive-table"><table><thead><tr><th>SYMBOL</th><th>INSTRUMENT</th><th>LATEST CLOSE</th><th>20-DAY RETURN</th><th>ANNUALIZED VOLATILITY</th><th>STATUS</th></tr></thead><tbody id="marketPulseRows"><tr><td colspan="6">Loading…</td></tr></tbody></table></div></div><p class="disclaimer">ETF prices and metrics are provided by the configured market-data provider. A failed request is shown as unavailable, never replaced with sample values.</p>`;
    $("#refreshMarketPulse").addEventListener("click", loadMarketPulse);
    try {
      const d = await api("/market-pulse");
      $("#marketPulseStamp").textContent = `Provider response: ${new Date(d.asOfUtc).toLocaleString()}`;
      $("#marketPulseRows").innerHTML = (d.rows || []).map(x => x.error
        ? `<tr><td><b>${esc(x.symbol)}</b></td><td>${esc(nameOf(x.symbol))}</td><td colspan="4">Unavailable: ${esc(x.error)}</td></tr>`
        : `<tr><td><b>${esc(x.symbol)}</b></td><td>${esc(nameOf(x.symbol))}</td><td class="mono">${money(x.price)}</td><td class="mono ${Number(x.return20DayPercent) >= 0 ? "positive" : "negative"}">${pct(x.return20DayPercent)}</td><td class="mono">${x.volatilityPercent == null ? "—" : `${number(x.volatilityPercent)}%`}</td><td><span class="risk-label">Provider daily close</span></td></tr>`).join("");
    } catch (e) {
      $("#marketPulseRows").innerHTML = `<tr><td colspan="6">${esc(e.message)}</td></tr>`; $("#marketPulseStamp").textContent = "Data unavailable";
    }
  }

  // ───────────────────────── Portfolio lab ─────────────────────────
  async function loadPortfolio() {
    const page = $("#page-portfolio"); if (!page) return;
    page.innerHTML = `<div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> USER-ENTERED HOLDINGS + PROVIDER DAILY CLOSES</div><h1>Portfolio <span class="gradient-text">lab.</span></h1><p class="page-subtitle">Add quantity and average cost. Current valuation uses the latest available provider daily closes; this is not a brokerage connection.</p></div><div class="heading-actions"><button class="btn btn-secondary" id="refreshPortfolio">Refresh prices</button></div></div><div class="watchlist-summary"><div><span class="muted">Market value</span><b id="portfolioValue">—</b></div><div><span class="muted">Cost basis</span><b id="portfolioCost">—</b></div><div><span class="muted">Unrealized gain/loss</span><b id="portfolioGain">—</b></div></div><div class="panel" style="padding:20px;margin:20px 0"><h3>Add holding</h3><form id="portfolioForm" class="portfolio-form" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:14px"><input name="symbol" placeholder="Ticker (e.g. AAPL)" maxlength="10" required style="padding:12px;flex:1;min-width:140px"><input name="quantity" type="number" min="0.000001" step="any" placeholder="Quantity" required style="padding:12px;flex:1;min-width:120px"><input name="averageCost" type="number" min="0.000001" step="any" placeholder="Average cost (USD)" required style="padding:12px;flex:1;min-width:150px"><button class="btn btn-primary" type="submit">Add holding</button></form><p class="muted" style="margin-top:10px">Only symbols verified by the market-data provider can be added. Prices are latest available daily closes, not intraday quotes. Quantities and costs are supplied by you.</p></div><div class="table-panel"><div class="table-toolbar"><div><h3>Holdings</h3><p class="muted" id="portfolioStamp">Loading…</p></div></div><div class="responsive-table"><table><thead><tr><th>SYMBOL</th><th>QUANTITY</th><th>AVERAGE COST</th><th>LATEST CLOSE</th><th>MARKET VALUE</th><th>GAIN / LOSS</th><th></th></tr></thead><tbody id="portfolioRows"><tr><td colspan="7">Loading…</td></tr></tbody></table></div></div><p class="disclaimer">Gain/loss is current value minus the average cost you entered. No dividends, fees, taxes, currency conversion, or brokerage transactions are included.</p>`;
    $("#refreshPortfolio").addEventListener("click", loadPortfolio);
    $("#portfolioForm").addEventListener("submit", async e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const payload = { symbol: String(f.get("symbol")).trim().toUpperCase(), quantity: Number(f.get("quantity")), averageCost: Number(f.get("averageCost")) };
      try { await api("/portfolio", { method: "POST", body: JSON.stringify(payload) }); toast("Holding added", `${payload.symbol} was saved to SQL Server.`, "success"); await loadPortfolio(); }
      catch (err) { toast("Could not add holding", err.message, "error"); }
    });
    try {
      const d = await api("/portfolio");
      $("#portfolioValue").textContent = money(d.totalValue); $("#portfolioCost").textContent = money(d.totalCost);
      $("#portfolioGain").textContent = d.totalValue == null ? "Unavailable — one or more holdings have no verified price" : d.totalCost ? `${money(d.gainLoss)} (${pct(d.gainLossPercent)})` : "—";
      $("#portfolioStamp").textContent = `Updated ${new Date(d.asOfUtc).toLocaleString()}`;
      $("#portfolioRows").innerHTML = (d.rows || []).map(x => x.error
        ? `<tr><td><b>${esc(x.symbol)}</b></td><td>${number(x.quantity, 4)}</td><td>${money(x.averageCost)}</td><td colspan="4">Provider daily close unavailable: ${esc(x.error)}</td></tr>`
        : `<tr><td><b>${esc(x.symbol)}</b></td><td>${number(x.quantity, 4)}</td><td>${money(x.averageCost)}</td><td>${money(x.price)}</td><td>${money(x.currentValue)}</td><td class="${Number(x.gainLoss) >= 0 ? "positive" : "negative"}">${money(x.gainLoss)} (${pct(x.gainLossPercent)})</td><td><button class="btn btn-danger-outline btn-small portfolio-remove" data-id="${x.id}">Remove</button></td></tr>`).join("") || `<tr><td colspan="7">No holdings yet. Add your first holding above.</td></tr>`;
      $("#portfolioRows").addEventListener("click", async e => {
        const b = e.target.closest(".portfolio-remove"); if (!b) return;
        try { await api(`/portfolio/${b.dataset.id}`, { method: "DELETE" }); toast("Holding removed", "Portfolio updated.", "success"); loadPortfolio(); }
        catch (err) { toast("Remove failed", err.message, "error"); }
      });
    } catch (e) { $("#portfolioRows").innerHTML = `<tr><td colspan="7">${esc(e.message)}</td></tr>`; }
  }

  // ───────────────────────── Reports (PDF only) ─────────────────────────
  async function loadHistory() {
    const body = $("#historyRows"); if (!body) return;
    body.innerHTML = '<tr><td colspan="5">Loading SQL Server analysis history…</td></tr>';
    try {
      const rows = await api("/history?take=200");
      $("#historyCount").textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
      body.innerHTML = rows.map(r => `<tr><td><b>${esc(r.symbol)}</b></td><td class="mono">${r.score == null ? "—" : esc(r.score)}</td><td><span class="signal-chip ${esc(String(r.action || "hold").toLowerCase())}">${esc(r.action || "N/A")}</span></td><td>${esc(fmtDateTime(r.createdUtc))}</td><td><button class="row-action export-record" data-id="${esc(r.id)}" title="Download this analysis as PDF">↓</button></td></tr>`).join("")
        || `<tr><td colspan="5">No analyses have been saved to SQL Server yet. Run an analysis first.</td></tr>`;
    } catch (e) { body.innerHTML = `<tr><td colspan="5">${esc(e.message)}</td></tr>`; $("#historyCount").textContent = "Unavailable"; }
  }
  // One saved analysis → PDF
  $("#historyRows")?.addEventListener("click", async e => {
    const b = e.target.closest(".export-record"); if (!b) return;
    await withButton(b, async () => {
      try {
        const rec = await api(`/history/${encodeURIComponent(b.dataset.id)}`);
        finishPdf(buildAnalysisPdf(fromRecord(rec)), `${String(rec.symbol).toLowerCase()}-analysis-${rec.id}.pdf`);
      } catch (err) { toast("Export failed", err.message, "error"); }
    });
  });
  // Whole history → PDF
  $("#exportHistory")?.addEventListener("click", () => withButton($("#exportHistory"), async () => {
    try {
      const rows = await api("/history?take=200");
      if (!rows.length) throw new Error("There are no saved analyses to export yet.");
      const doc = newPdf("Research history", `${rows.length} saved analyses - ${new Date().toLocaleString()}`);
      doc.autoTable({
        ...TABLE_STYLE, startY: 100,
        head: [["#", "Symbol", "Date", "Latest close", "20D return", "Volatility", "Score", "View"]],
        body: rows.map((r, i) => [String(i + 1), r.symbol, fmtDateTime(r.createdUtc), pdfMoney(r.latestPrice), pdfPct(r.return20DayPercent), r.annualizedVolatility20DayPercent == null ? "N/A" : `${pdfNum(r.annualizedVolatility20DayPercent)}%`, String(r.score ?? "-"), String(r.action || "N/A")]),
        styles: { ...TABLE_STYLE.styles, fontSize: 8 },
        didParseCell: d => {
          if (d.section !== "body") return;
          if (d.column.index === 4) { const t = String(d.cell.raw); if (t.startsWith("+")) d.cell.styles.textColor = [22, 163, 110]; else if (t.startsWith("-")) d.cell.styles.textColor = [225, 60, 85]; }
          if (d.column.index === 7) { const t = String(d.cell.raw); if (t === "BUY") d.cell.styles.textColor = [22, 163, 110]; else if (t === "SELL") d.cell.styles.textColor = [225, 60, 85]; }
        }
      });
      finishPdf(doc, `equinox-analysis-history-${todayStamp()}.pdf`);
      toast("History exported", "The PDF was downloaded.", "success");
    } catch (e) { toast("Export failed", e.message, "error"); }
  }));

  // ───────────────────────── Preferences ─────────────────────────
  $("#apiBaseInput").value = apiBase;
  $("#saveApiBase")?.addEventListener("click", () => {
    const v = $("#apiBaseInput").value.trim().replace(/\/+$/, "");
    try {
      const u = new URL(v); if (!["http:", "https:"].includes(u.protocol)) throw new Error();
      apiBase = v; localStorage.setItem(API_KEY, v);
      $("#connectionFeedback").textContent = `Saved API endpoint: ${v}`; $("#connectionFeedback").style.color = "var(--green)";
      toast("Endpoint saved", "Testing connection now is recommended.", "success");
    } catch { $("#connectionFeedback").textContent = "Enter a valid HTTP or HTTPS API base URL."; $("#connectionFeedback").style.color = "var(--red)"; }
  });
  $("#testConnection")?.addEventListener("click", async () => {
    const f = $("#connectionFeedback"); f.textContent = "Testing API and database…";
    try {
      const d = await api("/health");
      f.textContent = `API reachable. Database: ${d.database || "status not returned"}.`; f.style.color = d.database === "connected" ? "var(--green)" : "var(--amber)";
    } catch (e) { f.textContent = e.message; f.style.color = "var(--red)"; }
  });
  $$(".settings-tab").forEach(b => b.addEventListener("click", () => {
    $$(".settings-tab").forEach(x => x.classList.toggle("active", x === b));
    $$(".settings-pane").forEach(x => x.classList.toggle("active", x.id === `setting-${b.dataset.settingTab}`));
  }));
  const applyDisplayPrefs = () => {
    document.body.classList.toggle("reduce-motion", localStorage.getItem("equinox_reduce_motion") === "true");
    document.body.classList.toggle("compact-tables", localStorage.getItem("equinox_compact_tables") === "true");
    if ($("#reduceMotion")) $("#reduceMotion").checked = document.body.classList.contains("reduce-motion");
    if ($("#compactTables")) $("#compactTables").checked = document.body.classList.contains("compact-tables");
  };
  applyDisplayPrefs();
  $("#saveDisplay")?.addEventListener("click", () => {
    localStorage.setItem("equinox_reduce_motion", String($("#reduceMotion").checked));
    localStorage.setItem("equinox_compact_tables", String($("#compactTables").checked));
    applyDisplayPrefs(); toast("Preferences saved", "Display settings stored in this browser.", "success");
  });
  $("#clearAllData")?.addEventListener("click", () => {
    if (!confirm("Clear this browser's saved API endpoint and display preferences? Server-side watchlist, portfolio, universe and reports will not be deleted.")) return;
    [API_KEY, "equinox_reduce_motion", "equinox_compact_tables"].forEach(k => localStorage.removeItem(k));
    apiBase = API_DEFAULT; $("#apiBaseInput").value = apiBase; applyDisplayPrefs();
    toast("Local preferences cleared", "SQL Server data was retained.", "success");
  });

  // ───────────────────────── Startup ─────────────────────────
  if ($("#overviewDate")) $("#overviewDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  setPage("overview");
})();