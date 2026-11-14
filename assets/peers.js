// Peers tab.
import * as A from "./analysis.js";
import { GLOSSARY } from "./glossary.js";
import { legend } from "./charts.js";
import { card, grid, h, isNum, pill, rich, state } from "./core.js";
import { openTerm } from "./sheets.js";

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

export function tabPeers(d, body) {
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
