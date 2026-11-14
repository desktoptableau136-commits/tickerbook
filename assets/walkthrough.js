// Walkthrough tab: one slide per card, moved in from the other tabs.
import * as A from "./analysis.js";
import { card, h, pill, pref, rich, signalsFor, state } from "./core.js";
import { sheetEl } from "./sheets.js";
import { EQUITY_TABS, FUND_TABS, TAB_FN } from "./ticker.js";

let walkKey = null; // ← / → while the Walkthrough is on screen
export function tabWalk(d, body) {
  const steps0 = A.walkSteps(d, { signals: signalsFor(d), bench: state.bench });
  const pool = {};
  const panelFor = (s) => {
    if (!s.tab || !s.area) return null;
    if (!(s.tab in pool)) { const b = h("div", {}); try { TAB_FN[s.tab](d, b); } catch (e) { console.warn(e); } pool[s.tab] = b; }
    return [...pool[s.tab].querySelectorAll("section.card")].find((c) => c.style.getPropertyValue("--area").trim() === s.area) || null;
  };
  const steps = steps0.map((s) => ({ ...s, panel: panelFor(s) })).filter((s) => s.panel || s.says.length || s.recap);
  const tabName = Object.fromEntries([...EQUITY_TABS, ...FUND_TABS]);
  const key = `walk.${d.symbol}`;
  let i = Math.min(Math.max(0, +pref(key) || 0), steps.length - 1);

  const count = h("span", { class: "walk-count small muted tnum", "aria-live": "polite" });
  const back = h("button", { class: "btn sm", type: "button", on: { click: () => go(i - 1) } }, "‹ Back");
  const next = h("button", { class: "btn sm primary", type: "button", on: { click: () => go(i + 1) } }, "Next ›");
  const dots = h("div", { class: "walk-dots" }, steps.map((s, k) => h("button", { type: "button", class: "walk-dot", title: s.title, "aria-label": `Step ${k + 1}: ${s.title}`, on: { click: () => go(k) } })));
  const slide = h("div", { class: "walk-slide" });
  const top = h("div", { class: "walk-top" }, back, h("div", { class: "walk-mid" }, count, dots), next);
  body.append(h("div", { class: "walk" }, top, slide));

  const recap = (s) => h("div", { class: "walk-recap" },
    s.recap.map((r) => h("button", { type: "button", class: "walk-recap-row", on: { click: () => go(steps.findIndex((x) => x.id === r.id)) } },
      h("span", {}, r.title), pill(r.tone, r.word))),
    h("p", { class: "small muted", style: "margin:10px 0 0" }, "Tap a row to go back to that slide."));

  function go(k) {
    if (k < 0 || k >= steps.length) return;
    const moved = k !== i;
    i = k; pref(key, String(i));
    const s = steps[i];
    count.textContent = `Step ${i + 1} of ${steps.length}`;
    back.disabled = i === 0;
    next.disabled = i === steps.length - 1;
    dots.querySelectorAll("button").forEach((b, n) => { b.classList.toggle("on", n === i); b.classList.toggle("seen", n < i); b.setAttribute("aria-current", n === i ? "step" : "false"); });
    const after = steps[i + 1];
    slide.classList.toggle("no-panel", !s.panel);
    slide.replaceChildren(
      h("div", { class: "walk-text card" },
        h("div", { class: "walk-head" }, h("h2", {}, s.title), s.tone && s.tone !== "na" && s.word ? pill(s.tone, s.word) : null),
        h("h3", { class: "walk-k" }, "What this is"),
        h("p", { class: "ink2" }, s.what),
        s.says.length ? [h("h3", { class: "walk-k" }, `What it says for ${A.shortName(d)}`), s.says.map((t) => h("p", {}, rich(t)))] : null,
        s.recap ? recap(s) : null,
        h("div", { class: "walk-foot" },
          s.tab ? h("a", { class: "small", href: `#/t/${d.symbol}/${s.tab}` }, `See it on the ${tabName[s.tab]} tab ›`) : null,
          after ? h("button", { class: "btn sm primary", type: "button", on: { click: () => go(i + 1) } }, `Next: ${after.title} ›`)
            : h("button", { class: "btn sm", type: "button", on: { click: () => go(0) } }, "Start over"))),
      ...(s.panel ? [h("div", { class: "walk-panel" }, s.panel)] : []));
    if (moved && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start" });
  }
  walkKey = (e) => {
    if (!body.isConnected) { walkKey = null; return; }
    if (e.key === "ArrowRight") go(i + 1); else if (e.key === "ArrowLeft") go(i - 1);
  };
  go(i);
}
document.addEventListener("keydown", (e) => {
  if (!walkKey || e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.("input, textarea, select, [contenteditable]") || sheetEl) return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") walkKey(e);
});
