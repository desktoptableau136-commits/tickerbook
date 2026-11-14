// Bottom sheets, glossary sheets, and hover popovers on laptops.
import * as A from "./analysis.js";
import { GLOSSARY } from "./glossary.js";
import { CUR, TONE_WORD, h, overlay, thumb, tickers } from "./core.js";

// ================================================================ sheets
export let sheetEl = null;
export function openSheet(build, { onClose, cls = "" } = {}) {
  closeSheet();
  const backdrop = h("div", { class: "backdrop", on: { click: () => closeSheet() } });
  const sheet = h("div", { class: `sheet ${cls}`.trim(), role: "dialog", "aria-modal": "true" }, h("div", { class: "grab", "aria-hidden": "true" }));
  build(sheet);
  overlay.append(backdrop, sheet);
  sheetEl = { backdrop, sheet, onClose, prevFocus: document.activeElement };
  requestAnimationFrame(() => { backdrop.classList.add("show"); sheet.classList.add("show"); (sheet.querySelector("input,button:not(.close)") || sheet).focus?.(); });
  document.body.style.overflow = "hidden";
}
export function closeSheet() {
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
export const sheetHead = (title) => h("div", { class: "sheet-head" }, h("h2", {}, title), h("button", { class: "icon-btn close", type: "button", "aria-label": "Close", on: { click: closeSheet } }, "✕"));

export function openTerm(key) {
  const g = GLOSSARY[key];
  openSheet((s) => s.append(sheetHead(g.term),
    h("p", { style: "font-size:16px;font-weight:550" }, g.short),
    h("p", { class: "ink2" }, g.what),
    h("h4", {}, "Why it matters"), h("p", { class: "ink2" }, g.why),
    ...(g.rule ? [h("h4", {}, "Rule of thumb"), h("p", { class: "ink2" }, g.rule)] : []), judgeBox(key) || "",
    examplesBox(key, CUR?.symbol) || "",
    h("a", { class: "small", href: `#/learn/g-${key}`, on: { click: closeSheet } }, "See all terms ›")));
}

// How every active ticker on the watchlist reads on this term: best to worst by the rule of thumb,
// or highest first for numbers that have no good or bad level on their own.
export function examplesBox(key, curSym) {
  const rows = tickers().filter((t) => t.tag !== "archived")
    .map((t) => ({ sym: t.symbol, ex: A.example(key, t.d) })).filter((r) => r.ex && r.ex.value);
  if (rows.length < 2) return null;
  const rank = { good: 0, ok: 1, bad: 2 }, judged = !!rows[0].ex.tone;
  rows.sort((a, b) => (judged ? rank[a.ex.tone] - rank[b.ex.tone] : (b.ex.x ?? -Infinity) - (a.ex.x ?? -Infinity)));
  return h("div", { class: "wl-ex" },
    h("h4", {}, "On your watchlist"),
    h("ul", {}, rows.map(({ sym, ex }) => h("li", { class: sym === curSym ? "cur" : null },
      ex.tone ? [thumb(ex.tone), h("span", { class: "vh" }, `${TONE_WORD[ex.tone]}: `)] : h("span", { class: "wl-dot", "aria-hidden": "true" }),
      h("a", { href: `#/t/${sym}`, on: { click: closeSheet } }, sym),
      h("span", {}, h("b", { class: "tnum" }, ex.value), ex.text ? h("span", { class: "muted" }, ` · ${ex.text}`) : null)))),
    h("p", { class: "muted small" }, judged ? "Grouped by the rule of thumb above: passes, in between, then fails. Tickers without the data are left out."
      : "Highest first. There's no good or bad level for this number on its own; it's here for comparison."));
}

// ================================================================ hover popovers (laptop)
// On devices with a mouse, hovering a jargon term (or a signal row) shows its explanation.
// Tapping still opens the full bottom sheet, so touch devices are unaffected.
export const canHover = matchMedia("(hover: hover) and (pointer: fine)");
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
export function hidePop(now) {
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
