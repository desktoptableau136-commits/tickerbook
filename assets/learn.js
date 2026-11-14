// Learn page (glossary).
import { GLOSSARY, EARNINGS_GUIDE } from "./glossary.js";
import { card, grid, h, thumb, view } from "./core.js";
import { examplesBox } from "./sheets.js";

// ================================================================ learn
export function renderLearn(anchor) {
  const search = h("input", { type: "search", placeholder: "Search terms (e.g. P/E, free cash flow)", "aria-label": "Search glossary" });
  const list = h("div", {});
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren(...Object.entries(GLOSSARY)
      .filter(([, g]) => !q || `${g.term} ${g.short} ${g.what}`.toLowerCase().includes(q))
      .sort((a, b) => a[1].term.localeCompare(b[1].term))
      .map(([k, g]) => {
        const body = h("div", { class: "body" }, h("p", {}, g.what), h("p", {}, h("b", {}, "Why it matters: "), g.why), g.rule ? h("p", {}, h("b", {}, "Rule of thumb: "), g.rule) : null);
        let built = false;
        return h("details", { class: "gl-item", id: `g-${k}`, on: { toggle: (e) => { if (e.target.open && !built) { built = true; const ex = examplesBox(k); if (ex) body.append(ex); } } } },
          h("summary", {}, h("span", {}, g.term, h("span", { class: "gl-short" }, g.short))), body);
      }));
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
