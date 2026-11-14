// Ideas page: companies worth a look, and the idea preview sheet.
import * as A from "./analysis.js";
import * as GH from "./github.js";
import { GLOSSARY } from "./glossary.js";
import { card, grid, h, isNum, logo, pill, pref, rich, signalsFor, state, tickers, view } from "./core.js";
import { startTask } from "./research.js";
import { route } from "./router.js";
import { closeSheet, openSheet, openTerm, sheetHead } from "./sheets.js";
import { fmtPts, signalMath } from "./summary.js";
import { scoreRing, toneClass } from "./ticker.js";

// ================================================================ ideas
// data/_ideas.json: industry peers of the watchlist ("neighbors") plus a broad screen with readable
// rules (fetch.py build_ideas). Each idea gets the same checks as the watchlist on the numbers it
// has (A.ideaData), so the score is a quick tally, not the full one. Hidden ideas and which ones
// you've already seen stay in this browser.
const IDEAS_SHOW = 12;
const jsonPref = (k, dflt) => { try { return JSON.parse(pref(k) || "null") ?? dflt; } catch { return dflt; } };
export const ideasHidden = () => new Set(jsonPref("ideasHidden", []));
function ideasHide(sym, hide) {
  const s = ideasHidden();
  if (hide) s.add(sym); else s.delete(sym);
  pref("ideasHidden", JSON.stringify([...s]));
}
// Every idea not on the watchlist, scored, best first. `via`: the first watchlist ticker it neighbors.
export function ideaList() {
  const on = new Set((state.index?.tickers || []).map((t) => t.symbol));
  return (state.ideas?.list || []).filter((x) => !on.has(x.symbol)).map((x) => {
    const via = x.via?.map((s) => state.data[s]).find(Boolean) || null;
    const sig = A.equitySignals(A.ideaData(x, via));
    return { x, via, sig, ov: A.overall(sig) };
  }).sort((a, b) => (b.ov.score ?? -1) - (a.ov.score ?? -1) || (b.x.marketCap ?? 0) - (a.x.marketCap ?? 0));
}
// New since the Ideas page was last opened (nothing counts as new before the first visit).
export function ideasNew(list) {
  const seen = jsonPref("ideasSeen", null);
  return seen ? new Set(list.map((i) => i.x.symbol).filter((s) => !seen.includes(s))) : new Set();
}
const ideaSource = (i) => [i.x.sources.includes("neighbor") ? `Neighbor of ${i.x.via.join(", ")}` : null, i.x.sources.includes("screen") ? "Broad screen" : null].filter(Boolean).join(" · ");
const quickTip = (ov) => `${ov.lean}: ${ov.good} of ${ov.total} checks positive${ov.bad ? `, ${ov.bad} negative` : ""}. A quick score: the same 8 checks as your watchlist, but ${A.IDEA_UNKNOWN} need a full research fetch, so they count as neutral (half points) for now.`;

function researchBtn(sym, cls = "btn sm primary") {
  return GH.connected()
    ? h("button", { class: cls, type: "button", on: { click: () => startTask({ action: "add", ticker: sym, tag: "researching", title: `Researching ${sym}` }) } }, "Research")
    : h("a", { class: cls.replace("primary", ""), href: "#/settings", "data-tip": "Connect GitHub once in Settings to add tickers from here." }, "Research");
}

function ideaCard(i, isNew, hidden) {
  const { x, ov } = i;
  return h("section", { class: `card icard${toneClass(ov)}` },
    h("div", { class: "tcard-head" },
      logo(x.symbol, x.name),
      h("div", { class: "grow" },
        h("div", { class: "tcard-top" }, h("span", { class: "tcard-sym" }, x.symbol),
          isNew ? h("span", { class: "new-badge" }, "new") : null,
          h("span", { class: "muted small" }, ideaSource(i))),
        h("div", { class: "tcard-name" }, x.name)),
      h("span", { class: "has-tip", "data-tip": quickTip(ov), "data-tip-title": ov.score != null ? `Quick score ${ov.score}` : "No score" }, scoreRing(ov, 40, 4, "mini"))),
    h("p", { class: "icard-why small" }, rich(A.ideaWhy(x, i.via))),
    h("div", { class: "tcard-foot" }, pill(ov.tone, ov.short),
      h("div", { class: "icard-btns" },
        h("button", { class: "btn sm", type: "button", on: { click: () => openIdea(i) } }, "Preview"),
        hidden ? null : researchBtn(x.symbol),
        h("button", { class: "btn sm", type: "button", "aria-label": `${hidden ? "Unhide" : "Hide"} ${x.symbol}`,
          on: { click: () => { ideasHide(x.symbol, !hidden); route(); } } }, hidden ? "Unhide" : "Hide"))));
}

export function renderIdeas() {
  const all = ideaList(), hidden = ideasHidden(), fresh = ideasNew(all);
  if (!["all", "neighbor", "screen"].includes(state.ideaFilter)) state.ideaFilter = "all";
  const visible = all.filter((i) => !hidden.has(i.x.symbol));
  const counts = { all: visible.length, neighbor: visible.filter((i) => i.x.sources.includes("neighbor")).length, screen: visible.filter((i) => i.x.sources.includes("screen")).length };
  const shown = state.ideaFilter === "all" ? visible : visible.filter((i) => i.x.sources.includes(state.ideaFilter));
  const sc = state.ideas?.screen || {};

  view.append(h("div", { class: "home-hero" }, h("div", {},
    h("h1", {}, "Ideas to look into"),
    h("div", { class: "muted small" }, state.ideas ? `Companies that pass the same checklist your watchlist uses · updated ${A.ago(state.ideas.updated)}` : "No ideas yet"))));
  if (!state.ideas) {
    view.append(card(null, {}, h("p", { class: "empty" }, "The idea list is built by the daily data update. It will show up after the next one.")));
    return;
  }

  const how = h("details", { class: "card ideas-how", ...(pref("ideasHowOpen") === "1" ? { open: true } : {}), on: { toggle: (e) => pref("ideasHowOpen", e.currentTarget.open ? "1" : "0") } },
    h("summary", {}, h("b", {}, "How this list is made"), h("span", { class: "muted small" }, "Where ideas come from, and what the quick score leaves out")),
    h("div", { class: "ideas-how-body" },
      h("div", {}, h("h4", {}, "Neighbors"),
        h("p", { class: "small ink2" }, "The biggest companies in the same industry as each ticker on your watchlist (the ones on its Peers tab). The note on each card compares it with that ticker: where it's better and where it's worse.")),
      h("div", {}, h("h4", {}, "Broad screen"),
        h("p", { class: "small ink2" }, `Every US-listed company that passes all of these rules${isNum(sc.total) ? ` (${sc.total} did at the last update)` : ""}; the ${sc.max ?? 40} largest by market value are kept:`),
        h("ul", { class: "small ink2 ideas-rules" }, (sc.rules || []).map((r) => h("li", {}, r))),
        sc.ok === false ? h("p", { class: "notice bad small" }, "Yahoo's screen didn't answer in the last update, so these are the previous results.") : null),
      h("div", {}, h("h4", {}, "The quick score"),
        h("p", { class: "small ink2" }, `The same 8 checks and weights as your watchlist. Without a full data fetch there's no data for ${A.IDEA_UNKNOWN}, so those count as neutral, half their points: a company can't score high on its best-looking checks alone. So it's a first filter. Research a company to get the full score.`),
        h("p", { class: "small ink2" }, "Every company is held to the same rules; nothing is added or left out by name. Screens like this favor companies whose recent numbers look good, and recent numbers don't predict the future."))));

  const chips = h("div", { class: "chips", role: "group", "aria-label": "Filter by source" },
    [["all", "All"], ["neighbor", "Neighbors"], ["screen", "Broad screen"]].map(([f, l]) =>
      h("button", { class: "chip", type: "button", "aria-pressed": String(state.ideaFilter === f), on: { click: () => { state.ideaFilter = f; pref("ideaFilter", f); route(); } } }, `${l} · ${counts[f]}`)));

  const list = h("div", { class: "grid ideas-grid", style: "margin-top:12px" }, shown.map((i) => ideaCard(i, fresh.has(i.x.symbol), false)));
  if (!shown.length) list.append(h("div", { class: "empty card" }, "Nothing here right now."));
  view.append(how, h("div", { class: "home-bar", style: "margin-top:14px" }, chips), list);
  if (shown.length > IDEAS_SHOW) {
    [...list.children].slice(IDEAS_SHOW).forEach((c) => c.classList.add("extra"));
    const label = `Show all ${shown.length}`;
    const btn = h("button", { class: "btn block", type: "button", style: "margin-top:12px",
      on: { click: () => { list.classList.toggle("all"); btn.textContent = list.classList.contains("all") ? "Show fewer" : label; } } }, label);
    view.append(btn);
  }
  const hid = all.filter((i) => hidden.has(i.x.symbol));
  if (hid.length) {
    view.append(h("details", { class: "card arch-panel", style: "margin-top:16px" },
      h("summary", {}, h("b", {}, `Hidden · ${hid.length}`), h("span", { class: "muted small" }, "Saved in this browser only")),
      h("div", { class: "grid", style: "margin-top:10px" }, hid.map((i) => ideaCard(i, false, true)))));
  }
  view.append(h("p", { class: "disclaimer" }, "A starting point for research, not a recommendation. Not financial advice. Data from Yahoo Finance, may be delayed or incomplete."));
  pref("ideasSeen", JSON.stringify(all.map((i) => i.x.symbol)));
}

function openIdea(i) {
  const { x, sig, ov } = i;
  const row = (s) => h("details", { class: "signal" },
    h("summary", {}, h("span", { class: "lbl" }, s.label), h("span", { class: "val" }, s.value), pill(s.status, s.word)),
    h("div", { class: "body" }, h("p", {}, s.text), signalMath(s, ov), s.term ? h("button", { class: "linkish small", type: "button", on: { click: () => openTerm(s.term) } }, `What's ${GLOSSARY[s.term].term}?`) : null));
  const facts = [x.industry, isNum(x.marketCap) ? `worth ${A.money(x.marketCap)}` : null, isNum(x.price) ? `${A.price(x.price)} a share` : null].filter(Boolean).join(" · ");
  // wide on laptops: the story and score on the left, the checks on the right, so it fits without much scrolling
  openSheet((s) => s.append(sheetHead(`${x.symbol} · ${x.name}`), h("div", { class: "idea-sheet" }, h("div", {},
    h("p", { class: "muted small", style: "margin-top:0" }, facts),
    h("p", { class: "small" }, rich(A.ideaWhy(x, i.via))),
    x.about ? h("div", {}, h("h4", {}, "What it does"), h("p", { class: "ink2 small" }, x.about), h("p", { class: "muted small" }, "Yahoo Finance's company description, shortened.")) : "",
    h("h4", {}, "Quick score"),
    h("div", { class: "idea-score" }, scoreRing(ov, 64, 7),
      h("div", {}, h("b", {}, ov.lean), ov.score != null ? h("div", { class: "muted small tnum" }, `${fmtPts(ov.earned)} of ${fmtPts(ov.possible)} points = ${ov.score}`) : null,
        h("p", { class: "muted small", style: "margin:4px 0 0" }, `The same 8 checks as your watchlist, but ${A.IDEA_UNKNOWN} count as neutral until you research it.`))),
    i.via ? (() => {
      // quick scores run higher than full ones (the missing checks are often the hard ones), so compare like with like
      const q = A.overall(A.quickSignals(i.via)), full = A.overall(signalsFor(i.via));
      return q.score != null ? h("p", { class: "small ink2" }, rich(`For comparison, ${i.via.symbol} scores **${q.score}** on this same quick check (${full.score ?? "—"} on its full one).`)) : null;
    })() : null),
    h("div", { class: "signals one" }, sig.map(row))),
    h("div", { class: "idea-actions" }, researchBtn(x.symbol, "btn primary"),
      h("button", { class: "btn", type: "button", on: { click: () => { ideasHide(x.symbol, true); closeSheet(); route(); } } }, "Hide")),
    h("p", { class: "disclaimer" }, "A starting point for research, not a recommendation. Not financial advice.")), { cls: "wide" });
}
