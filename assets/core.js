// Shared building blocks: DOM helper, cards, preferences, data loading, "since you last looked", logos, laptop layout.
import * as A from "./analysis.js";
import * as GH from "./github.js";
import { GLOSSARY } from "./glossary.js";
import { route } from "./router.js";
import { openTerm } from "./sheets.js";

// ================================================================ tiny DOM helper
// Untrusted strings (names, headlines, firm names) only ever go in as text nodes.
export function h(tag, props = {}, ...kids) {
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
export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const signClass = (v) => (isNum(v) ? (v >= 0 ? "up" : "down") : "");
export const arrow = (v) => (isNum(v) ? (v >= 0 ? "▲" : "▼") : "");
const ICON = { good: "✓", ok: "–", bad: "✕", na: "?" };

export function pill(status, word) {
  return h("span", { class: `pill ${status}` }, h("span", { class: "ic", "aria-hidden": "true", text: ICON[status] }), word);
}
// Our own generated sentences mark key phrases with **double stars**. Split them into <b>
// elements; every piece stays a text node, so company names etc. can never become HTML.
export function rich(text) {
  if (typeof text !== "string" || !text.includes("**")) return text;
  return text.split("**").map((t, i) => (i % 2 ? h("b", {}, t) : t));
}

// The ticker on screen, so jargon terms can show how it compares to their rule of thumb.
export let CUR = null;
export function setCur(d) { CUR = d; }
const THUMB = "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z";
export const TONE_WORD = { good: "passes the rule of thumb", ok: "in between", bad: "fails the rule of thumb" };
export function thumb(tone) {
  const w = h("span", { class: `thumb ${tone}`, "aria-hidden": "true" });
  if (tone === "ok") { w.textContent = "–"; return w; }
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"), path = document.createElementNS(NS, "path");
  svg.setAttribute("viewBox", "0 0 24 24"); path.setAttribute("d", THUMB); svg.append(path); w.append(svg);
  return w;
}
export function termBtn(key, label) {
  const g = GLOSSARY[key];
  if (!g) return document.createTextNode(label);
  const j = CUR && g.rule ? A.judge(key, CUR) : null;
  return h("button", { class: "term", type: "button", "data-term": key, on: { click: (e) => { e.preventDefault(); e.stopPropagation(); openTerm(key); } } },
    label ?? g.term, j ? [thumb(j.tone), h("span", { class: "vh" }, ` (${TONE_WORD[j.tone]})`)] : null);
}
export function qmark(key) {
  return h("button", { class: "qmark", type: "button", "data-term": key, "aria-label": `What is ${GLOSSARY[key]?.term}?`, on: { click: (e) => { e.preventDefault(); e.stopPropagation(); openTerm(key); } } }, "?");
}
export function tile(label, value, sub, key) {
  return h("div", { class: "tile" },
    h("div", { class: "k" }, key ? termBtn(key, label) : label),
    h("div", { class: "v tnum" }, value),
    sub ? h("div", { class: "s" }, sub) : null);
}
export function card(title, opts = {}, ...body) {
  return h("section", { class: `card ${opts.class || ""}`, style: opts.area ? `--area:${opts.area}` : null },
    title ? h("div", { class: "card-head" }, h("div", {}, h("h2", {}, title, opts.term ? qmark(opts.term) : null), opts.sub ? h("p", { class: "muted small" }, opts.sub) : null), opts.right || null) : null,
    h("div", { class: "card-body" }, ...body));
}

// ================================================================ preferences
export function pref(k, v) {
  try { if (v === undefined) return localStorage.getItem(`stockdash.${k}`); localStorage.setItem(`stockdash.${k}`, v); } catch { return null; }
}

// ================================================================ data
export const state = { index: null, data: {}, bench: null, ideas: null, logos: {}, filter: pref("filter") || "all", ideaFilter: pref("ideaFilter") || "all", source: "site", task: null };

export async function fetchJSON(path) {
  if (GH.connected()) {
    try { state.source = "repo"; return await GH.readRepoFile(path); }
    catch (e) { console.warn("Repo read failed, falling back to site copy:", e.message); state.source = "site"; }
  }
  const r = await fetch(`${path}?v=${Math.floor(Date.now() / 60000)}`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export async function loadAll() {
  state.index = await fetchJSON("data/index.json");
  const syms = state.index.tickers.map((t) => t.symbol);
  const results = await Promise.allSettled(syms.map((s) => fetchJSON(`data/${s}.json`)));
  results.forEach((r, i) => { if (r.status === "fulfilled") state.data[syms[i]] = r.value; });
  // { SPY: {dates, close}, QQQ: … }; an older file (the ^GSPC index, no dividends) is ignored
  try { state.bench = (await fetchJSON("data/_bench.json")).benches || null; } catch { state.bench = null; }
  try { state.ideas = await fetchJSON("data/_ideas.json"); } catch { state.ideas = null; }
  try { state.logos = await fetchJSON("data/logos/index.json"); } catch { state.logos = {}; }
}

export function tickers() {
  return (state.index?.tickers || []).map((t) => ({ ...t, d: state.data[t.symbol] })).filter((t) => t.d);
}
export function signalsFor(d) {
  return A.signalsOf(d, tickers().map((t) => t.symbol));
}

// ================================================================ since your last look
// A small fingerprint of each ticker is kept in this browser (never sent anywhere). Opening a
// ticker records the visit; what changed since the previous visit stays listed until dismissed.
function seenGet(sym) { try { return JSON.parse(pref(`seen.${sym}`) || "null"); } catch { return null; } }
function seenSet(sym, v) { pref(`seen.${sym}`, JSON.stringify(v)); }
const scoreOf = (d) => A.overall(signalsFor(d)).score;
// Changes in data you haven't opened yet (for the home cards).
export function unseenChanges(d) {
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
export function changesBanner(d) {
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

export const view = document.getElementById("view");
export const overlay = document.getElementById("overlay");
// ================================================================ logos + tag icons
// Logos are saved into the repo by the daily update (fetch.py update_logos), so the page only loads
// its own files. Without one, a letter tile stands in. Decorative: the symbol always sits beside it.
export function logo(sym, name, size = 32) {
  const L = state.logos?.[sym], style = `--logo:${size}px`;
  if (L?.ok && L.file) {
    const img = h("img", { src: `data/logos/${encodeURIComponent(L.file)}?v=${encodeURIComponent((L.checked || "").slice(0, 10))}`, alt: "", loading: "lazy", decoding: "async" });
    const tile = h("span", { class: "logo", style, "aria-hidden": "true" }, img);
    img.addEventListener("error", () => { tile.replaceWith(letterTile(sym, name, style)); }, { once: true });
    return tile;
  }
  return letterTile(sym, name, style);
}
function letterTile(sym, name, style) {
  const ch = (String(name || sym).replace(/^the\s+/i, "").match(/[A-Za-z0-9]/) || [sym[0]])[0].toUpperCase();
  return h("span", { class: "logo letter", style, "aria-hidden": "true" }, ch);
}
// Tags as small icons (eye = watching, magnifier = researching, box = archived), named on hover and
// for screen readers. The home filter chips show the same icons with the words, as the key.
const TAG_ICON = {
  watching: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  researching: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  archived: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
};
const TAG_TIP = { watching: "Watching: a company you follow", researching: "Researching: still deciding whether to follow it", archived: "Archived: paused, not refreshed" };
export function tagSvg(tag) {
  return h("span", { class: "tagic-svg", "aria-hidden": "true", html: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${TAG_ICON[tag] || ""}</svg>` });
}
export function tagIcon(tag) {
  if (!TAG_ICON[tag]) return null;
  const word = tag[0].toUpperCase() + tag.slice(1);
  return h("span", { class: `tagic ${tag}`, role: "img", "aria-label": word, "data-tip": TAG_TIP[tag], "data-tip-title": word }, tagSvg(tag));
}

export function showMore(list, show) {
  const rows = [...list.children];
  if (rows.length <= show) return null;
  rows.slice(show).forEach((r) => r.classList.add("extra"));
  const label = `Show all ${rows.length}`;
  const btn = h("button", { class: "linkish small", type: "button", style: "margin-top:8px",
    on: { click: () => { list.classList.toggle("all"); btn.textContent = list.classList.contains("all") ? "Show fewer" : label; fitDash(); } } }, label);
  return btn;
}

// A tab's grid. On laptops (html.dash-on) CSS turns it into a fixed-height, one-screen layout.
export const grid = (name, flow = false) => h("div", { class: `cols dash dash-${name}${flow ? " dash-flow" : ""}` });

// ================================================================ one-screen layout (laptop)
// On wide + tall-enough screens each tab becomes a fixed-height grid that fits the window;
// long lists scroll inside their own card instead of the page growing.
export const dashMQ = matchMedia("(min-width: 1100px) and (min-height: 600px)");
function applyDashMode() { document.documentElement.classList.toggle("dash-on", dashMQ.matches); }
export function fitDash() {
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
