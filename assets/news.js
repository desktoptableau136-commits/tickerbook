// News tab.
import * as A from "./analysis.js";
import { card, grid, h, pill } from "./core.js";

// ---------------------------------------------------------------- news
export function tabNews(d, body) {
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
