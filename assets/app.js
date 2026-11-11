import { GLOSSARY, EARNINGS_GUIDE } from "./glossary.js";
import * as A from "./analysis.js";
import { lineChart, columnChart, sparkline, hbars, legend } from "./charts.js";
import * as GH from "./github.js";

// ================================================================ tiny DOM helper
// Untrusted strings (names, headlines, firm names) only ever go in as text nodes.
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v; // trusted, app-generated markup only
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
    else if (k === "style") n.style.cssText = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const signClass = (v) => (isNum(v) ? (v >= 0 ? "up" : "down") : "");
const arrow = (v) => (isNum(v) ? (v >= 0 ? "▲" : "▼") : "");
const ICON = { good: "✓", ok: "–", bad: "✕", na: "?" };

function pill(status, word) {
  return h("span", { class: `pill ${status}` }, h("span", { class: "ic", "aria-hidden": "true", text: ICON[status] }), word);
}
// Our own generated sentences mark key phrases with **double stars**. Split them into <b>
// elements; every piece stays a text node, so company names etc. can never become HTML.
function rich(text) {
  if (typeof text !== "string" || !text.includes("**")) return text;
  return text.split("**").map((t, i) => (i % 2 ? h("b", {}, t) : t));
}

// The ticker on screen, so jargon terms can show how it compares to their rule of thumb.
let CUR = null;
const THUMB = "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z";
const TONE_WORD = { good: "passes the rule of thumb", ok: "in between", bad: "fails the rule of thumb" };
function thumb(tone) {
  const w = h("span", { class: `thumb ${tone}`, "aria-hidden": "true" });
  if (tone === "ok") { w.textContent = "–"; return w; }
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"), path = document.createElementNS(NS, "path");
  svg.setAttribute("viewBox", "0 0 24 24"); path.setAttribute("d", THUMB); svg.append(path); w.append(svg);
  return w;
}
function termBtn(key, label) {
  const g = GLOSSARY[key];
  if (!g) return document.createTextNode(label);
  const j = CUR && g.rule ? A.judge(key, CUR) : null;
  return h("button", { class: "term", type: "button", "data-term": key, on: { click: (e) => { e.preventDefault(); e.stopPropagation(); openTerm(key); } } },
    label ?? g.term, j ? [thumb(j.tone), h("span", { class: "vh" }, ` (${TONE_WORD[j.tone]})`)] : null);
}
function qmark(key) {
  return h("button", { class: "qmark", type: "button", "data-term": key, "aria-label": `What is ${GLOSSARY[key]?.term}?`, on: { click: (e) => { e.preventDefault(); e.stopPropagation(); openTerm(key); } } }, "?");
}
function tile(label, value, sub, key) {
  return h("div", { class: "tile" },
    h("div", { class: "k" }, key ? termBtn(key, label) : label),
    h("div", { class: "v tnum" }, value),
    sub ? h("div", { class: "s" }, sub) : null);
}
function card(title, opts = {}, ...body) {
  return h("section", { class: `card ${opts.class || ""}`, style: opts.area ? `--area:${opts.area}` : null },
    title ? h("div", { class: "card-head" }, h("div", {}, h("h2", {}, title, opts.term ? qmark(opts.term) : null), opts.sub ? h("p", { class: "muted small" }, opts.sub) : null), opts.right || null) : null,
    h("div", { class: "card-body" }, ...body));
}

// ================================================================ preferences
function pref(k, v) {
  try { if (v === undefined) return localStorage.getItem(`stockdash.${k}`); localStorage.setItem(`stockdash.${k}`, v); } catch { return null; }
}

// ================================================================ data
const state = { index: null, data: {}, bench: null, filter: pref("filter") || "all", source: "site", task: null };

async function fetchJSON(path) {
  if (GH.connected()) {
    try { state.source = "repo"; return await GH.readRepoFile(path); }
    catch (e) { console.warn("Repo read failed, falling back to site copy:", e.message); state.source = "site"; }
  }
  const r = await fetch(`${path}?v=${Math.floor(Date.now() / 60000)}`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function loadAll() {
  state.index = await fetchJSON("data/index.json");
  const syms = state.index.tickers.map((t) => t.symbol);
  const results = await Promise.allSettled(syms.map((s) => fetchJSON(`data/${s}.json`)));
  results.forEach((r, i) => { if (r.status === "fulfilled") state.data[syms[i]] = r.value; });
  try { state.bench = await fetchJSON("data/_bench.json"); } catch { state.bench = null; }
}

function tickers() {
  return (state.index?.tickers || []).map((t) => ({ ...t, d: state.data[t.symbol] })).filter((t) => t.d);
}
function signalsFor(d) {
  return d.type === "ETF" ? A.fundSignals(d, tickers().map((t) => t.symbol).filter((s) => s !== d.symbol)) : A.equitySignals(d);
}

// ================================================================ since your last look
// A small fingerprint of each ticker is kept in this browser (never sent anywhere). Opening a
// ticker records the visit; what changed since the previous visit stays listed until dismissed.
function seenGet(sym) { try { return JSON.parse(pref(`seen.${sym}`) || "null"); } catch { return null; } }
function seenSet(sym, v) { pref(`seen.${sym}`, JSON.stringify(v)); }
const scoreOf = (d) => A.overall(signalsFor(d)).score;
// Changes in data you haven't opened yet (for the home cards).
function unseenChanges(d) {
  const s = seenGet(d.symbol);
  return s?.fp && s.fp.at !== d.updated ? A.changesSince(d, s.fp, scoreOf(d)) : [];
}
function visitChanges(d) {
  const s = seenGet(d.symbol), fp = A.fingerprint(d, scoreOf(d));
  if (!s?.fp) { seenSet(d.symbol, { fp }); return null; }
  if (s.fp.at !== d.updated) { seenSet(d.symbol, { fp, prev: s.fp }); return { since: s.fp.seen, items: A.changesSince(d, s.fp, fp.score) }; }
  return s.prev ? { since: s.prev.seen, items: A.changesSince(d, s.prev, fp.score) } : null;
}
const CHG_IC = { up: "▲", down: "▼", good: "▲", bad: "▼", note: "•" };
function changesBanner(d) {
  const c = visitChanges(d);
  if (!c?.items.length) return null;
  const el = h("div", { class: "changes", role: "status" },
    h("span", { class: "changes-title" }, "Since you last looked", c.since ? h("span", { class: "muted" }, ` · ${A.ago(c.since)}`) : null),
    h("div", { class: "changes-list" }, c.items.map((x) => h("a", { class: `chg ${x.tone}`, href: `#/t/${d.symbol}/${x.tab}`, "data-tip": x.sub || null },
      h("span", { class: "ic", "aria-hidden": "true" }, CHG_IC[x.tone]), x.text))),
    h("button", { class: "linkish small changes-x", type: "button", on: { click: () => {
      const s = seenGet(d.symbol);
      if (s) { delete s.prev; seenSet(d.symbol, s); }
      el.remove(); fitDash();
    } } }, "Got it"));
  return el;
}

// ================================================================ router
const view = document.getElementById("view");
const overlay = document.getElementById("overlay");

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  document.querySelectorAll("[data-nav]").forEach((a) => a.removeAttribute("aria-current"));
  const nav = document.querySelector(`[data-nav="${parts[0]}"]`);
  if (nav) nav.setAttribute("aria-current", "page");
  view.replaceChildren();
  CUR = null;
  if (parts[0] === "t" && parts[1]) renderTicker(decodeURIComponent(parts[1]).toUpperCase(), parts[2] || "summary");
  else if (parts[0] === "learn") renderLearn(parts[1]);
  else if (parts[0] === "settings") renderSettings();
  else renderHome();
  hidePop(true);
  fitDash();
}
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });

// ================================================================ home
function renderHome() {
  const all = tickers();
  const counts = { all: all.length };
  for (const t of all) counts[t.tag] = (counts[t.tag] || 0) + 1;
  const shown = state.filter === "all" ? all : all.filter((t) => t.tag === state.filter);

  const hero = h("div", { class: "home-hero" },
    h("div", {},
      h("h1", {}, "Your watchlist"),
      h("div", { class: "muted small" }, `Data updated ${A.ago(state.index?.updated)} · prices delayed`)),
    GH.connected() ? h("button", { class: "btn primary", type: "button", on: { click: () => openResearch() } }, "＋ Research a ticker") : null);

  const chips = h("div", { class: "chips", role: "group", "aria-label": "Filter by tag" },
    ["all", "owned", "watching", "researching"].filter((f) => f === "all" || counts[f]).map((f) =>
      h("button", { class: "chip", type: "button", "aria-pressed": String(state.filter === f), on: { click: () => { state.filter = f; pref("filter", f); route(); } } },
        `${f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)} · ${counts[f] || 0}`)));

  const grid = h("div", { class: "grid", style: "margin-top:12px" }, shown.map(({ d, tag }) => tickerCard(d, tag)));
  if (!shown.length) grid.append(h("div", { class: "empty card" }, "Nothing here yet."));

  view.append(hero, chips, grid);

  if (!GH.connected()) {
    view.append(h("div", { class: "card connect-hint", style: "margin-top:16px" },
      h("div", {}, h("h3", {}, "Want to research new tickers?"), h("p", { class: "muted small", style: "margin:2px 0 0" }, "Connect your GitHub repo once, and you can add any ticker from here and watch it load.")),
      h("a", { class: "btn sm", href: "#/settings" }, "Set up")));
  }

  const lower = h("div", { class: "home-lower" });
  // upcoming earnings
  const upcoming = all.filter((t) => t.d.earnings?.next?.date && A.daysUntil(t.d.earnings.next.date) >= -1)
    .sort((a, b) => a.d.earnings.next.date.localeCompare(b.d.earnings.next.date));
  if (upcoming.length) {
    lower.append(h("div", {}, h("div", { class: "section-title" }, h("h2", {}, "Upcoming earnings")),
      card(null, {}, upcoming.map(({ d }) => {
        const n = d.earnings.next, dt = new Date(n.date + "T12:00:00"), days = A.daysUntil(n.date);
        return h("a", { class: "list-row", href: `#/t/${d.symbol}/earnings`, style: "color:inherit;text-decoration:none" },
          h("div", { class: "datebox" }, h("span", {}, dt.toLocaleDateString("en-US", { month: "short" })), h("b", {}, dt.getDate())),
          h("div", { class: "grow" }, h("div", {}, h("b", {}, d.symbol), " ", h("span", { class: "muted" }, A.shortName(d))),
            h("div", { class: "muted small" }, `${days <= 0 ? "Today" : `In ${days} day${days === 1 ? "" : "s"}`}${n.time ? ` · ${n.time}` : ""}${n.isEstimate ? " · date estimated" : ""}`)),
          isNum(n.epsEstimate) ? h("div", { class: "small", style: "text-align:right" }, h("div", { class: "muted" }, "EPS est."), h("b", { class: "tnum" }, A.price(n.epsEstimate))) : null);
      }))));
  }

  // side-by-side comparison
  const eq = all.filter((t) => t.d.type === "EQUITY");
  if (eq.length > 1) {
    const rows = eq.map(({ d }) => {
      const up = isNum(d.analysts?.targets?.mean) ? d.analysts.targets.mean / d.quote.price - 1 : null;
      const y1 = A.priceChange(d, 252);
      return h("tr", {},
        h("td", { class: "sym" }, h("a", { href: `#/t/${d.symbol}` }, d.symbol)),
        h("td", { class: signClass(y1) }, A.pct(y1, { sign: true })),
        h("td", {}, A.times(d.valuation?.forwardPE)),
        h("td", {}, d.valuation?.peg ? A.num(d.valuation.peg, 2) : "—"),
        h("td", { class: signClass(d.fundamentals?.revenueGrowth) }, A.pct(d.fundamentals?.revenueGrowth, { sign: true })),
        h("td", {}, A.pct(d.fundamentals?.operatingMargin)),
        h("td", { class: signClass(up) }, A.pct(up, { sign: true })));
    });
    const th = (label, key) => h("th", {}, key ? termBtn(key, label) : label);
    lower.append(h("div", {}, h("div", { class: "section-title" }, h("h2", {}, "Side by side"), h("span", { class: "muted small only-touch" }, "Scroll sideways")),
      card(null, {}, h("div", { class: "table-wrap" }, h("table", { class: "cmp" },
        h("thead", {}, h("tr", {}, th("Ticker"), th("1Y return"), th("Fwd P/E", "forwardPE"), th("PEG", "peg"), th("Sales growth", "revenueGrowth"), th("Op. margin", "operatingMargin"), th("To target", "priceTarget"))),
        h("tbody", {}, rows))))));
  }
  view.append(lower);

  view.append(h("p", { class: "disclaimer" }, "For learning and research only. Not financial advice. Data from Yahoo Finance, may be delayed or incomplete."));
}

function tickerCard(d, tag) {
  const sig = signalsFor(d), ov = A.overall(sig);
  const closes = (d.prices?.close || []).slice(-252);
  const y1 = A.priceChange(d, 252);
  const n = d.earnings?.next;
  const days = n ? A.daysUntil(n.date) : null;
  const foot = d.type === "ETF"
    ? h("span", { class: "muted" }, `Index fund · ${A.pct(d.fund?.expenseRatio, { digits: 2 })} fee`)
    : h("span", { class: "muted" }, days != null && days >= 0 ? `Earnings in ${days}d` : `1Y ${A.pct(y1, { sign: true })}`);
  const news = unseenChanges(d);
  return h("a", { class: "card tcard", href: `#/t/${d.symbol}`, "aria-label": `${d.symbol}, ${A.price(d.quote.price)}, ${ov.lean}${news.length ? `, ${news.length} changes since you last looked` : ""}` },
    h("div", { class: "tcard-top" }, h("span", { class: "tcard-sym" }, d.symbol), h("span", { class: `tag ${tag}` }, tag),
      news.length ? h("span", { class: "new-badge", "data-tip": news.map((x) => x.text).join(" · "), "data-tip-title": "Since you last looked" }, `${news.length} new`) : null),
    h("div", { class: "tcard-name" }, d.name),
    h("div", { class: "tcard-mid" },
      h("div", {},
        h("div", { class: "tcard-price tnum" }, A.price(d.quote.price)),
        h("div", { class: `tcard-chg tnum ${signClass(d.quote.changePct)}` }, `${arrow(d.quote.changePct)} ${A.pct(d.quote.changePct, { digits: 2, sign: true })} today`)),
      h("div", { html: sparkline(closes, { width: 104, height: 36 }) })),
    h("div", { class: "tcard-foot" }, pill(ov.tone, ov.lean), foot));
}

// ================================================================ ticker page
const EQUITY_TABS = [["summary", "Summary"], ["earnings", "Earnings"], ["financials", "Financials"], ["valuation", "Valuation"], ["peers", "Peers"], ["analysts", "Analysts"], ["news", "News"]];
const FUND_TABS = [["summary", "Summary"], ["holdings", "Holdings"], ["news", "News"]];

function renderTicker(sym, tab) {
  const d = state.data[sym];
  if (!d) {
    view.append(h("a", { class: "back", href: "#/" }, "‹ Watchlist"),
      card(`${sym} isn't on your watchlist`, {}, h("p", { class: "muted" }, "Add it with Research to load its data."),
        GH.connected() ? h("button", { class: "btn primary", type: "button", on: { click: () => openResearch(sym) } }, `Research ${sym}`) : h("a", { class: "btn", href: "#/settings" }, "Connect GitHub to research")));
    return;
  }
  CUR = d;
  const tabs = d.type === "ETF" ? FUND_TABS : EQUITY_TABS;
  if (!tabs.some(([k]) => k === tab)) tab = "summary";
  const tag = state.index.tickers.find((t) => t.symbol === sym)?.tag;
  const about = d.profile?.summary;

  const head = h("div", { class: "qtop" },
    h("div", { class: "qid" },
      h("a", { class: "back", href: "#/" }, "‹ Watchlist"),
      h("h1", {}, d.symbol, tag ? h("span", { class: `tag ${tag}` }, tag) : null),
      h("div", { class: "qname" },
        about ? h("span", { class: "has-tip", "data-tip": about.length > 700 ? about.slice(0, 700).replace(/\s\S*$/, "") + "…" : about, "data-tip-title": d.name }, d.name) : d.name,
        d.profile?.industry ? ` · ${d.profile.industry}` : d.fund?.category ? ` · ${d.fund.category}` : "")),
    h("div", { class: "qquote" },
      h("div", { class: "qprice" },
        h("span", { class: "big tnum" }, A.price(d.quote.price)),
        h("span", { class: `chg tnum ${signClass(d.quote.change)}` }, `${arrow(d.quote.change)} ${A.money(Math.abs(d.quote.change ?? 0), { compact: false })} (${A.pct(d.quote.changePct, { digits: 2, sign: true })})`)),
      h("div", { class: "muted small" }, `Last close ${d.quote.marketTime ? A.date(d.quote.marketTime) : ""} · updated ${A.ago(d.updated)}`)),
    GH.connected() ? h("button", { class: "icon-btn qmenu", type: "button", "aria-label": "Ticker options", title: "Options", on: { click: () => openTickerMenu(d) } },
      h("span", { "aria-hidden": "true", style: "font-size:22px;line-height:1", text: "⋯" })) : null);

  const tabBar = h("nav", { class: "tabs", role: "tablist", "aria-label": `${sym} sections` },
    tabs.map(([k, label]) => h("a", { class: "tab", role: "tab", href: `#/t/${sym}/${k}`, "aria-selected": String(k === tab) }, label)),
    h("span", { class: "tabs-note" }, "Learning tool · not financial advice"));

  const body = h("div", {});
  view.append(head, changesBanner(d) || "", tabBar, body);
  const fn = { summary: tabSummary, earnings: tabEarnings, financials: tabFinancials, valuation: tabValuation, peers: tabPeers, analysts: tabAnalysts, news: tabNews, holdings: tabHoldings }[tab];
  fn(d, body);
  body.append(h("p", { class: "disclaimer" }, "For learning and research only. Not financial advice."));
}

// A tab's grid. On laptops (html.dash-on) CSS turns it into a fixed-height, one-screen layout.
const grid = (name, flow = false) => h("div", { class: `cols dash dash-${name}${flow ? " dash-flow" : ""}` });

// ---------------------------------------------------------------- price chart
const RANGES = [["1M", 21], ["6M", 126], ["YTD", "ytd"], ["1Y", 252], ["5Y", Infinity]];

function priceCard(d) {
  const box = h("div", { class: "flexcol" });
  let range = pref("range") || "1Y";
  let vsMarket = pref("vsMarket") === "1";
  let drops = pref("drops") === "1";
  const perf = h("div", { class: "perf" });

  const draw = () => {
    const { dates, close } = d.prices;
    let start;
    const r = RANGES.find(([k]) => k === range)[1];
    if (r === "ytd") { const y = dates[dates.length - 1].slice(0, 4); start = dates.findIndex((x) => x >= `${y}-01-01`); start = Math.max(start - 1, 0); }
    else start = Math.max(0, dates.length - 1 - (r === Infinity ? dates.length : r));
    const ds = dates.slice(start), cs = close.slice(start);
    const chg = cs[cs.length - 1] / cs[0] - 1;
    box.replaceChildren();
    const fmtX = (s, n) => A.date(s, n > 140 ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" });
    const tipTitle = (s) => A.date(s);
    const span = { "1M": "the last month", "6M": "the last 6 months", YTD: "the year so far", "1Y": "the last year", "5Y": "5 years" }[range];
    perf.replaceChildren(h("span", { class: signClass(chg) }, `${d.symbol} ${A.pct(chg, { sign: true })}`), ` over ${span}`);
    const c = h("div", {});
    if (drops) {
      // how far below its running high (over all the history we have) it was each day
      const dd = A.drawdowns(dates, close), us = dd.under.slice(start);
      const withB = vsMarket && state.bench && d.symbol !== "VOO";
      const series = [{ name: d.symbol, values: us, color: "var(--series-1)" }];
      if (withB) {
        const bu = A.drawdowns(state.bench.dates, state.bench.close).under, bmap = new Map(state.bench.dates.map((x, i) => [x, bu[i]]));
        series.push({ name: "S&P 500", values: ds.map((x) => bmap.get(x) ?? null), color: "var(--series-2)" });
        box.append(legend(series.map((s) => ({ name: s.name, color: s.color, kind: "line" }))));
      }
      box.append(c);
      lineChart(c, { dates: ds, series, area: false, refLine: 0, yMax: 0, yFormat: (v, axis) => (Math.abs(v) < 0.0005 ? "0%" : `${v < 0 ? "−" : "+"}${Math.abs(v * 100).toFixed(axis ? 0 : 1)}%`), xFormat: fmtX, tipTitle, height: 230, fill: true,
        ariaLabel: `${d.symbol} percent below its previous high, ${range}` });
      const worst = Math.min(...us);
      perf.replaceChildren(h("span", { class: "down" }, `Worst ${A.pct(worst, { digits: 0 })}`), ` in ${span} · now `, h("b", {}, us[us.length - 1] > -0.005 ? "at its high" : `${A.pct(-us[us.length - 1], { digits: 0 })} below its high`));
      const st = A.dropStory(d, state.bench);
      if (st) box.append(h("p", { class: "small ink2 drop-note" }, rich(st.lines[0]), " ", rich(st.lines[1] || ""), " ", termBtn("drawdown", "About drops")));
      return;
    }
    if (vsMarket && state.bench && d.symbol !== "VOO") {
      const bmap = new Map(state.bench.dates.map((x, i) => [x, state.bench.close[i]]));
      const b0 = bmap.get(ds[0]) ?? state.bench.close[state.bench.dates.findIndex((x) => x >= ds[0])];
      const bs = ds.map((x) => (bmap.has(x) ? (bmap.get(x) / b0) * 100 : null));
      const ss = cs.map((v) => (v / cs[0]) * 100);
      const lastB = [...bs].reverse().find((v) => v != null);
      box.append(legend([{ name: d.symbol, color: "var(--series-1)", kind: "line" }, { name: "S&P 500", color: "var(--series-2)", kind: "line" }]), c);
      lineChart(c, { dates: ds, series: [{ name: d.symbol, values: ss, color: "var(--series-1)" }, { name: "S&P 500", values: bs, color: "var(--series-2)" }],
        yFormat: (v) => (v - 100 >= 0 ? "+" : "−") + Math.abs(v - 100).toFixed(0) + "%", xFormat: fmtX, tipTitle, height: 230, fill: true, refLine: 100, ariaLabel: `${d.symbol} vs S&P 500, indexed` });
      const bchg = lastB / 100 - 1;
      perf.append(` · S&P 500 ${A.pct(bchg, { sign: true })}. `, h("b", {}, chg >= bchg ? `Beat the market by ${A.pct(chg - bchg)}` : `Trailed the market by ${A.pct(bchg - chg)}`));
    } else {
      box.append(c);
      lineChart(c, { dates: ds, series: [{ name: d.symbol, values: cs, color: "var(--series-1)" }],
        yFormat: (v, axis) => (axis && v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(axis ? 0 : 2)}`), xFormat: fmtX, tipTitle, height: 230, fill: true, ariaLabel: `${d.symbol} price, ${range}` });
    }
  };

  const chips = h("div", { class: "chips", role: "group", "aria-label": "Time range" },
    RANGES.map(([k]) => h("button", { class: "chip", type: "button", "aria-pressed": String(k === range),
      on: { click: (e) => { range = k; pref("range", k); chips.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", String(x === e.currentTarget))); draw(); } } }, k)));
  const tog = d.symbol !== "VOO" && state.bench ? h("label", { class: "toggle" },
    h("input", { type: "checkbox", ...(vsMarket ? { checked: true } : {}), on: { change: (e) => { vsMarket = e.target.checked; pref("vsMarket", vsMarket ? "1" : "0"); draw(); } } }), "vs S&P 500") : null;
  const dropTog = h("label", { class: "toggle", "data-tip": "Shows how far the price was below its previous high on each day, and how long it took to recover.", "data-tip-title": "Drops from a peak" },
    h("input", { type: "checkbox", ...(drops ? { checked: true } : {}), on: { change: (e) => { drops = e.target.checked; pref("drops", drops ? "1" : "0"); draw(); } } }), "Drops");
  requestAnimationFrame(draw);
  return card(null, { area: "chart", class: "span" }, h("div", { class: "chart-controls" }, chips, h("div", { class: "toggles" }, tog, dropTog), perf), box);
}

// ---------------------------------------------------------------- summary
function verdictCard(d) {
  const sig = signalsFor(d), ov = A.overall(sig);
  const C = 2 * Math.PI * 32;
  const ring = h("div", { class: "score-ring", "aria-label": `Score ${ov.score} out of 100` },
    h("div", { html: `<svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="32" fill="none" stroke="var(--surface-2)" stroke-width="8"/><circle cx="38" cy="38" r="32" fill="none" stroke="var(--${ov.tone === "good" ? "good" : ov.tone === "ok" ? "warn" : "bad"})" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(C * (ov.score || 0)) / 100} ${C}"/></svg>` }),
    h("div", { class: "val tnum" }, ov.score ?? "—"));
  const strengths = sig.filter((s) => s.status === "good").map((s) => s.label.toLowerCase());
  const concerns = sig.filter((s) => s.status === "bad").map((s) => s.label.toLowerCase());
  const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0]);
  const summary = [strengths.length ? `Strengths: ${list(strengths)}.` : null, concerns.length ? `Watch out for: ${list(concerns)}.` : null].filter(Boolean).join(" ");

  return card(null, { area: "verdict", class: "span" },
    h("div", { class: "verdict" }, ring,
      h("div", {},
        h("div", { class: "muted small" }, "The quick read"),
        h("h2", {}, ov.lean),
        h("div", { class: "ink2 small" }, `${ov.good} of ${ov.total} signals positive${ov.bad ? `, ${ov.bad} negative` : ""}`))),
    summary ? h("p", { class: "verdict-sum" }, summary) : null,
    h("div", { class: "signals" }, sig.map((s) => h("details", { class: "signal" },
      h("summary", {}, h("span", { class: "lbl" }, h("span", { class: "has-tip", "data-tip": s.text, "data-tip-title": `${s.label}: ${s.word}` }, s.label)), h("span", { class: "val" }, s.value), pill(s.status, s.word)),
      h("div", { class: "body" }, h("p", {}, s.text), s.term ? h("button", { class: "linkish small", type: "button", on: { click: () => openTerm(s.term) } }, `What's ${GLOSSARY[s.term].term}?`) : null)))),
    h("p", { class: "muted small", style: "margin:10px 0 0" }, h("span", { class: "only-touch" }, "Tap a row for what it means. "), h("span", { class: "only-hover" }, "Hover a row for what it means. "), "The score is a simple checklist (green = 1, amber = ½, red = 0), not a prediction."));
}

function rangeFigure(lo, hi, cur, { mean, labels } = {}) {
  if (![lo, hi, cur].every(isNum) || hi <= lo) return null;
  const p = (v) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  return h("div", { class: "range" },
    h("div", { class: "range-track" },
      isNum(mean) ? h("div", { class: "range-dot mean", style: `left:${p(mean)}`, title: `Average ${A.price(mean)}` }) : null,
      h("div", { class: "range-dot", style: `left:${p(cur)}`, title: `Current ${A.price(cur)}` })),
    h("div", { class: "range-labels" }, h("span", {}, labels?.[0] ?? A.price(lo)), h("span", {}, labels?.[1] ?? A.price(hi))));
}

// Each firm's latest 12-month target as a dot, with today's price and the average marked.
const RATING_GROUP = (r) => /strong buy|buy|outperform|overweight|positive|accumulate/i.test(r || "") ? 0 : /sell|underperform|underweight|negative|reduce/i.test(r || "") ? 2 : 1;
const RATING_COLORS = ["#5598e7", "#a3a29b", "#e66767"], RATING_NAMES = ["Buy", "Hold", "Sell"];
// Firms use their own words for the same three ratings.
const RATING_WORDS = {
  "strong buy": "The firm's most positive rating: it expects the stock to beat the market by a wide margin.",
  buy: "Expects the stock to rise more than the market; recommends buying.",
  outperform: "Expects it to do better than the market (or its industry) over the next 12 months. Their word for Buy.",
  "market outperform": "Expects it to beat the overall market. Their word for Buy.",
  "sector outperform": "Expects it to beat other companies in its industry. Their word for Buy.",
  overweight: "Recommends holding more of it than its weight in the index, because it should beat the stocks the firm covers. Used by Morgan Stanley, JPMorgan, Barclays and others. Means Buy.",
  positive: "Their word for Buy.", accumulate: "Buy gradually. A mild Buy.",
  hold: "Expects it to roughly match the market. Keep it if you own it, but don't add. Often a polite negative.",
  neutral: "Expects it to roughly match the market. Their word for Hold.",
  "equal-weight": "Recommends holding about its weight in the index: it should do about as well as the stocks the firm covers. Means Hold.",
  "equal weight": "Recommends holding about its weight in the index: it should do about as well as the stocks the firm covers. Means Hold.",
  "sector perform": "Expects it to move roughly in line with its industry. Used by RBC and others. Their word for Hold.",
  "market perform": "Expects it to move roughly in line with the market. Their word for Hold.",
  "peer perform": "Expects it to move roughly in line with similar companies. Their word for Hold.",
  "in-line": "Expects it to move roughly in line with its industry. Their word for Hold.",
  "sector weight": "About its weight in the index. Their word for Hold.",
  underweight: "Recommends holding less of it than its weight in the index, because it should lag the stocks the firm covers. Means Sell.",
  underperform: "Expects it to do worse than the market (or its industry). Their word for Sell.",
  "sector underperform": "Expects it to lag other companies in its industry. Their word for Sell.",
  "market underperform": "Expects it to lag the overall market. Their word for Sell.",
  reduce: "Sell some. A mild Sell.", negative: "Their word for Sell.", sell: "Expects the stock to fall or badly lag; recommends selling.", "strong sell": "The firm's most negative rating.",
};
function ratingChip(r) {
  if (!r) return h("span", { class: "muted" }, "—");
  const gi = RATING_GROUP(r);
  return h("span", { class: "rchip", "data-tip": RATING_WORDS[r.toLowerCase()] || `This firm's word for ${RATING_NAMES[gi]}.`, "data-tip-title": `“${r}” = ${RATING_NAMES[gi]}` },
    r,
    r.toLowerCase() === RATING_NAMES[gi].toLowerCase() ? null : h("span", { class: "muted" }, ` = ${RATING_NAMES[gi]}`));
}
// Each firm's most recent target (the actions list is newest first).
function firmTargets(d) {
  const seen = new Set(), out = [];
  for (const x of d.analysts?.actions || []) {
    if (!x.firm || seen.has(x.firm) || !isNum(x.target) || x.target <= 0) continue;
    seen.add(x.firm); out.push(x);
  }
  return out;
}
function targetStrip(d) {
  const tg = d.analysts?.targets || {}, P = d.quote.price;
  const dots = firmTargets(d);
  const vals = [...dots.map((x) => x.target), tg.low, tg.high, P].filter(isNum);
  if (vals.length < 2) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.04;
  const pos = (v) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
  // stack dots that would overlap
  const rows = [];
  const placed = [...dots].sort((a, b) => a.target - b.target).map((x) => {
    let r = rows.findIndex((last) => pos(x.target) - last > 3.2);
    if (r < 0) { rows.push(-1e9); r = rows.length - 1; }
    rows[r] = pos(x.target);
    return { x, r };
  });
  const above = dots.filter((x) => x.target > P).length;
  const H = Math.max(1, rows.length) * 16 + 34;
  return h("div", { class: "tstrip-wrap" },
    h("div", { class: "tstrip", style: `height:${H}px`, role: "img", "aria-label": `${dots.length} firms' targets from ${A.price(Math.min(...dots.map((x) => x.target)))} to ${A.price(Math.max(...dots.map((x) => x.target)))}; today ${A.price(P)}` },
      h("div", { class: "tstrip-axis" }),
      isNum(tg.mean) ? h("div", { class: "tstrip-mark mean", style: `left:${pos(tg.mean)}%`, "data-tip": A.price(tg.mean), "data-tip-title": "Average target" }) : null,
      isNum(tg.median) ? h("div", { class: "tstrip-mark median", style: `left:${pos(tg.median)}%`, "data-tip": A.price(tg.median), "data-tip-title": "Middle (median) target" }, h("span", {}, `Middle ${A.price(tg.median)}`)) : null,
      h("div", { class: "tstrip-mark today", style: `left:${pos(P)}%` }, h("span", {}, `Today ${A.price(P)}`)),
      placed.map(({ x, r }) => h("div", { class: "tstrip-dot", style: `left:${pos(x.target)}%;bottom:${22 + r * 16}px;background:${RATING_COLORS[RATING_GROUP(x.to)]}`,
        "data-tip": `${A.price(x.target)} · ${x.to || "rating n/a"} · ${A.date(x.date, { month: "short", day: "numeric", year: "numeric" })}`, "data-tip-title": x.firm }))),
    h("div", { class: "range-labels" }, h("span", {}, A.price(lo)), h("span", {}, A.price(hi))),
    legend(RATING_NAMES.map((n, i) => ({ name: `${n} rating`, color: RATING_COLORS[i] })).concat([{ name: "Today's price", color: "var(--ink)", kind: "line" }, { name: "Middle target", color: "var(--series-2)", kind: "line" }, { name: "Average target", color: "var(--series-muted)", kind: "line" }])),
    dots.length ? h("p", { class: "small ink2", style: "margin:6px 0 0" }, `Each dot is one firm's latest target (from the recent changes below). ${above} of ${dots.length} are above today's price.`) : null);
}

function aboutCard(d) {
  const txt = d.profile?.summary;
  if (!txt) return null;
  const p = h("p", { class: "clamp ink2" }, txt);
  const more = h("button", { class: "linkish small", type: "button", on: { click: () => { p.classList.toggle("clamp"); more.textContent = p.classList.contains("clamp") ? "Read more" : "Show less"; } } }, "Read more");
  return card(`About ${A.shortName(d)}`, { class: "dash-hide" }, p, more,
    d.profile.website ? h("p", { class: "small", style: "margin-top:8px" }, h("a", { href: d.profile.website, target: "_blank", rel: "noopener noreferrer" }, d.profile.website.replace(/^https?:\/\/(www\.)?/, ""))) : null);
}

function rangeCard(d) {
  const q = d.quote;
  const pos52 = isNum(q.high52) && isNum(q.low52) ? (q.price - q.low52) / (q.high52 - q.low52) : null;
  return card("52-week range", { area: "range", term: "range52", sub: isNum(pos52) ? `${Math.round(pos52 * 100)}% of the way from the year's low to its high` : null },
    rangeFigure(q.low52, q.high52, q.price, { labels: [`Low ${A.price(q.low52)}`, `High ${A.price(q.high52)}`] }));
}

function tabSummary(d, body) {
  if (d.type === "ETF") return fundSummary(d, body);
  const q = d.quote, v = d.valuation, f = d.fundamentals;
  const n = A.nextEarningsText(d);
  const g = grid("summary");
  g.append(
    verdictCard(d),
    priceCard(d),
    card("Key numbers", { area: "stats", sub: "Hover or tap a label for a plain-English explanation" },
      h("div", { class: "tiles" },
        tile("Market cap", A.money(q.marketCap), null, "marketCap"),
        tile("P/E (trailing)", A.times(v.trailingPE), "Price ÷ last year's EPS", "pe"),
        tile("Forward P/E", A.times(v.forwardPE), "Price ÷ next year's EPS", "forwardPE"),
        tile("EPS (TTM)", A.price(f.epsTTM), null, "eps"),
        tile("Dividend yield", v.dividendYield ? A.pct(v.dividendYield, { digits: 2 }) : "None", null, "dividendYield"),
        tile("Beta", A.num(q.beta, 2), isNum(q.beta) ? (q.beta > 1.2 ? "Swingier than market" : q.beta < 0.8 ? "Calmer than market" : "Moves with market") : null, "beta"))),
    rangeCard(d),
    n ? card("Next earnings", { area: "next", right: n.days != null && n.days >= 0 ? h("span", { class: "tag plain" }, `in ${n.days} days`) : null },
      h("p", { style: "margin:0" }, n.text), h("a", { class: "small", href: `#/t/${d.symbol}/earnings` }, "Last report explained ›")) : null,
    aboutCard(d));
  body.append(g);
}

function fundSummary(d, body) {
  const f = d.fund;
  const g = grid("summary");
  g.append(
    verdictCard(d),
    priceCard(d),
    card("Key numbers", { area: "stats", sub: "Hover or tap a label for a plain-English explanation" },
      h("div", { class: "tiles" },
        tile("Expense ratio", A.pct(f.expenseRatio, { digits: 2 }), isNum(f.expenseRatio) ? `$${(f.expenseRatio * 10000).toFixed(0)}/yr per $10k` : null, "expenseRatio"),
        tile("Fund size", A.money(f.netAssets), null, "netAssets"),
        tile("Yield", A.pct(f.yield, { digits: 2 }), null, "fundYield"),
        tile("P/E of holdings", A.times(f.trailingPE), "Long-run avg ~16–18", "pe"),
        tile("YTD return", A.pct(f.ytdReturn, { sign: true })),
        tile("5-yr avg return", A.pct(f.fiveYearReturn), "per year", "indexFund"))),
    rangeCard(d),
    card("What you're buying", { area: "next", term: "indexFund" },
      h("p", { class: "ink2", style: "margin:0 0 6px" }, `${d.symbol} is an index fund${f.family ? ` from ${f.family}` : ""}: each share is a small slice of every company in its index, weighted by size. There are no earnings calls for the fund itself.`),
      h("a", { class: "small", href: `#/t/${d.symbol}/holdings` }, "See what it holds ›")),
    aboutCard(d));
  body.append(g);
}

// ---------------------------------------------------------------- earnings
function tabEarnings(d, body) {
  const e = d.earnings;
  const story = A.earningsStory(d);
  const g = grid("earnings", true);
  body.append(g);

  const score = A.quarterScore(d);
  const IC = { good: "✓", bad: "✕", note: "!" };
  g.append(card("Last quarter in plain English", { area: "story", class: "span" },
    score ? h("div", { class: "qscore" },
      h("div", { class: "qscore-head" }, pill(score.tone, score.label),
        h("span", { class: "small ink2" }, `${score.good} of ${score.n} checks positive, ${score.bad} negative`)),
      h("div", { class: "qscore-checks" }, score.checks.map((c) => h("span", { class: `qchk ${c.kind}` },
        h("span", { class: "ic", "aria-hidden": "true" }, IC[c.kind]), h("span", { class: "muted" }, `${c.name}: `), h("b", {}, c.word))))) : null,
    story.length ? h("div", { class: "story" }, story.map((s) => h("div", { class: `story-line ${s.kind}` },
      h("span", { class: "ic", "aria-hidden": "true" }, { good: "✓", bad: "✕", note: "!", plain: "•" }[s.kind]),
      h("div", {}, rich(s.text), s.term ? qmark(s.term) : null)))) : h("p", { class: "muted" }, "No recent earnings report found."),
    (() => {
      const calls = (d.news || []).filter((n) => /earnings call|conference call|q[1-4]\s*(fy)?\s*20\d\d.*(earnings|results)|(earnings|results).*q[1-4]/i.test(n.title)).slice(0, 3);
      return calls.length ? h("div", { class: "call-links" }, h("h3", {}, "What was said on the call"),
        h("p", { class: "muted small", style: "margin:2px 0 6px" }, "Recent coverage of the earnings call, including management's outlook (guidance):"),
        calls.map((n) => h("a", { class: "call-link", href: n.url, target: "_blank", rel: "noopener noreferrer" }, n.title, h("span", { class: "muted small" }, ` · ${n.publisher || ""}`)))) : null;
    })(),
    h("p", { class: "muted small", style: "margin:12px 0 0" }, "Full call transcripts aren't in the free data. The company's investor relations page has the slides and replay. ",
      h("a", { href: "#/learn/earnings" }, "How to read an earnings report ›"))));

  const hist = e.history || [];
  if (hist.length) {
    const c = h("div", {});
    const anyLoss = hist.some((x) => x.epsActual < 0);
    g.append(card("Earnings per share vs estimates", { area: "eps", term: "epsSurprise", sub: `Bars are what they earned; the line is what analysts expected${anyLoss ? " · red = a loss" : ""}` },
      legend([{ name: "Actual EPS", color: "var(--series-1)" }, ...(anyLoss ? [{ name: "Loss", color: "var(--bad)" }] : []), { name: "Estimate", color: "var(--ink)", kind: "tick" }]), c));
    requestAnimationFrame(() => columnChart(c, {
      categories: hist.map((x) => A.date(x.date, { month: "short", year: "2-digit" })),
      series: [{ name: "Actual", values: hist.map((x) => x.epsActual), color: "var(--series-1)" }],
      markers: [{ name: "Estimate", values: hist.map((x) => x.epsEstimate), color: "var(--ink)" }],
      yFormat: (v, axis) => (axis ? `$${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}` : A.price(v)), height: dashMQ.matches ? 210 : 200,
      colorFor: (si, i, v) => (v < 0 ? "var(--bad)" : "var(--series-1)"),
      tipRows: (i) => [
        { color: "var(--series-1)", value: A.price(hist[i].epsActual), label: "actual" },
        { color: "var(--ink)", value: A.price(hist[i].epsEstimate), label: "estimate" },
        { value: A.oneOffMiss(d, hist[i]) ? "Miss caused by a one-off charge" : `${hist[i].surprise >= 0 ? "Beat" : "Missed"} by ${A.pct(Math.abs(hist[i].surprise))}` },
        { value: isNum(hist[i].reaction) ? `${A.pct(hist[i].reaction, { sign: true })}` : "—", label: "stock next session" },
      ],
      ariaLabel: "Actual EPS vs estimate by quarter",
    }));

    const recent = hist.slice(-8);
    const oneTip = (o) => `Missed by ${A.price(o.missPerShare)} a share. One-time items: ${o.items.map((it) => `${it.label.toLowerCase()} ${it.amount < 0 ? "−" : "+"}${A.money(Math.abs(it.amount))}`).join("; ") || A.money(o.total)}. ` +
      `After tax that's about ${A.price(o.perShare)} a share, which covers the miss. Analysts' estimates leave these out.`;
    const surprisePill = (x) => A.oneOffMiss(d, x)
      ? h("span", { class: "pill ok", "data-tip": oneTip(A.oneOffMiss(d, x)), "data-tip-title": `${A.pct(x.surprise, { sign: true })} on paper` }, h("span", { class: "ic", "aria-hidden": "true" }, "!"), "One-off")
      : h("span", { class: `pill ${x.surprise >= 0 ? "good" : "bad"}` }, h("span", { class: "ic", "aria-hidden": "true" }, x.surprise >= 0 ? "✓" : "✕"), A.pct(x.surprise, { sign: true }));
    const wide = h("div", { class: "table-wrap only-dash" }, h("table", { class: "wide-hist sticky-first" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), recent.map((x) => h("th", {}, A.date(x.date, { month: "short", year: "2-digit" }))))),
      h("tbody", {},
        h("tr", {}, h("td", {}, "Estimate"), recent.map((x) => h("td", {}, A.price(x.epsEstimate)))),
        h("tr", {}, h("td", {}, "Actual"), recent.map((x) => h("td", {}, h("b", {}, A.price(x.epsActual))))),
        h("tr", {}, h("td", {}, termBtn("epsSurprise", "Beat / miss")), recent.map((x) => h("td", {}, surprisePill(x)))),
        h("tr", {}, h("td", {}, termBtn("earningsReaction", "Stock next day")), recent.map((x) => h("td", { class: signClass(x.reaction) }, A.pct(x.reaction, { sign: true })))))));
    // the one-off quarters, explained: how big the charge was vs how big the miss was
    const offs = recent.map((x) => ({ x, o: A.oneOffMiss(d, x) })).filter((r) => r.o).reverse();
    const offBox = offs.length ? h("div", { class: "oneoffs" },
      h("h3", {}, termBtn("unusualItems", "The one-off quarters, explained")),
      h("p", { class: "muted small", style: "margin:2px 0 8px" }, "The size of the “miss” matches the size of the charge. The breakdown comes from the company's income statement."),
      h("div", { class: "oneoff-grid" }, offs.map(({ x, o }) => h("div", { class: "oneoff" },
        h("div", { class: "oneoff-head" }, h("b", {}, A.date(x.date, { month: "short", year: "numeric" })),
          h("span", { class: "small ink2 tnum" }, rich(`missed by **${A.price(o.missPerShare)}** · one-off cost ≈ **${A.price(o.perShare)}** a share after tax`))),
        h("div", { class: "oneoff-bars", role: "img", "aria-label": `Miss ${A.price(o.missPerShare)} vs charge ${A.price(o.perShare)} per share` },
          (() => { const mx = Math.max(o.missPerShare, o.perShare);
            return [["Miss", o.missPerShare, "var(--bad)"], ["One-off charge", o.perShare, "var(--warn)"]].map(([l, v, c]) =>
              h("div", { class: "ob" }, h("span", { class: "small muted" }, l), h("div", { class: "ob-track" }, h("div", { style: `width:${(v / mx) * 100}%;background:${c}` })), h("span", { class: "small tnum" }, A.price(v)))); })()),
        h("table", { class: "steps-table oneoff-items" }, h("tbody", {},
          o.items.map((it) => h("tr", {}, h("td", {}, it.label), h("td", { class: `tnum ${it.amount < 0 ? "down" : "up"}` }, `${it.amount < 0 ? "−" : "+"}${A.money(Math.abs(it.amount))}`))),
          h("tr", {}, h("td", {}, h("b", {}, "Total before tax")), h("td", { class: "tnum" }, h("b", {}, `${o.total < 0 ? "−" : "+"}${A.money(Math.abs(o.total))}`))),
          h("tr", {}, h("td", {}, `After tax${o.taxKnown ? "" : " (estimated at 21%)"} ÷ ${A.num(o.shares / 1e6, 0)}M shares`), h("td", { class: "tnum" }, `${A.price(o.perShare)} a share`)))),
        d.filing?.oneOffs?.length && d.filing.period && Math.abs(new Date(d.filing.filed) - new Date(x.date)) < 20 * 864e5
          ? h("p", { class: "small ink2", style: "margin:6px 0 0" }, h("b", {}, "What the company said: "), (() => { const tr = A.translateRelease(d.filing.oneOffs[0]); return tr ? rich(tr.text) : d.filing.oneOffs[0]; })()) : null)))) : null;
    const beats = recent.filter((x) => x.surprise > 0).length, oneOffs = recent.filter((x) => A.oneOffMiss(d, x)).length;
    const moves = recent.filter((x) => isNum(x.reaction)).map((x) => Math.abs(x.reaction));
    g.append(card("Report history", { area: "hist", term: "earningsReaction",
      sub: `Beat estimates ${beats} of the last ${recent.length} quarters${oneOffs ? ` (${oneOffs} miss${oneOffs > 1 ? "es were" : " was"} a one-off charge)` : ""}${moves.length ? ` · the stock typically moves ±${A.pct(moves.reduce((a, b) => a + b, 0) / moves.length)} the day after a report` : ""}` },
      wide,
      h("div", { class: "table-wrap no-dash" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Reported"), h("th", {}, "Estimate"), h("th", {}, "Actual"), h("th", {}, "Surprise"), h("th", {}, "Stock move"))),
        h("tbody", {}, [...hist].reverse().map((x) => h("tr", {},
          h("td", {}, A.date(x.date)),
          h("td", {}, A.price(x.epsEstimate)),
          h("td", {}, A.price(x.epsActual)),
          h("td", {}, surprisePill(x)),
          h("td", { class: signClass(x.reaction) }, A.pct(x.reaction, { sign: true }))))))), offBox));
  }

  // one press-release sentence: a plain-English point with a colored icon, the original tucked underneath
const PR_IC = { good: "✓", bad: "✕", note: "!", plain: "•" };
function releasePoint(q, fl) {
  const maxYear = Math.max(0, ...[...(fl.highlights || []), ...(fl.guidance || []), ...(fl.oneOffs || [])].map((x) => +((x.match(/fiscal year (20\d\d)/i) || [])[1] || 0)));
  const tr = A.translateRelease(q, { maxYear });
  return h("div", { class: `story-line pr ${tr ? tr.tone : "plain"}` },
    h("span", { class: "ic", "aria-hidden": "true" }, PR_IC[tr ? tr.tone : "plain"]),
    h("div", {},
      tr ? [h("span", { class: `pr-tag ${tr.tone}` }, tr.tag), " ", rich(tr.text)] : h("span", {}, q),
      tr ? h("details", { class: "pr-orig" }, h("summary", {}, "Their exact words"), h("p", {}, `“${q.replace(/^[“"]|[”"]$/g, "")}”`)) : null));
}

// the company's own press release (SEC 8-K), when fetch.py could get it
  const fl = d.filing;
  if (fl && (fl.guidance?.length || fl.highlights?.length || isNum(fl.adjustedEps))) {
    const last = hist[hist.length - 1];
    const same = last && Math.abs(new Date(fl.filed) - new Date(last.date)) < 20 * 864e5;
    const adjVs = same && isNum(fl.adjustedEps) && isNum(last.epsEstimate) ? fl.adjustedEps / last.epsEstimate - 1 : null;
    g.append(card("In the company's own words", { area: "filing", class: "span", term: "guidance",
      sub: `What it said in its earnings press release (filed ${A.date(fl.filed)}), translated into plain English. Open “their exact words” to see the original sentence.` },
      h("div", { class: "filing" },
        isNum(fl.adjustedEps) ? h("div", { class: "filing-adj" }, h("div", { class: "muted small" }, termBtn("adjustedEps", "Its own adjusted EPS")),
          h("div", { class: "big tnum" }, A.price(fl.adjustedEps)),
          isNum(adjVs) ? h("div", { class: "small" }, pill(adjVs >= 0 ? "good" : "bad", `${adjVs >= 0 ? "Beat" : "Missed"} the ${A.price(last.epsEstimate)} estimate by ${A.pct(Math.abs(adjVs))}`)) : null,
          h("p", { class: "muted small", style: "margin:6px 0 0" }, "Companies leave one-offs out of “adjusted” EPS. That's usually the number analysts compare against.")) : null,
        ...(() => {
          // press releases repeat themselves; show each translated point once
          const seen = new Set();
          return [["Headlines", fl.highlights], ["Plans and outlook", fl.guidance], ["One-time items", fl.oneOffs]].map(([title, xs]) => {
            const pts = (xs || []).filter((q) => {
              const tr = A.translateRelease(q, {}), key = tr ? tr.tag + (tr.text.match(/\$[\d.]+[BMK]?/) || [""])[0] : q;
              if (seen.has(key)) return false;
              seen.add(key); return true;
            });
            return pts.length ? h("div", {}, h("h3", {}, title), h("div", { class: "pr-list" }, pts.map((q) => releasePoint(q, fl)))) : null;
          });
        })()),
      h("a", { class: "small", href: fl.url, target: "_blank", rel: "noopener noreferrer" }, "Read the full press release on SEC.gov ›")));
  }

  const n = A.nextEarningsText(d);
  const nx = e.next;
  if (n) {
    g.append(card("Next report", { area: "next", right: n.days != null && n.days >= 0 ? h("span", { class: "tag plain" }, `in ${n.days} days`) : null },
      h("p", { style: "margin:0 0 8px" }, n.text),
      nx && isNum(nx.epsLow) && isNum(nx.epsHigh) ? h("div", {}, h("div", { class: "muted small" }, h("span", { class: "has-tip", "data-tip": "A wide range means analysts disagree, so a bigger surprise either way is more likely." }, "Range of analyst EPS estimates")),
        rangeFigure(Math.min(nx.epsLow, nx.epsEstimate ?? nx.epsLow), Math.max(nx.epsHigh, nx.epsEstimate ?? nx.epsHigh), nx.epsEstimate, { labels: [`Low ${A.price(nx.epsLow)}`, `High ${A.price(nx.epsHigh)}`] })) : null));
  }

  const P = { "0q": "This quarter", "+1q": "Next quarter", "0y": "This fiscal year", "+1y": "Next fiscal year" };
  if ((e.epsEstimate || []).length) {
    g.append(card("What analysts expect", { area: "expect", term: "consensus", sub: "Growth is vs the same period a year earlier" },
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Period"), h("th", {}, "EPS estimate"), h("th", {}, "Revenue estimate"))),
        h("tbody", {}, e.epsEstimate.filter((r) => P[r.period]).map((r) => {
          const rv = A.estRow(e.revenueEstimate, r.period);
          return h("tr", {}, h("td", {}, P[r.period], h("div", { class: "muted small" }, `${r.numberOfAnalysts ?? "?"} analysts`)),
            h("td", {}, h("b", {}, A.price(r.avg)), h("div", { class: `small ${signClass(r.growth)}` }, `${A.pct(r.growth, { sign: true })} YoY`)),
            h("td", {}, h("b", {}, A.money(rv.avg)), h("div", { class: `small ${signClass(rv.growth)}` }, `${A.pct(rv.growth, { sign: true })} YoY`)));
        }))))));
  }

  const t = A.estRow(e.epsTrend, "+1y"), t0 = A.estRow(e.epsTrend, "0y");
  if (isNum(t.current)) {
    const keys = ["90daysAgo", "60daysAgo", "30daysAgo", "7daysAgo", "current"];
    const labels = ["90d ago", "60d ago", "30d ago", "7d ago", "Now"];
    const c = h("div", {});
    const rv = A.estRow(e.epsRevisions, "+1y");
    g.append(card("Are estimates rising or falling?", { area: "trend", term: "estimateRevisions", sub: isNum(rv.upLast30days) ? `Last 30 days: ${rv.upLast30days} analysts raised next year's estimate, ${rv.downLast30days ?? 0} cut it` : "Consensus EPS estimate over the last 90 days" },
      legend([{ name: "Next fiscal year", color: "var(--series-1)", kind: "line" }, { name: "This fiscal year", color: "var(--series-2)", kind: "line" }]), c));
    requestAnimationFrame(() => lineChart(c, {
      dates: labels, area: false, height: 180, fill: true,
      series: [{ name: "Next fiscal year", values: keys.map((k) => t[k]), color: "var(--series-1)" }, { name: "This fiscal year", values: keys.map((k) => t0[k]), color: "var(--series-2)" }],
      yFormat: (v) => `$${v.toFixed(2)}`, xFormat: (s) => s, ariaLabel: "EPS estimate trend",
    }));
  }
}

// ---------------------------------------------------------------- financials
function tabFinancials(d, body) {
  let mode = pref("finMode") || "quarterly";
  const host = h("div", {});
  const seg = h("div", { class: "seg fin-seg", role: "group", "aria-label": "Period" },
    [["quarterly", "Quarterly"], ["annual", "Annual"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String(k === mode),
      on: { click: (e) => { mode = k; pref("finMode", k); seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); fitDash(); } } }, l)));
  body.append(seg, host);

  const draw = () => {
    host.replaceChildren();
    const rows = d.financials?.[mode] || [];
    if (!rows.length) { host.append(card(null, {}, h("p", { class: "empty" }, "No financial statements available."))); return; }
    const cats = rows.map((r) => (mode === "annual" ? `FY${r.period.slice(2, 4)}` : A.quarterLabel(r.period)));
    const g = grid("financials");
    host.append(g);
    const money = (v, axis) => (axis ? A.money(v, { digits: 0 }).replace(".0", "") : A.money(v));
    const yoy = (field) => {
      const step = mode === "annual" ? 1 : 4;
      const a = rows[rows.length - 1]?.[field], b = rows[rows.length - 1 - step]?.[field];
      return isNum(a) && isNum(b) && b !== 0 ? (a - b) / Math.abs(b) : null;
    };
    const mk = (title, key, field, sub, area) => {
      const c = h("div", {});
      g.append(card(title, { term: key, sub, area }, c));
      requestAnimationFrame(() => columnChart(c, { categories: cats, series: [{ name: title, values: rows.map((r) => r[field]), color: "var(--series-1)" }], yFormat: money, ariaLabel: title, height: dashMQ.matches ? 150 : 200,
        colorFor: (si, i, v) => (v < 0 ? "var(--bad)" : "var(--series-1)") }));
    };
    const ry = yoy("revenue"), ny = yoy("netIncome");
    mk("Revenue", "revenue", "revenue", isNum(ry) ? `Latest ${A.pct(ry, { sign: true })} vs a year earlier` : "Total sales", "rev");
    const lastNI = rows[rows.length - 1]?.netIncome, prevNI = rows[rows.length - 1 - (mode === "annual" ? 1 : 4)]?.netIncome;
    const niSub = isNum(lastNI) && isNum(prevNI) && lastNI < 0 && prevNI > 0 ? "Swung to a loss vs a year earlier · red = loss"
      : isNum(lastNI) && isNum(prevNI) && lastNI > 0 && prevNI < 0 ? "Back to a profit vs a year earlier"
      : isNum(ny) ? `Latest ${A.pct(ny, { sign: true })} vs a year earlier · red = loss` : "Red bars are losses";
    mk("Net income (profit)", "netMargin", "netIncome", niSub, "ni");
    mk("Free cash flow", "freeCashflow", "freeCashflow", "Cash left after investing in the business", "fcf");

    const c = h("div", {});
    g.append(card("Margins", { area: "margins", term: "operatingMargin", sub: "Cents of profit kept per $1 of sales" },
      legend([{ name: "Gross", color: "var(--series-1)", kind: "line" }, { name: "Operating", color: "var(--series-2)", kind: "line" }, { name: "Net", color: "var(--series-3)", kind: "line" }]), c));
    const m = (a, b) => (isNum(a) && isNum(b) && b ? a / b : null);
    requestAnimationFrame(() => lineChart(c, {
      dates: cats, area: false, height: dashMQ.matches ? 150 : 200,
      series: [
        { name: "Gross", values: rows.map((r) => m(r.grossProfit, r.revenue)), color: "var(--series-1)" },
        { name: "Operating", values: rows.map((r) => m(r.operatingIncome, r.revenue)), color: "var(--series-2)" },
        { name: "Net", values: rows.map((r) => m(r.netIncome, r.revenue)), color: "var(--series-3)" },
      ],
      yFormat: (v) => `${(v * 100).toFixed(0)}%`, xFormat: (s) => s, ariaLabel: "Margins over time",
    }));

    const f = d.fundamentals;
    const lev = A.leverage(d);
    g.append(card("Balance sheet", { area: "bal", sub: "What it owns vs what it owes (latest)" },
      h("div", { class: "tiles" },
        tile("Cash", A.money(f.cash)),
        tile("Debt", A.money(f.debt)),
        tile("Net debt", lev && lev.netDebt < 0 ? `${A.money(-lev.netDebt)} net cash` : A.money(lev?.netDebt), null, "netDebtToEbitda"),
        tile("Net debt / EBITDA", lev ? A.times(lev.ratio) : "—", null, "netDebtToEbitda"),
        tile("Debt / equity", A.num(f.debtToEquity, 2), null, "debtToEquity"),
        tile("Current ratio", A.num(f.currentRatio, 2), null, "currentRatio"),
        tile("Return on equity", A.pct(f.roe), null, "roe"),
        tile("Short interest", A.pct(f.shortPercentOfFloat), null, "shortInterest"))));

    const cu = A.cashUses(d);
    if (cu) {
      const share = (v) => (cu.fcf > 0 ? ` (${A.pct(v / cu.fcf, { digits: 0 })})` : "");
      const fy = (r) => `FY${r.period.slice(2, 4)}`;
      const signed = (v) => (isNum(v) && v !== 0 ? `${v > 0 ? "+" : "−"}${A.money(Math.abs(v))}` : "—");
      g.append(card("Where the cash goes", { area: "cash", class: "span", term: "capitalAllocation", right: pill(cu.tone, cu.label),
        sub: `What ${A.shortName(d)} did with its free cash flow, ${cu.span} (fiscal years, from the cash-flow statement)` },
        h("div", { class: "cash" },
          h("div", { class: "cash-story" }, cu.lines.map((t) => h("p", {}, rich(t)))),
          h("div", { class: "cash-bars" },
            h("div", { class: "muted small", style: "margin-bottom:8px" }, `Spending as a share of the ${A.money(cu.fcf)} free cash flow`),
            hbars([{ label: "Free cash flow", value: Math.max(0, cu.fcf), highlight: true }, ...cu.parts.filter((p) => p.value > 0).map((p) => ({ label: p.label, value: p.value }))],
              (v) => `${A.money(v)}${v !== cu.fcf ? share(v) : ""}`),
            h("p", { class: "muted small", style: "margin:8px 0 0" }, cu.left >= 0 ? `About ${A.money(cu.left)} was left over (added to cash or invested elsewhere).`
              : `It spent ${A.money(-cu.left)} more than its free cash flow, covered by ${cu.debt > 0 ? "borrowing" : "cash it already had"}.`),
            h("div", { class: "tiles", style: "margin-top:10px" },
              tile("Share count", isNum(cu.sh1) ? `${A.num(cu.sh1 / 1e6, 0)}M` : "—", isNum(cu.shareChg) ? `${A.pct(cu.shareChg, { sign: true, digits: 1 })} since ${fy(cu.rows[0])}` : null, "shareCount"),
              tile("Handed back last year", A.pct(cu.yieldNow), "Buybacks + dividends ÷ market value", "buybacks"))),
          h("div", { class: "table-wrap cash-table" }, h("table", { class: "sticky-first" },
            h("thead", {}, h("tr", {}, h("th", {}, ""), cu.rows.map((r) => h("th", {}, fy(r))))),
            h("tbody", {},
              h("tr", {}, h("td", {}, termBtn("freeCashflow", "Free cash flow")), cu.rows.map((r) => h("td", { class: r.freeCashflow < 0 ? "down" : "" }, A.money(r.freeCashflow)))),
              h("tr", {}, h("td", {}, termBtn("buybacks", "Buybacks")), cu.rows.map((r) => h("td", {}, isNum(r.buybacks) && r.buybacks ? A.money(-r.buybacks) : "—"))),
              h("tr", {}, h("td", {}, termBtn("dividendYield", "Dividends")), cu.rows.map((r) => h("td", {}, isNum(r.dividendsPaid) && r.dividendsPaid ? A.money(-r.dividendsPaid) : "—"))),
              h("tr", {}, h("td", {}, h("span", { class: "has-tip", "data-tip": "+ means it borrowed more than it repaid that year; − means it paid debt down.", "data-tip-title": "Debt, net" }, "Debt (+ borrowed, − repaid)")),
                cu.rows.map((r) => h("td", {}, signed(r.netDebtIssued)))),
              h("tr", {}, h("td", {}, "Acquisitions"), cu.rows.map((r) => h("td", {}, isNum(r.acquisitions) && r.acquisitions < 0 ? A.money(-r.acquisitions) : isNum(r.acquisitions) && r.acquisitions > 0 ? `sold ${A.money(r.acquisitions)}` : "—"))),
              h("tr", {}, h("td", {}, termBtn("shareCount", "Shares (diluted)")), cu.rows.map((r) => h("td", {}, isNum(r.dilutedShares) ? `${A.num(r.dilutedShares / 1e6, 0)}M` : "—")))))))));
    }

    const L = [["revenue", "Revenue", "revenue"], ["grossProfit", "Gross profit", "grossMargin"], ["operatingIncome", "Operating income", "operatingMargin"], ["netIncome", "Net income", "netMargin"],
      ["eps", "EPS (reported)", "adjustedEps"], ["unusualItems", "Unusual items", "unusualItems"], ["operatingCashflow", "Operating cash flow", "operatingCashflow"], ["capex", "Capex", "capex"],
      ["freeCashflow", "Free cash flow", "freeCashflow"], ["buybacks", "Buybacks", "buybacks"], ["dividendsPaid", "Dividends paid", "dividendYield"], ["rnd", "R&D", null], ["interestExpense", "Interest expense", null]];
    g.append(card("All the numbers", { area: "table", class: "span dense", sub: "Negative capex/buybacks/dividends = cash going out" },
      h("div", { class: "table-wrap" }, h("table", { class: "sticky-first" },
        h("thead", {}, h("tr", {}, h("th", {}, ""), cats.map((x) => h("th", {}, x)))),
        h("tbody", {}, L.filter(([k]) => rows.some((r) => isNum(r[k]))).map(([k, label, term]) =>
          h("tr", {}, h("td", {}, term ? termBtn(term, label) : label), rows.map((r) => h("td", { class: isNum(r[k]) && r[k] < 0 ? "down" : "" }, k === "eps" ? A.price(r[k]) : A.money(r[k]))))))))));
    fitDash();
  };
  draw();
}

// ---------------------------------------------------------------- valuation
function tabValuation(d, body) {
  const v = d.valuation, q = d.quote, f = d.fundamentals;
  const g = grid("valuation");
  body.append(g);
  const fcfYield = isNum(f.freeCashflow) && isNum(q.marketCap) ? f.freeCashflow / q.marketCap : null;

  const def = A.valuationInputs(d);
  const P = A.presets(def);
  const m = { ...def };
  const included = {};
  let firstRun = true;

  const resultBox = h("div", { class: "fv" });
  const scale = h("div", {});
  const methodsBox = h("div", { class: "methods" });
  const warnBox = h("div", {});
  const spreadBox = h("div", {});
  const sliders = [];
  const slider = (key, label, min, max, step, fmt, hint, term) => {
    const val = h("b", { class: "tnum" }, fmt(m[key]));
    const input = h("input", { type: "range", min, max, step, value: m[key], "aria-label": label,
      on: { input: (e) => { m[key] = +e.target.value; val.textContent = fmt(m[key]); calc(); } } });
    input.addEventListener("input", () => presetBtns.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false")));
    sliders.push({ key, input, val, fmt });
    return h("div", { class: "slider" }, h("label", {}, h("span", {}, term ? termBtn(term, label) : label), val), input, hint ? h("div", { class: "hint" }, hint) : null);
  };
  const setAll = (vals) => { Object.assign(m, vals); sliders.forEach((s) => { s.input.value = m[s.key]; s.val.textContent = s.fmt(m[s.key]); }); calc(); };

  const calc = () => {
    const methods = A.valuationMethods(d, m);
    if (firstRun) { methods.forEach((x) => (included[x.id] = x.include)); firstRun = false; }
    methods.forEach((x) => { if (!isNum(x.value)) included[x.id] = false; });
    const b = A.blend(methods, included);

    // headline
    resultBox.replaceChildren();
    if (!b) {
      resultBox.append(h("p", { class: "muted", style: "margin:0" }, "No method can be calculated with these inputs. Try including another method below."));
    } else {
      const gap = b.avg / q.price - 1;
      const [tone, word] = gap > 0.15 ? ["good", "Looks cheap"] : gap > -0.1 ? ["ok", "About fair"] : ["bad", "Looks expensive"];
      resultBox.append(
        h("div", { class: "muted small" }, `Fair value · average of ${b.n} method${b.n === 1 ? "" : "s"}`),
        h("div", { class: "big tnum" }, A.price(b.avg)),
        h("div", { class: `tnum ${signClass(gap)}`, style: "font-weight:650" }, `${arrow(gap)} ${A.pct(Math.abs(gap))} ${gap >= 0 ? "above" : "below"} today's price`),
        h("div", { style: "margin-top:6px" }, pill(tone, word)),
        b.n > 1 ? h("div", { class: "small ink2 tnum", style: "margin-top:4px" }, `Methods range ${A.price(b.low)} – ${A.price(b.high)}`) : null);
    }

    // scale: every method's value vs today's price
    scale.replaceChildren();
    const pts = methods.filter((x) => isNum(x.value));
    if (pts.length) {
      const all = [...pts.map((x) => x.value), q.price, ...(b ? [b.avg] : [])];
      const lo = Math.min(...all) * 0.92, hi = Math.max(...all) * 1.06;
      const pos = (x) => `${((x - lo) / (hi - lo)) * 100}%`;
      scale.append(h("div", { class: "vscale", role: "img", "aria-label": pts.map((x) => `${x.name} ${A.price(x.value)}`).join(", ") + `, today ${A.price(q.price)}` },
        h("div", { class: "vscale-track" }),
        b && b.n > 1 ? h("div", { class: "vscale-band", style: `left:${pos(b.low)};width:calc(${pos(b.high)} - ${pos(b.low)})` }) : null,
        ...pts.map((x, i) => h("div", { class: `vscale-dot ${included[x.id] ? "" : "off"}`, style: `left:${pos(x.value)};z-index:${(included[x.id] ? 20 : 1) + methods.indexOf(x)}`, "data-tip": `${A.price(x.value)}${included[x.id] ? "" : " (not in average)"}`, "data-tip-title": x.name }, String(methods.indexOf(x) + 1))),
        b ? h("div", { class: "vscale-avg", style: `left:${pos(b.avg)}`, "data-tip": A.price(b.avg), "data-tip-title": "Blended fair value" }) : null,
        h("div", { class: "vscale-price", style: `left:${pos(q.price)}` }, h("span", { class: (q.price - lo) / (hi - lo) < 0.15 ? "at-start" : (q.price - lo) / (hi - lo) > 0.85 ? "at-end" : "" }, `Today ${A.price(q.price)}`))),
        legend([{ name: "Method (number = row below)", color: "var(--series-1)" }, { name: "Left out", color: "var(--series-muted)" }, { name: "Fair value", color: "var(--series-2)" }, { name: "Today's price", color: "var(--ink)", kind: "line" }]));
    }

    // methods with their math
    methodsBox.replaceChildren(...methods.map((x, i) => {
      const can = isNum(x.value);
      const box = h("input", { type: "checkbox", "aria-label": `Include ${x.name} in the average`, ...(included[x.id] ? { checked: true } : {}), ...(can ? {} : { disabled: true }),
        on: { change: (e) => { included[x.id] = e.target.checked; calc(); } } });
      const gap = can ? x.value / q.price - 1 : x.display ? -1 : null;
      const tone = gap == null ? "na" : gap > 0.15 ? "good" : gap > -0.1 ? "ok" : "bad";
      return h("details", { class: `method ${included[x.id] ? "" : "excluded"}` },
        h("summary", {},
          h("label", { class: "method-check", on: { click: (e) => e.stopPropagation() } }, box),
          h("span", { class: "method-num" }, String(i + 1)),
          h("span", { class: "method-name" }, h("b", {}, x.name, x.floor ? h("span", { class: "tag plain mini" }, "floor") : !included[x.id] && can ? h("span", { class: "tag plain mini" }, "left out") : null), h("span", { class: "muted small" }, x.short)),
          h("span", { class: "method-val tnum" }, can ? A.price(x.value) : x.display || "n/a",
            gap != null ? h("span", { class: `mv ${tone}` }, h("span", { class: "ic", "aria-hidden": "true" }, gap >= 0 ? "▲" : "▼"), `${A.pct(Math.abs(gap), { digits: 0 })} ${gap >= 0 ? "above" : "below"}`) : null)),
        h("div", { class: "method-body" },
          x.plain ? h("p", { class: "method-plain" }, rich(x.plain)) : null,
          x.reason ? h("p", { class: "notice", style: "margin:0 0 8px" }, rich(x.reason)) : null,
          x.steps.length ? h("table", { class: "steps-table" }, h("tbody", {}, x.steps.map(([a, val]) => h("tr", {}, h("td", {}, a), h("td", { class: "tnum" }, val))))) : null,
          x.peers?.length ? (() => {
            const K = x.peerKey, cols = [["evToEbitda", "EV/EBITDA"], ["forwardPE", "Fwd P/E"]];
            const used = (p) => isNum(p[K]) && p[K] > 0 && p[K] < x.peerMax;
            const cell = (p, k) => k === K && !used(p) ? `${isNum(p[k]) ? A.times(p[k]) : "—"} (skipped)` : isNum(p[k]) && p[k] > 0 ? A.times(p[k]) : "—";
            return h("div", { class: "table-wrap", style: "margin-top:8px" }, h("table", { class: "steps-table peers-table" },
              h("thead", {}, h("tr", {}, h("th", {}, `Peers (${d.peers.industry || "same industry"})`), cols.map(([k, l]) => h("th", { class: k === K ? "used" : "" }, l)), h("th", {}, "Size"))),
              h("tbody", {},
                h("tr", { class: "self" }, h("td", {}, h("b", {}, `${d.symbol} (this one)`)), cols.map(([k]) => h("td", { class: "tnum" }, A.times(d.valuation?.[k]))), h("td", { class: "tnum" }, A.money(q.marketCap))),
                x.peers.map((p) => h("tr", { class: used(p) ? "" : "unused" }, h("td", {}, p.symbol, h("span", { class: "muted" }, ` · ${p.name}`)),
                  cols.map(([k]) => h("td", { class: `tnum${k === K ? " used" : ""}` }, cell(p, k))), h("td", { class: "tnum" }, A.money(p.marketCap)))))),
              h("p", { class: "muted small", style: "margin:4px 0 0" }, `Peers are the largest companies Yahoo lists in the same industry. Multiples above ${x.peerMax}× or below zero (one-off losses, holding companies) are skipped.`));
          })() : null,
          isNum(x.implied) ? h("p", { class: "small ink2", style: "margin:8px 0 0" }, termBtn("impliedGrowth", "Reverse check:"),
            ` today's price of ${A.price(q.price)} is exactly "fair" under this method if growth is ${A.pct(x.implied, { digits: 1 })} a year` +
            (isNum(def.analystGrowth) ? ` (analysts expect ~${A.pct(def.analystGrowth, { digits: 0 })}).` : ".")) : null));
    }));

    // warnings
    const w = A.modelWarnings(d, m, b?.avg);
    if (false) w.unshift(`The methods disagree a lot (${A.price(b.low)} to ${A.price(b.high)}). Open each one below to see which assumption drives the difference. Usually it's how long you believe the cash flows will last.`);
    const conf = A.confidence(b), why = A.explainSpread(d, methods, included, m);
    spreadBox.replaceChildren();
    if (conf) spreadBox.append(h("div", { class: `spread ${conf.tone}` },
      h("div", { class: "spread-head" }, pill(conf.tone, conf.label), h("span", { class: "small ink2" }, rich(conf.text))),
      why.length ? h("ul", { class: "spread-why" }, why.map((t) => h("li", {}, rich(t)))) : null));
    const dp = A.debtPicture(d, def);
    warnBox.replaceChildren(...w.filter((t) => !(dp && dp.tone === "bad" && t.startsWith("Heavy debt"))).map((t) => h("div", { class: "story-line note small" }, h("span", { class: "ic", "aria-hidden": "true" }, "!"), h("div", {}, t))));
  };

  const scnTip = (k) => `Growth ${A.pct(P[k].growth, { digits: 0 })} a year · exit P/E ${A.num(P[k].exitPE, 1)}× · required return ${A.pct(P[k].discount, { digits: 1 })} · growth after year 5 ${A.pct(P[k].terminal, { digits: 1 })}`;
  const presetBtns = h("div", { class: "presets", role: "group", "aria-label": "Scenario" },
    [["bear", "Bear", "things go worse"], ["base", "Base", "as expected"], ["bull", "Bull", "things go better"]].map(([k, l, sub]) =>
      h("button", { class: "chip", type: "button", "aria-pressed": String(k === "base"), "data-k": k, "data-tip": scnTip(k), "data-tip-title": `${l} case`,
        on: { click: () => { setAll(P[k]); presetBtns.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.k === k))); } } },
        h("b", {}, l), h("span", { class: "chip-sub" }, sub))));

  const assumptions = h("details", { class: "tune" },
    h("summary", {}, h("b", {}, "Fine-tune the assumptions"), h("span", { class: "muted small" }, " · optional · shared by every method · the scenario buttons set them for you")),
    h("div", { class: "tune-grid" },
    slider("growth", "Growth per year", 0, 0.35, 0.01, (x) => A.pct(x, { digits: 0 }),
      isNum(def.analystGrowth) ? `Analysts' 2-year view: ${A.pct(def.analystGrowth, { digits: 0 })}${def.analystGrowth > 0.15 ? " (default capped at 15%; fast growth rarely lasts)" : ""}` : null),
    slider("exitPE", "Exit P/E (method 1)", 2, 45, 0.5, (x) => `${A.num(x, 1)}×`, `Market pays ${A.times(def.currentPE)} today · typical stock ~17–20`, "exitPE"),
    slider("discount", "Required return", 0.06, 0.16, 0.005, (x) => A.pct(x, { digits: 1 }), def.heavyDebt ? "Default 12%: the usual 10% plus 2% for heavy debt" : "What you want to earn per year for the risk", "discountRate"),
    slider("terminal", "Growth after year 5 (method 2)", 0, 0.04, 0.005, (x) => A.pct(x, { digits: 1 }), "Long-run growth forever, usually near inflation (2–3%)"),
    slider("years", "Years projected", 3, 10, 1, (x) => `${x} years`)));

  const nMethods = A.valuationMethods(d, def).length;
  const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  g.append(card(`What's it worth? ${WORDS[nMethods] ? WORDS[nMethods][0].toUpperCase() + WORDS[nMethods].slice(1) : nMethods} ways to estimate it`, { area: "calc", class: "span", term: "fairValue",
    sub: "Each method asks “what is this stock worth?” a different way. Ticked methods are averaged into the fair value." },
    h("div", { class: "calc" },
      h("div", { class: "calc-top" }, resultBox,
        h("div", { class: "calc-scn" },
          h("div", { class: "scn-label" }, h("b", {}, "Scenario"), h("span", { class: "muted small" }, " · hover for the numbers")), presetBtns, scale)),
      spreadBox,
      h("h3", { style: "margin-top:2px" }, `The ${WORDS[nMethods] || nMethods} methods `, h("span", { class: "muted small", style: "font-weight:400" }, "· open one to see its math")), methodsBox, warnBox,
      assumptions,
      h("p", { class: "muted small", style: "margin:0" }, "Simplified models: no dividends, steady growth. Use them to see what the price assumes, not as a target."))));
  requestAnimationFrame(calc);

  const dpic = A.debtPicture(d, def);
  if (dpic) g.append(card("How the debt is counted", { area: "debt", term: "netDebtToEbitda", right: pill(dpic.tone, dpic.label) },
    h("ul", { class: "spread-why debt-why" }, dpic.lines.map((t) => h("li", {}, rich(t))))));
  g.append(card("Valuation ratios", { area: "ratios", sub: "Different ways of asking 'how much am I paying?'" },
    h("div", { class: "tiles" },
      tile("P/E (trailing)", A.times(v.trailingPE), null, "pe"),
      tile("Forward P/E", A.times(v.forwardPE), null, "forwardPE"),
      tile("PEG", A.num(v.peg, 2), null, "peg"),
      tile("Price / sales", A.times(v.priceToSales), null, "priceToSales"),
      tile("EV / EBITDA", A.times(v.evToEbitda), null, "evToEbitda"),
      tile("FCF yield", A.pct(fcfYield), "Free cash flow ÷ market cap", "freeCashflow"),
      tile("Price / book", A.times(v.priceToBook), null, "priceToBook"),
      tile("Dividend yield", v.dividendYield ? A.pct(v.dividendYield, { digits: 2 }) : "None", isNum(v.payoutRatio) && v.payoutRatio > 0 ? `Pays out ${A.pct(v.payoutRatio, { digits: 0 })} of profit` : null, "dividendYield"))));

  const hist = d.history || [];
  if (hist.length >= 5) {
    const c = h("div", {});
    g.append(card("Forward P/E over time", { area: "hist", term: "forwardPE", sub: "From this dashboard's daily snapshots" }, c));
    requestAnimationFrame(() => lineChart(c, { dates: hist.map((x) => x.date), series: [{ name: "Forward P/E", values: hist.map((x) => x.forwardPE), color: "var(--series-1)" }],
      yFormat: (x) => `${x.toFixed(1)}×`, xFormat: (s) => A.date(s, { month: "short", day: "numeric" }), tipTitle: (s) => A.date(s), height: 180, fill: true, area: false }));
  } else {
    g.append(card("Valuation history", { area: "hist", sub: "Building up" },
      h("p", { class: "ink2", style: "margin:0" }, `Free data doesn't include past P/E or analyst estimates, so this dashboard saves its own snapshot every trading day. In a couple of weeks you'll see ${d.symbol}'s valuation trend here (${hist.length} snapshot${hist.length === 1 ? "" : "s"} so far).`)));
  }
}

// ---------------------------------------------------------------- analysts
function tabAnalysts(d, body) {
  const a = d.analysts, q = d.quote, tg = a.targets || {};
  const g = grid("analysts");
  body.append(g);

  const cur = (a.summary || []).find((r) => r.period === "0m");
  if (cur) {
    const parts = [["strongBuy", "Strong buy", "#1c5cab"], ["buy", "Buy", "#5598e7"], ["hold", "Hold", "#a3a29b"], ["sell", "Sell", "#e66767"], ["strongSell", "Strong sell", "#b42323"]];
    const total = parts.reduce((s, [k]) => s + (cur[k] || 0), 0) || 1;
    const bar = h("div", { class: "segbar", role: "img", "aria-label": parts.map(([k, l]) => `${l} ${cur[k] || 0}`).join(", ") },
      parts.filter(([k]) => cur[k]).map(([k, l, c]) => h("div", { style: `flex:${cur[k]};background:${c};${k === "hold" ? "color:#0b0b0b" : ""}`, "data-tip": `${cur[k]} analyst${cur[k] === 1 ? "" : "s"}`, "data-tip-title": l }, cur[k] / total > 0.08 ? String(cur[k]) : "")));
    const prev = (a.summary || []).find((r) => r.period === "-3m");
    const scPrev = prev ? A.ratingScore(prev) : null;
    const sgn = (x, dg = 0) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${A.num(Math.abs(x), dg)}`;
    // how the mix moved over the last few months
    const months = ["0m", "-1m", "-2m", "-3m"].map((k) => (a.summary || []).find((r) => r.period === k)).filter(Boolean);
    const MON = { "0m": "Now", "-1m": "1 month ago", "-2m": "2 months ago", "-3m": "3 months ago" };
    const miniBar = (r) => h("div", { class: "segbar mini", role: "img", "aria-label": parts.map(([k, l]) => `${l} ${r[k] || 0}`).join(", ") },
      parts.filter(([k]) => r[k]).map(([k, l, c]) => h("div", { style: `flex:${r[k]};background:${c}`, "data-tip": `${r[k]} analyst${r[k] === 1 ? "" : "s"}`, "data-tip-title": `${l} · ${MON[r.period]}` })));
    const recent = (a.actions || []).filter((x) => (Date.now() - new Date(x.date)) / 864e5 <= 90);
    const cnt = (k) => recent.filter((x) => x.action === k).length;
    const sc = A.ratingScore(cur);
    g.append(card("What analysts recommend", { area: "rec", term: "analystRating", sub: `${total} analysts this month${sc ? ` · overall: ${sc.label.toLowerCase()}` : ""}` },
      bar, legend(parts.map(([, l, c]) => ({ name: l, color: c }))),
      sc && scPrev ? h("p", { class: "small ink2", style: "margin:6px 0 0" }, rich(`**Net score ${sgn(sc.net)}**, ${Math.abs(sc.avg - scPrev.avg) < 0.05 ? "about the same as" : sc.avg > scPrev.avg ? "**more positive** than" : "**more negative** than"} three months ago (${sgn(scPrev.net)}).`)) : null,
      sc ? h("div", { class: "rec-score" },
        h("div", { class: "rec-score-head" }, h("span", { class: "has-tip", "data-tip": "Strong buy counts +2, buy +1, hold 0, sell −1, strong sell −2. Add them up, then divide by the number of analysts for the average.", "data-tip-title": "Net score" }, "Net score"),
          h("b", { class: "tnum" }, ` ${sc.net > 0 ? "+" : ""}${sc.net}`), h("span", { class: "muted small" }, ` from ${sc.n} analysts · average ${sc.avg > 0 ? "+" : ""}${A.num(sc.avg, 2)} each`), " ", pill(sc.tone, sc.label)),
        h("div", { class: "rec-math" }, parts.map(([k, l, c], i) => cur[k] ? h("span", { class: "rec-term" }, h("span", { class: "rdot", style: `background:${c}` }), `${cur[k]} ${l.toLowerCase()} × ${["+2", "+1", "0", "−1", "−2"][i]}`) : null)),
        h("div", { class: "rec-scale" }, h("div", { class: "rec-dot", style: `left:${10 + (80 * (2 - sc.avg)) / 4}%` }), ["Strong buy", "Buy", "Hold", "Sell", "Strong sell"].map((t) => h("span", {}, t))),
        h("p", { class: "small ink2", style: "margin:6px 0 0" }, rich(sc.avg < -0.1 ? "**More analysts say sell than buy.** That's unusual: analysts rarely say sell, so even a few sells is a meaningful warning." : sc.avg > 0.1 ? "More analysts say buy than sell." : "Buys and sells roughly cancel out."))) : null,
      months.length > 1 ? h("div", { class: "rec-months" }, h("div", { class: "muted small" }, "How the mix has changed (net score: buy +, sell −)"),
        h("div", { class: "rec-month rec-head muted small" }, h("span"), h("span"), h("span", {}, "Net"), h("span", {}, "Each"), h("span", { class: "has-tip", "data-tip": "Change in the net score from the month before." }, "Change")),
        months.map((r, i) => {
          const s1 = A.ratingScore(r), s0 = months[i + 1] ? A.ratingScore(months[i + 1]) : null;
          const dv = s1 && s0 ? s1.net - s0.net : null;
          const tip = s1 ? `Net score ${sgn(s1.net)} from ${s1.n} analysts, ${sgn(s1.avg, 2)} each on average.${dv != null ? ` ${dv === 0 ? "No change from" : dv > 0 ? `Up ${dv} from` : `Down ${-dv} from`} the month before.` : ""}` : "";
          return h("div", { class: "rec-month", "data-tip": tip, "data-tip-title": MON[r.period] }, h("span", { class: "small ink2" }, MON[r.period]), miniBar(r),
            h("b", { class: "small tnum" }, s1 ? sgn(s1.net) : "–"),
            h("span", { class: "small tnum muted" }, s1 ? sgn(s1.avg, 2) : ""),
            h("span", { class: `small tnum rec-chg ${dv > 0 ? "up" : dv < 0 ? "down" : ""}` }, dv == null ? "" : dv > 0 ? `▲ ${dv}` : dv < 0 ? `▼ ${-dv}` : "same"));
        })) : null,
      recent.length ? h("div", { class: "rec-tally" },
        h("div", { class: "muted small" }, "Last 90 days"),
        h("div", { class: "tally" },
          h("span", { class: "pill good" }, h("span", { class: "ic", "aria-hidden": "true" }, "▲"), `${cnt("up")} upgrade${cnt("up") === 1 ? "" : "s"}`),
          h("span", { class: "pill bad" }, h("span", { class: "ic", "aria-hidden": "true" }, "▼"), `${cnt("down")} downgrade${cnt("down") === 1 ? "" : "s"}`),
          cnt("init") ? h("span", { class: "pill na" }, h("span", { class: "ic", "aria-hidden": "true" }, "•"), `${cnt("init")} new`) : null,
          h("span", { class: "small muted" }, `${recent.length - cnt("up") - cnt("down") - cnt("init")} kept their rating`))) : null));
  }

  if (isNum(tg.mean)) {
    const vs = (x) => A.pct(x / q.price - 1, { sign: true });
    const ft = firmTargets(d).map((x) => x.target).sort((x, y) => x - y);
    const trimmed = ft.length >= 5 ? ft.slice(1, -1).reduce((s2, x) => s2 + x, 0) / (ft.length - 2) : null;
    const skew = isNum(tg.median) ? tg.mean / tg.median - 1 : 0;
    g.append(card("12-month price targets", { area: "targets", term: "priceTarget" },
      h("div", { class: "tiles four", style: "margin-bottom:10px" },
        tile("Lowest", A.price(tg.low), vs(tg.low)),
        isNum(tg.median) ? tile("Middle", A.price(tg.median), vs(tg.median)) : null,
        tile("Average", A.price(tg.mean), vs(tg.mean)),
        tile("Highest", A.price(tg.high), vs(tg.high))),
      isNum(tg.median) ? h("p", { class: "small ink2", style: "margin:0 0 4px" }, rich(
        `**Half the analysts are above ${A.price(tg.median)} and half below.** ` +
        (Math.abs(skew) > 0.05 ? `The average (${A.price(tg.mean)}) is ${skew > 0 ? "higher" : "lower"} because a few targets are far ${skew > 0 ? "above" : "below"} the rest, so **the middle is the better guide**. ` : "The average is close to the middle, so no single target is skewing it. ") +
        (isNum(trimmed) ? `Dropping the highest and lowest of the ${ft.length} firms with recent targets gives **${A.price(trimmed)}**.` : ""))) : null,
      targetStrip(d),
      h("p", { class: "small muted", style: "margin:6px 0 0" }, "Targets tend to chase the price. They get raised after rallies and cut after drops.")));
  }

  if ((a.actions || []).length) {
    const SHOW = 15;
    const list = h("div", { class: "actions-grid" });
    const more = a.actions.length > SHOW ? h("button", { class: "linkish small", type: "button", style: "margin-top:8px",
      on: { click: () => { list.classList.toggle("all"); more.textContent = list.classList.contains("all") ? "Show fewer" : `Show all ${Math.min(25, a.actions.length)}`; fitDash(); } } }, `Show all ${Math.min(25, a.actions.length)}`) : null;
    g.append(card("Recent rating changes", { area: "actions", class: "span",
      sub: "Each firm's latest move. The colored edge is the firm's rating now. Firms use different words for the same three ratings; hover a rating for its meaning." },
      legend(RATING_NAMES.map((n, i) => ({ name: `${n} (e.g. ${["Overweight, Outperform", "Neutral, Equal-Weight, Sector Perform", "Underweight, Underperform"][i]})`, color: RATING_COLORS[i] }))), list, more));
    const ACT = { up: ["good", "▲", "Upgrade", "Raised its rating"], down: ["bad", "▼", "Downgrade", "Lowered its rating"], init: ["na", "•", "New coverage", "Started covering the stock"],
      main: ["na", "=", "Kept", "Kept its rating (and often updated its target)"], reit: ["na", "=", "Kept", "Repeated its rating"] };
    list.append(...a.actions.slice(0, 25).map((x, i) => {
        const [tone, ic, word, tip] = ACT[x.action] || ACT.main;
        const tchg = isNum(x.priorTarget) && x.priorTarget > 0 && isNum(x.target) && x.priorTarget !== x.target ? x.target - x.priorTarget : null;
        return h("div", { class: `list-row arow${i >= SHOW ? " extra" : ""}`, style: x.to ? `border-left-color:${RATING_COLORS[RATING_GROUP(x.to)]}` : null },
          h("div", { class: "grow" },
            h("div", {}, h("b", {}, x.firm || "—"), h("span", { class: "muted small" }, ` · ${A.date(x.date, { month: "short", day: "numeric", year: "numeric" })}`)),
            h("div", { class: "small ink2", style: "margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap" },
              h("span", { class: `pill ${tone}`, "data-tip": tip }, h("span", { class: "ic", "aria-hidden": "true" }, ic), word),
              ratingChip(x.to),
              x.from && x.from !== x.to && (x.action === "up" || x.action === "down") ? h("span", { class: "muted" }, "from ", ratingChip(x.from)) : null)),
          isNum(x.target) ? h("div", { class: "small tnum", style: "text-align:right" },
            h("b", {}, A.price(x.target)),
            tchg != null ? [h("div", { class: signClass(tchg), style: "font-weight:600" }, `${tchg > 0 ? "▲" : "▼"} ${A.price(Math.abs(tchg))} (${A.pct(tchg / x.priorTarget, { sign: true })})`), h("div", { class: "muted" }, `from ${A.price(x.priorTarget)}`)]
              : h("div", { class: "muted" }, x.targetAction === "Maintains" ? "target unchanged" : "target")) : null);
      }));
  }

  const ins = A.insiderSummary(d);
  if (ins) {
    const trades = ins.recent.filter((x) => x.kind === "buy" || x.kind === "sell");
    const SHOW = 8;
    const list = h("div", { class: "ins-list" }, trades.map((x, i) => h("div", { class: `list-row${i >= SHOW ? " extra" : ""}` },
      h("div", { class: "grow" },
        h("div", {}, h("b", {}, x.name), x.role ? h("span", { class: "muted small" }, ` · ${x.role}`) : null),
        h("div", { class: "small muted" }, `${A.date(x.date)} · ${A.num(x.shares, 0)} shares${isNum(x.price) ? ` at ~${A.price(x.price)}` : ""}${x.indirect ? " · includes shares held indirectly (trust, family)" : ""}`)),
      h("div", { style: "text-align:right" },
        x.kind === "buy" ? h("span", { class: "pill good" }, h("span", { class: "ic", "aria-hidden": "true" }, "▲"), "Bought") : h("span", { class: "pill na" }, h("span", { class: "ic", "aria-hidden": "true" }, "▼"), "Sold"),
        h("div", { class: "small tnum", style: "margin-top:3px;font-weight:600" }, A.moneyShort(x.value))))));
    const more = trades.length > SHOW ? h("button", { class: "linkish small", type: "button", style: "margin-top:8px",
      on: { click: () => { list.classList.toggle("all"); more.textContent = list.classList.contains("all") ? "Show fewer" : `Show all ${trades.length}`; fitDash(); } } }, `Show all ${trades.length}`) : null;
    g.append(card("What insiders are doing", { area: "insiders", class: "span", term: "insiders", right: pill(ins.tone, ins.label),
      sub: "Trades by the company's own executives and directors in the last 12 months, from their SEC filings (Form 4)" },
      h("div", { class: "ins" },
        h("div", {},
          h("div", { class: "tiles" },
            tile("Bought", ins.bought ? A.moneyShort(ins.bought) : "None", `${ins.buyers} ${ins.buyers === 1 ? "person" : "people"}`),
            tile("Sold", ins.sold ? A.moneyShort(ins.sold) : "None", `${ins.sellers} ${ins.sellers === 1 ? "person" : "people"}`)),
          h("div", { class: "ins-story" }, ins.lines.map((t) => h("p", { class: "small ink2" }, rich(t))))),
        trades.length ? h("div", {}, list, more) : h("p", { class: "muted" }, "No open-market buys or sales in the last 12 months."))));
  }
}

// ---------------------------------------------------------------- news
function tabNews(d, body) {
  const items = d.news || [];
  const g = grid("news");
  g.append(card("Recent headlines", { area: "news", class: "scroll-full", sub: "From Yahoo Finance; opens the original article. The mood tag is a rough guess from words in the headline (like 'beats' or 'plunges'), not a real analysis." },
    items.length ? h("div", { class: "news-list" }, items.map((n) => h("a", { class: "news-item", href: n.url, target: "_blank", rel: "noopener noreferrer" },
      h("h3", {}, n.title),
      n.summary ? h("p", {}, n.summary) : null,
      h("div", { class: "news-meta muted small" }, (() => { const md = A.newsMood(n); return h("span", { class: `pill ${md.tone}` }, h("span", { class: "ic", "aria-hidden": "true" }, md.icon), md.word); })(),
        [n.publisher, n.date ? A.date(n.date) : null].filter(Boolean).join(" · "))))) : h("p", { class: "empty" }, "No recent news.")));
  body.append(g);
}

// ---------------------------------------------------------------- holdings (ETF)
function tabHoldings(d, body) {
  const f = d.fund;
  const watch = new Set(tickers().map((t) => t.symbol.replace("GOOGL", "GOOG")));
  const g = grid("holdings");
  body.append(g);
  const hold = f.holdings || [];
  const topSum = hold.reduce((s, x) => s + (x.weight || 0), 0);
  g.append(card(`Top ${hold.length} holdings`, { area: "top", term: "concentration", sub: `${A.pct(topSum, { digits: 0 })} of the fund. Orange = also on your watchlist.${f.holdingsSource ? ` Source: ${f.holdingsSource}.` : ""}` },
    hbars(hold.map((x) => ({ label: `${x.symbol} · ${x.name}`, value: x.weight, highlight: watch.has(x.symbol.replace("GOOGL", "GOOG")) })), (v) => A.pct(v, { digits: 1 }))));
  const S = { technology: "Technology", financial_services: "Financials", communication_services: "Communication", consumer_cyclical: "Consumer (discretionary)", healthcare: "Healthcare", industrials: "Industrials",
    consumer_defensive: "Consumer (staples)", energy: "Energy", utilities: "Utilities", realestate: "Real estate", basic_materials: "Materials" };
  const sectors = Object.entries(f.sectors || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (sectors.length) {
    g.append(card("Sector mix", { area: "sectors", sub: "Share of the fund in each part of the economy" },
      hbars(sectors.map(([k, v]) => ({ label: S[k] || k, value: v })), (v) => A.pct(v, { digits: 1 }))));
  }
  const ov = hold.filter((x) => watch.has(x.symbol.replace("GOOGL", "GOOG")));
  if (ov.length) {
    const byS = {};
    ov.forEach((x) => { const s = x.symbol.replace("GOOGL", "GOOG"); byS[s] = (byS[s] || 0) + x.weight; });
    g.append(card("Overlap with your watchlist", { area: "overlap", class: "span" },
      h("p", { class: "ink2", style: "margin:0" }, `For every $1,000 in ${d.symbol}, about ${Object.entries(byS).map(([s, w]) => `$${Math.round(w * 1000)} goes to ${s}`).join(" and ")}. If you also buy those stocks directly, you're adding to positions you already hold through the fund.`)));
  }
}

// ================================================================ peers
// The company next to the largest companies in its Yahoo industry (fetch.py's build_peers).
// Each row reads the same Yahoo field for the company and every peer, so they're comparable.
// `ok` drops meaningless values (negative multiples, buyback-inflated returns) before ranking;
// `better` is the direction that wins, or null when higher isn't better or worse.
const netDebtRatio = (debt, cash, ebitda) => (isNum(debt) && isNum(cash) && isNum(ebitda) && ebitda > 0 ? (debt - cash) / ebitda : null);
const recWord = (v) => (v < 1.5 ? "Strong buy" : v < 2.5 ? "Buy" : v < 3.5 ? "Hold" : v < 4.5 ? "Sell" : "Strong sell");
const PEER_GROUPS = [
  ["Is the price reasonable?", [
    { label: "Forward P/E", term: "forwardPE", self: (d) => d.valuation?.forwardPE, peer: (p) => p.forwardPE, fmt: (v) => A.times(v), better: "low", ok: (v) => v > 0 && v < 80, words: ["cheaper", "pricier"] },
    { label: "PEG", term: "peg", self: (d) => d.valuation?.peg, peer: (p) => p.peg, fmt: (v) => A.num(v, 2), better: "low", ok: (v) => v > 0 && v < 10, words: ["cheaper for its growth", "pricier for its growth"] },
    { label: "EV / EBITDA", term: "evToEbitda", self: (d) => d.valuation?.evToEbitda, peer: (p) => p.evToEbitda, fmt: (v) => A.times(v), better: "low", ok: (v) => v > 0 && v < 60, words: ["cheaper", "pricier"] },
    { label: "Price / sales", term: "priceToSales", self: (d) => d.valuation?.priceToSales, peer: (p) => p.priceToSales, fmt: (v) => A.times(v), better: "low", ok: (v) => v > 0 && v < 50, words: ["cheaper", "pricier"] },
  ]],
  ["How good is the business?", [
    { label: "Sales growth", term: "revenueGrowth", self: (d) => d.fundamentals?.revenueGrowth, peer: (p) => p.revenueGrowth, fmt: (v) => A.pct(v, { sign: true }), better: "high", words: ["faster-growing", "slower-growing"] },
    { label: "Operating margin", term: "operatingMargin", self: (d) => d.fundamentals?.operatingMargin, peer: (p) => p.operatingMargin, fmt: (v) => A.pct(v), better: "high", words: ["more profitable", "less profitable"] },
    { label: "Return on equity", term: "roe", self: (d) => d.fundamentals?.roe, peer: (p) => p.roe, fmt: (v) => A.pct(v, { digits: 0 }), better: "high", ok: (v) => v > -1 && v < 1.5, words: ["better at earning on shareholders' money", "worse at earning on shareholders' money"] },
  ]],
  ["How risky is it?", [
    { label: "Net debt / EBITDA", term: "netDebtToEbitda", self: (d) => A.leverage(d)?.ratio, peer: (p) => netDebtRatio(p.debt, p.cash, p.ebitda), fmt: (v) => (v < 0 ? "Net cash" : A.times(v)), better: "low", ok: (v) => v > -10 && v < 20, words: ["less indebted", "more indebted"] },
    { label: "Beta", term: "beta", self: (d) => d.quote?.beta, peer: (p) => p.beta, fmt: (v) => A.num(v, 2), better: null, higher: "swingier" },
    { label: "1-year return", term: null, self: (d) => A.priceChange(d, 252), peer: (p) => p.change52, fmt: (v) => A.pct(v, { sign: true, digits: 0 }), better: null, higher: "up more" },
    { label: "Below 52-week high", term: "range52", self: (d) => (d.quote?.high52 ? d.quote.price / d.quote.high52 - 1 : null), peer: (p) => (p.high52 && p.price ? p.price / p.high52 - 1 : null), fmt: (v) => (v > -0.005 ? "At its high" : A.pct(v, { digits: 0 })), better: null, higher: "closer to its high" },
  ]],
  ["What do shareholders get?", [
    { label: "Dividend yield", term: "dividendYield", self: (d) => d.valuation?.dividendYield || 0, peer: (p) => p.dividendYield || 0, fmt: (v) => (v ? A.pct(v, { digits: 2 }) : "None"), better: null, higher: "pays more" },
  ]],
  ["What do analysts think?", [
    { label: "Analyst rating", term: "analystRating", self: (d) => d.analysts?.recommendationMean, peer: (p) => p.recommendationMean, fmt: (v) => `${recWord(v)} (${A.num(v, 1)})`, better: "low", ok: (v) => v >= 1 && v <= 5, words: ["rated more highly", "rated less highly"] },
    { label: "Upside to middle target", term: "priceTarget", self: (d) => { const t = d.analysts?.targets || {}, v = isNum(t.median) ? t.median : t.mean; return isNum(v) ? v / d.quote.price - 1 : null; },
      peer: (p) => (isNum(p.targetMedian) && p.price ? p.targetMedian / p.price - 1 : null), fmt: (v) => A.pct(v, { sign: true }), better: "high", words: ["seen as having more upside", "seen as having less upside"] },
  ]],
];
const midOf = (xs) => { const v = [...xs].sort((a, b) => a - b), m = v.length >> 1; return !v.length ? null : v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
function peerStats(r, d) {
  const valid = (v) => isNum(v) && (!r.ok || r.ok(v));
  const sv = r.self(d), me = valid(sv) ? sv : null;
  const ps = (d.peers?.list || []).map((p) => ({ p, v: r.peer(p) })).filter((x) => valid(x.v));
  const n = ps.length, med = midOf(ps.map((x) => x.v));
  const above = me == null ? 0 : ps.filter((x) => me > x.v).length, below = me == null ? 0 : ps.filter((x) => me < x.v).length;
  const beats = r.better === "high" ? above : r.better === "low" ? below : null;
  const lags = r.better === "high" ? below : r.better === "low" ? above : null;
  const tone = beats == null || me == null || !n ? null : beats >= (2 * n) / 3 ? "good" : lags >= (2 * n) / 3 ? "bad" : "ok";
  return { me, ps, n, med, above, below, beats, lags, tone };
}
// a label that explains the term on hover/click without the rule-of-thumb thumb (this tab ranks against peers instead)
const termPlain = (key, label) => (key && GLOSSARY[key] ? h("button", { class: "term", type: "button", "data-term": key, on: { click: (e) => { e.preventDefault(); e.stopPropagation(); openTerm(key); } } }, label) : label);

function peerStrip(r, s, d) {
  const vals = [...s.ps.map((x) => x.v), ...(s.me != null ? [s.me] : [])];
  if (vals.length < 2) return h("div", {});
  const lo = Math.min(...vals), hi = Math.max(...vals), pos = (v) => `${hi > lo ? 4 + ((v - lo) / (hi - lo)) * 92 : 50}%`;
  return h("div", { class: "pstrip", role: "img", "aria-label": `${d.symbol} ${s.me != null ? r.fmt(s.me) : "n/a"}; peers from ${r.fmt(lo)} to ${r.fmt(hi)}` },
    h("div", { class: "pstrip-axis" }),
    isNum(s.med) ? h("div", { class: "pstrip-med", style: `left:${pos(s.med)}`, "data-tip": r.fmt(s.med), "data-tip-title": "Peers' middle" }) : null,
    s.ps.map((x) => h("div", { class: "pstrip-dot", style: `left:${pos(x.v)}`, "data-tip": r.fmt(x.v), "data-tip-title": `${x.p.symbol} · ${x.p.name}` })),
    s.me != null ? h("div", { class: "pstrip-dot me", style: `left:${pos(s.me)}`, "data-tip": r.fmt(s.me), "data-tip-title": `${d.symbol} (this one)` }) : null);
}

function tabPeers(d, body) {
  const pe = d.peers, list = pe?.list || [];
  const g = grid("peers", true);
  body.append(g);
  if (!list.length) {
    g.append(card("Peers", {}, h("p", { class: "muted", style: "margin:0" }, "Yahoo doesn't list other companies in this industry, so there's nothing to compare against.")));
    return;
  }
  const rows = PEER_GROUPS.flatMap(([, rs]) => rs.map((r) => ({ r, s: peerStats(r, d) })));
  const name = A.shortName(d);

  // in words: where it beats or lags most of its peers
  const line = (r, s, good) => rich(`**${(good ? r.words[0] : r.words[1]).replace(/^./, (c) => c.toUpperCase())}** than ${good ? s.beats : s.lags} of ${s.n} peers on ${r.label.replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase())} (${r.fmt(s.me)} vs a middle of ${r.fmt(s.med)})`);
  const wins = rows.filter((x) => x.s.tone === "good"), losses = rows.filter((x) => x.s.tone === "bad");
  const others = list.filter((p) => isNum(p.marketCap)).length;
  g.append(card(`How ${name} stacks up`, { area: "sum", sub: `Against the ${list.length} largest other companies in ${pe.industry || "its industry"}, as listed by Yahoo` },
    h("div", { class: "psum" },
      h("div", {}, h("h3", {}, pill("good", "Beats most peers")), wins.length ? h("ul", { class: "spread-why" }, wins.map((x) => h("li", {}, line(x.r, x.s, true)))) : h("p", { class: "muted small" }, "Not clearly ahead on any of these.")),
      h("div", {}, h("h3", {}, pill("bad", "Lags most peers")), losses.length ? h("ul", { class: "spread-why" }, losses.map((x) => h("li", {}, line(x.r, x.s, false)))) : h("p", { class: "muted small" }, "Not clearly behind on any of these."))),
    h("div", { class: "peer-names" }, h("div", { class: "muted small" }, "The peers"),
      h("div", { class: "peer-chips" }, list.map((p) => state.data[p.symbol]
        ? h("a", { class: "tag plain", href: `#/t/${p.symbol}/peers`, "data-tip": `${p.name} · ${A.money(p.marketCap)} · on your watchlist`, "data-tip-title": p.symbol }, p.symbol)
        : h("span", { class: "tag plain", "data-tip": `${p.name} · ${A.money(p.marketCap)}`, "data-tip-title": p.symbol }, p.symbol)))),
    h("p", { class: "muted small", style: "margin:10px 0 0" }, `“Beats most” means better than at least two-thirds of the peers with a usable number. Peers are chosen by industry, not by business model, so check that they're really comparable${others < 4 ? ". With so few peers, treat the ranks loosely" : ""}.`)));

  // every metric: this company, the peers' middle, where it sits among them
  const head = h("div", { class: "prow phead muted small" }, h("span", {}), h("span", {}, d.symbol), h("span", {}, "Peers' middle"), h("span", {}, "Where it sits (each dot is a peer)"), h("span", {}));
  g.append(card("Side by side with its peers", { area: "list", sub: `${d.symbol} is the larger blue dot; the line is the peers' middle. Hover a dot to see which company it is.` },
    legend([{ name: d.symbol, color: "var(--series-1)" }, { name: "A peer", color: "var(--series-muted)" }, { name: "Peers' middle", color: "var(--ink)", kind: "line" }]),
    head,
    PEER_GROUPS.map(([title, rs]) => h("div", { class: "pgroup" }, h("h3", {}, title), rs.map((r) => {
      const s = peerStats(r, d);
      const where = s.me == null || !s.n ? h("span", { class: "muted small" }, "n/a")
        : r.better ? pill(s.tone, `Better than ${s.beats} of ${s.n}`)
        : h("span", { class: "small ink2" }, `${r.higher.replace(/^./, (c) => c.toUpperCase())} than ${s.above} of ${s.n}`);
      return h("div", { class: "prow" },
        h("span", { class: "plbl" }, r.term ? termPlain(r.term, r.label) : r.label),
        h("b", { class: "pme tnum" }, s.me != null ? r.fmt(s.me) : "—"),
        h("span", { class: "pmed tnum muted" }, isNum(s.med) ? r.fmt(s.med) : "—"),
        h("div", { class: "pstr" }, peerStrip(r, s, d)),
        h("span", { class: "pwhere" }, where));
    })))));

  // the raw numbers, company by company
  const cols = PEER_GROUPS.flatMap(([, rs]) => rs);
  const cell = (r, v) => h("td", { class: "tnum" }, isNum(v) && (!r.ok || r.ok(v)) ? r.fmt(v) : "—");
  g.append(card(null, { area: "all", class: "span" },
    h("details", { class: "peer-all" }, h("summary", {}, h("b", {}, "Every peer's numbers"), h("span", { class: "muted small" }, " · the table behind the chart, largest company first")),
      h("div", { class: "table-wrap" }, h("table", { class: "cmp sticky-first" },
        h("thead", {}, h("tr", {}, h("th", {}, "Company"), h("th", {}, "Size"), cols.map((r) => h("th", {}, r.label)))),
        h("tbody", {},
          h("tr", { class: "self" }, h("td", {}, h("b", {}, `${d.symbol} (this one)`)), h("td", { class: "tnum" }, A.money(d.quote.marketCap)), cols.map((r) => cell(r, r.self(d)))),
          [...list].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).map((p) => h("tr", {},
            h("td", {}, state.data[p.symbol] ? h("a", { href: `#/t/${p.symbol}/peers` }, p.symbol) : p.symbol, h("span", { class: "muted" }, ` · ${p.name}`)),
            h("td", { class: "tnum" }, A.money(p.marketCap)), cols.map((r) => cell(r, r.peer(p)))))))))));
}

// ================================================================ learn
function renderLearn(anchor) {
  const search = h("input", { type: "search", placeholder: "Search terms (e.g. P/E, free cash flow)", "aria-label": "Search glossary" });
  const list = h("div", {});
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren(...Object.entries(GLOSSARY)
      .filter(([, g]) => !q || `${g.term} ${g.short} ${g.what}`.toLowerCase().includes(q))
      .sort((a, b) => a[1].term.localeCompare(b[1].term))
      .map(([k, g]) => h("details", { class: "gl-item", id: `g-${k}` },
        h("summary", {}, h("span", {}, g.term, h("span", { class: "gl-short" }, g.short))),
        h("div", { class: "body" }, h("p", {}, g.what), h("p", {}, h("b", {}, "Why it matters: "), g.why), g.rule ? h("p", {}, h("b", {}, "Rule of thumb: "), g.rule) : null))));
    if (!list.children.length) list.append(h("p", { class: "empty" }, "No matching terms."));
  };
  search.addEventListener("input", draw);
  draw();
  const guide = card("How to read an earnings report", { area: "guide", class: "scroll-full", sub: "Seven questions to ask every quarter" },
    EARNINGS_GUIDE.map((s) => h("details", { class: "gl-item" }, h("summary", {}, s.title), h("div", { class: "body" }, h("p", {}, s.body)))));
  guide.id = "earnings";
  view.append(h("div", { class: "home-hero" }, h("div", {}, h("h1", {}, "Learn the jargon"), h("div", { class: "muted small" }, "Every number in this app, explained in plain English"))),
    (() => { const g = grid("learn"); g.append(guide, card("Glossary", { area: "gloss", class: "scroll-full" }, h("div", { class: "field" }, search), list)); return g; })());
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
}

// ================================================================ settings
function renderSettings() {
  const c = GH.getConfig();
  const theme = pref("theme") || "auto";
  const themeSeg = h("div", { class: "seg", role: "group", "aria-label": "Theme" },
    [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String(theme === k),
      on: { click: () => { pref("theme", k); if (k === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = k; route(); } } }, l)));

  const f = (id, label, value, attrs = {}, hint) => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, value: value || "", autocomplete: "off", autocapitalize: "off", spellcheck: "false", ...attrs }), hint ? h("div", { class: "hint" }, hint) : null);
  const status = h("div", {});
  const form = h("form", { on: { submit: async (e) => {
    e.preventDefault();
    const val = (id) => form.querySelector(`#${id}`).value.trim();
    GH.saveConfig({ owner: val("gh-owner"), repo: val("gh-repo"), branch: val("gh-branch") || "main", token: val("gh-token") || c.token });
    status.replaceChildren(h("div", { class: "notice" }, "Testing connection…"));
    try {
      const name = await GH.testConnection();
      status.replaceChildren(h("div", { class: "notice good" }, `✓ Connected to ${name}. You can now research tickers from the home page.`));
      loadAll().catch(() => {});
    } catch (err) { status.replaceChildren(h("div", { class: "notice bad" }, `✕ ${err.message}`)); }
  } } },
    f("gh-owner", "GitHub username", c.owner),
    f("gh-repo", "Repository name", c.repo),
    f("gh-branch", "Branch", c.branch),
    f("gh-token", "Access token", "", { type: "password", placeholder: c.token ? "•••••••• saved (leave blank to keep)" : "github_pat_…" }, "Stored only in this browser. Never sent anywhere except GitHub."),
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
      h("button", { class: "btn primary", type: "submit" }, "Save & test"),
      c.token ? h("button", { class: "btn danger", type: "button", on: { click: () => { GH.clearToken(); route(); } } }, "Forget token") : null),
    status);

  view.append(h("div", { class: "home-hero" }, h("h1", {}, "Settings")),
    h("div", { class: "cols" },
      h("div", { class: "stack" },
        card("Appearance", {}, themeSeg),
        card("Connect to GitHub", { sub: "Needed only for researching new tickers and refreshing from here" }, form),
        GH.connected() ? card("Refresh data now", { sub: "Data updates automatically each weekday after the market closes" },
          h("button", { class: "btn", type: "button", on: { click: () => startTask({ action: "refresh", title: "Refreshing all tickers" }) } }, "Refresh everything")) : null),
      card("How to create the token", { sub: "One-time, about 2 minutes" },
        h("ol", { class: "steps" },
          h("li", {}, "On GitHub, go to ", h("b", {}, "Settings → Developer settings → Personal access tokens → Fine-grained tokens"), ", then ", h("b", {}, "Generate new token"), "."),
          h("li", {}, "Name it something like 'Tickerbook' and pick an expiration (90 days is a good balance)."),
          h("li", {}, "Under ", h("b", {}, "Repository access"), " choose ", h("b", {}, "Only select repositories"), " and pick this dashboard's repo."),
          h("li", {}, "Under ", h("b", {}, "Permissions → Repository"), ", set ", h("b", {}, "Actions: Read and write"), " and ", h("b", {}, "Contents: Read-only"), ". Nothing else."),
          h("li", {}, "Generate, copy the token, and paste it here. Repeat on each device you use (phone, laptop).")),
        h("p", { class: "muted small", style: "margin:10px 0 0" }, "That token can only start this repo's data update and read its files. It can't change your code or touch other repos."))));
}

// ================================================================ sheets
let sheetEl = null;
function openSheet(build, { onClose } = {}) {
  closeSheet();
  const backdrop = h("div", { class: "backdrop", on: { click: () => closeSheet() } });
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, h("div", { class: "grab", "aria-hidden": "true" }));
  build(sheet);
  overlay.append(backdrop, sheet);
  sheetEl = { backdrop, sheet, onClose, prevFocus: document.activeElement };
  requestAnimationFrame(() => { backdrop.classList.add("show"); sheet.classList.add("show"); (sheet.querySelector("input,button:not(.close)") || sheet).focus?.(); });
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  if (!sheetEl) return;
  const { backdrop, sheet, onClose, prevFocus } = sheetEl;
  sheetEl = null;
  backdrop.classList.remove("show"); sheet.classList.remove("show");
  setTimeout(() => { backdrop.remove(); sheet.remove(); }, 250);
  document.body.style.overflow = "";
  onClose?.();
  prevFocus?.focus?.();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
const sheetHead = (title) => h("div", { class: "sheet-head" }, h("h2", {}, title), h("button", { class: "icon-btn close", type: "button", "aria-label": "Close", on: { click: closeSheet } }, "✕"));

function openTerm(key) {
  const g = GLOSSARY[key];
  openSheet((s) => s.append(sheetHead(g.term),
    h("p", { style: "font-size:16px;font-weight:550" }, g.short),
    h("p", { class: "ink2" }, g.what),
    h("h4", {}, "Why it matters"), h("p", { class: "ink2" }, g.why),
    ...(g.rule ? [h("h4", {}, "Rule of thumb"), h("p", { class: "ink2" }, g.rule)] : []), judgeBox(key),
    h("a", { class: "small", href: `#/learn/g-${key}`, on: { click: closeSheet } }, "See all terms ›")));
}

// ---------------------------------------------------------------- research + tasks
function openResearch(prefill = "") {
  if (state.task?.running) return openTaskSheet();
  let tag = "researching";
  openSheet((s) => {
    const input = h("input", { id: "r-ticker", value: prefill, placeholder: "e.g. NVDA", autocapitalize: "characters", autocomplete: "off", spellcheck: "false", maxlength: 15,
      style: "text-transform:uppercase;font-weight:650;letter-spacing:.03em" });
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Tag" },
      ["researching", "watching", "owned"].map((t) => h("button", { type: "button", "aria-pressed": String(t === tag),
        on: { click: (e) => { tag = t; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } } }, t[0].toUpperCase() + t.slice(1))));
    const err = h("div", {});
    const form = h("form", { on: { submit: (e) => {
      e.preventDefault();
      const t = input.value.trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9.\-=^]{0,14}$/.test(t)) { err.replaceChildren(h("div", { class: "notice bad", style: "margin-bottom:12px" }, "That doesn't look like a ticker symbol.")); return; }
      startTask({ action: "add", ticker: t, tag, title: `Researching ${t}` });
    } } },
      h("div", { class: "field" }, h("label", { for: "r-ticker" }, "Ticker symbol"), input, h("div", { class: "hint" }, "US tickers work best. Takes about a minute.")),
      h("div", { class: "field" }, h("label", {}, "Add it as"), seg),
      err,
      h("button", { class: "btn primary block", type: "submit" }, "Start research"));
    s.append(sheetHead("Research a ticker"), form);
  });
}

function openTickerMenu(d) {
  const cur = state.index.tickers.find((t) => t.symbol === d.symbol)?.tag;
  openSheet((s) => s.append(sheetHead(d.symbol),
    h("h4", {}, "Tag"),
    h("div", { class: "seg", role: "group" }, ["owned", "watching", "researching"].map((t) =>
      h("button", { type: "button", "aria-pressed": String(t === cur), on: { click: () => { if (t !== cur) startTask({ action: "tag", ticker: d.symbol, tag: t, title: `Tagging ${d.symbol} as ${t}` }); } } }, t[0].toUpperCase() + t.slice(1)))),
    h("h4", {}, "Data"),
    h("button", { class: "btn block", type: "button", on: { click: () => startTask({ action: "add", ticker: d.symbol, tag: cur, title: `Refreshing ${d.symbol}` }) } }, `Refresh ${d.symbol} now`),
    h("div", { style: "height:8px" }),
    h("button", { class: "btn block danger", type: "button", on: { click: (e) => {
      if (e.currentTarget.dataset.confirm) startTask({ action: "remove", ticker: d.symbol, title: `Removing ${d.symbol}` });
      else { e.currentTarget.dataset.confirm = "1"; e.currentTarget.textContent = `Tap again to remove ${d.symbol}`; }
    } } }, "Remove from watchlist")));
}

function startTask({ action, ticker = "", tag = "researching", title }) {
  const task = state.task = { action, ticker, tag, title, running: true, progress: null, result: null, error: null, listeners: new Set() };
  const notify = () => task.listeners.forEach((fn) => fn());
  openTaskSheet();
  GH.runUpdate({ action, ticker, tag }, (p) => { task.progress = p; notify(); })
    .then(async (res) => {
      task.result = res;
      if (res.ok) {
        try { await loadAll(); } catch (e) { console.warn(e); }
      }
    })
    .catch((e) => { task.error = e.message; })
    .finally(() => {
      task.running = false; notify(); updatePill();
      if (!sheetEl && task.result?.ok) { route(); }
    });
  updatePill();
}

function openTaskSheet() {
  const task = state.task;
  if (!task) return;
  let renderRef = null;
  openSheet((s) => {
    const head = sheetHead(task.title);
    const bar = h("div", {}), meta = h("div", { class: "progress-meta" }), stages = h("ul", { class: "stage-list" }), foot = h("div", { style: "margin-top:16px" });
    const prog = h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100 }, bar);
    s.append(head, prog, meta, stages, foot);
    const render = () => {
      const p = task.progress || { percent: 0, stageIndex: 0, elapsed: 0 };
      const pctv = task.result || task.error ? 100 : Math.round(p.percent);
      bar.style.width = `${pctv}%`;
      if (task.error) bar.style.background = "var(--bad)";
      prog.setAttribute("aria-valuenow", pctv);
      meta.replaceChildren(h("span", {}, task.error ? "Stopped" : task.result ? (task.result.ok ? "Done" : "Finished with a problem") : p.stage?.label || "Starting…"), h("span", {}, `${pctv}% · ${Math.round(p.elapsed || 0)}s`));
      stages.replaceChildren(...GH.STAGES.map((st, i) => {
        const done = task.result ? true : i < p.stageIndex;
        const now = !done && i === p.stageIndex && !task.error;
        return h("li", { class: done ? "done" : now ? "now" : "" }, h("span", { class: "dot", "aria-hidden": "true" }, done ? "✓" : ""), st.label);
      }));
      foot.replaceChildren();
      if (task.error) {
        foot.append(h("div", { class: "notice bad" }, task.error),
          h("div", { style: "display:flex;gap:8px;margin-top:12px;flex-wrap:wrap" },
            h("button", { class: "btn primary", type: "button", on: { click: () => startTask(task) } }, "Try again"),
            p.runUrl ? h("a", { class: "btn", href: p.runUrl, target: "_blank", rel: "noopener noreferrer" }, "Open on GitHub") : null));
      } else if (task.result) {
        const ok = task.result.ok;
        foot.append(h("div", { class: `notice ${ok ? "good" : "bad"}` }, `${ok ? "✓" : "✕"} ${task.result.message}`));
        const btns = h("div", { style: "display:flex;gap:8px;margin-top:12px;flex-wrap:wrap" });
        if (ok && task.ticker && task.action !== "remove" && state.data[task.ticker]) btns.append(h("a", { class: "btn primary", href: `#/t/${task.ticker}`, on: { click: closeSheet } }, `Open ${task.ticker}`));
        else btns.append(h("button", { class: "btn primary", type: "button", on: { click: () => { closeSheet(); if (task.action === "remove") location.hash = "#/"; else route(); } } }, "Done"));
        if (!ok && task.action === "add") btns.append(h("button", { class: "btn", type: "button", on: { click: () => openResearch() } }, "Try another ticker"));
        foot.append(btns);
      } else {
        foot.append(h("p", { class: "muted small", style: "margin:0" }, "You can close this; it keeps going in the background. ",
          p.runUrl ? h("a", { href: p.runUrl, target: "_blank", rel: "noopener noreferrer" }, "Watch it on GitHub ›") : null));
      }
    };
    render();
    renderRef = render;
    task.listeners.add(render);
  }, { onClose: () => { task.listeners.delete(renderRef); updatePill(); if (!task.running && task.result?.ok) route(); } });
}

let pillEl = null;
function updatePill() {
  const t = state.task;
  const show = t && t.running && !sheetEl;
  if (!show) { pillEl?.remove(); pillEl = null; return; }
  if (!pillEl) {
    pillEl = h("button", { class: "task-pill", type: "button", on: { click: openTaskSheet } });
    document.body.append(pillEl);
    t.listeners.add(() => updatePill());
  }
  const p = Math.round(t.progress?.percent || 0);
  pillEl.replaceChildren(h("span", {}, `${t.title}…`), h("span", { class: "mini" }, h("div", { style: `width:${p}%` })), h("span", { class: "tnum" }, `${p}%`));
}

// ================================================================ hover popovers (laptop)
// On devices with a mouse, hovering a jargon term (or a signal row) shows its explanation.
// Tapping still opens the full bottom sheet, so touch devices are unaffected.
const canHover = matchMedia("(hover: hover) and (pointer: fine)");
let pop = null, popFor = null, popTimer = null;
function buildPop(target) {
  const n = h("div", { class: "pop", role: "tooltip" });
  const key = target.dataset.term;
  if (key && GLOSSARY[key]) {
    const g = GLOSSARY[key];
    n.append(h("div", { class: "pop-title" }, g.term), h("p", { class: "pop-short" }, g.short), h("p", {}, g.what),
      h("p", {}, h("b", {}, "Why it matters: "), g.why), g.rule ? h("p", {}, h("b", {}, "Rule of thumb: "), g.rule) : null,
      judgeBox(key), h("div", { class: "pop-foot" }, "Click for more"));
  } else if (target.dataset.tip) {
    if (target.dataset.tipTitle) n.append(h("div", { class: "pop-title" }, target.dataset.tipTitle));
    n.append(h("p", {}, target.dataset.tip));
  } else return null;
  return n;
}
function judgeBox(key) {
  const j = CUR && GLOSSARY[key]?.rule ? A.judge(key, CUR) : null;
  return j ? h("div", { class: `judge ${j.tone}` }, thumb(j.tone), h("div", {}, h("b", {}, `${CUR.symbol}: ${j.value}`), h("div", {}, j.text))) : null;
}
function showPop(target) {
  hidePop(true);
  const n = buildPop(target);
  if (!n) return;
  document.body.append(n);
  const r = target.getBoundingClientRect(), pw = n.offsetWidth, ph = n.offsetHeight;
  let left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), innerWidth - pw - 8);
  let top = r.bottom + 8;
  if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 8);
  n.style.left = `${left}px`; n.style.top = `${top}px`;
  n.addEventListener("mouseenter", () => clearTimeout(popTimer));
  n.addEventListener("mouseleave", () => hidePop());
  pop = n; popFor = target;
}
function hidePop(now) {
  clearTimeout(popTimer);
  const kill = () => { pop?.remove(); pop = null; popFor = null; };
  if (now) kill(); else popTimer = setTimeout(kill, 140);
}
document.addEventListener("mouseover", (e) => {
  if (!canHover.matches) return;
  const t = e.target.closest?.("[data-term],[data-tip]");
  if (!t) return;
  if (t === popFor) { clearTimeout(popTimer); return; }
  clearTimeout(popTimer);
  popTimer = setTimeout(() => showPop(t), 160);
});
document.addEventListener("mouseout", (e) => {
  const t = e.target.closest?.("[data-term],[data-tip]");
  if (t && !t.contains(e.relatedTarget)) { if (t === popFor) hidePop(); else clearTimeout(popTimer); }
});
document.addEventListener("click", () => hidePop(true), true);
addEventListener("scroll", () => hidePop(true), { passive: true, capture: true });

// ================================================================ one-screen layout (laptop)
// On wide + tall-enough screens each tab becomes a fixed-height grid that fits the window;
// long lists scroll inside their own card instead of the page growing.
const dashMQ = matchMedia("(min-width: 1100px) and (min-height: 600px)");
function applyDashMode() { document.documentElement.classList.toggle("dash-on", dashMQ.matches); }
function fitDash() {
  if (!dashMQ.matches) { document.querySelectorAll(".dash").forEach((el) => { el.style.minHeight = ""; el.style.removeProperty("--dash-h"); }); return; }
  document.querySelectorAll(".dash:not(.dash-flow)").forEach((el) => {
    const top = el.getBoundingClientRect().top + scrollY;
    const hgt = Math.max(520, innerHeight - top - 14);
    el.style.minHeight = `${hgt}px`;
    el.style.setProperty("--dash-h", `${hgt}px`);
  });
}
applyDashMode();
dashMQ.addEventListener("change", () => { applyDashMode(); route(); });
addEventListener("resize", () => requestAnimationFrame(fitDash));

// ================================================================ boot
(async () => {
  try {
    await loadAll();
    route();
  } catch (e) {
    view.replaceChildren(h("div", { class: "loading" },
      h("div", {}, "Couldn't load data."),
      h("div", { class: "small" }, e.message),
      h("div", { class: "small" }, "If you just set this up, run the 'Update data and deploy' workflow once from the Actions tab on GitHub.")));
  }
})();
