// Summary tab: score ring, score over time, analyst strip, about.
import * as A from "./analysis.js";
import { GLOSSARY } from "./glossary.js";
import { lineChart, sparkline, legend } from "./charts.js";
import { card, fetchJSON, grid, h, isNum, pill, qmark, rich, signalsFor, state, tickers, tile } from "./core.js";
import { openSheet, openTerm, sheetHead } from "./sheets.js";
import { priceCard, scoreRing } from "./ticker.js";

// ---------------------------------------------------------------- summary
function verdictCard(d) {
  const sig = signalsFor(d), ov = A.overall(sig);
  const ring = scoreRing(ov);
  const strengths = sig.filter((s) => s.status === "good").map((s) => s.label.toLowerCase());
  const concerns = sig.filter((s) => s.status === "bad").map((s) => s.label.toLowerCase());
  const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0]);
  const summary = [strengths.length ? `Strengths: ${list(strengths)}.` : null, concerns.length ? `Watch out for: ${list(concerns)}.` : null].filter(Boolean).join(" ");
  const split = A.splitRead(ov);
  const row = (s) => h("details", { class: "signal" },
    h("summary", {}, h("span", { class: "lbl" }, h("span", { class: "has-tip", "data-tip": s.text, "data-tip-title": `${s.label}: ${s.word}` }, s.label)), h("span", { class: "val" }, s.value), pill(s.status, s.word)),
    h("div", { class: "body" }, h("p", {}, s.text), signalMath(s, ov), s.term ? h("button", { class: "linkish small", type: "button", on: { click: () => openTerm(s.term) } }, `What's ${GLOSSARY[s.term].term}?`) : null));
  // Checks grouped by part; each heading shows that part's share of the points.
  const groups = ov.parts?.length ? ov.parts.flatMap((p) => [partHead(p), ...p.checks.map(row)]) : sig.map(row);

  return card(null, { area: "verdict", class: "span verdict-card" },
    h("div", { class: "verdict" }, ring,
      h("div", {},
        h("div", { class: "muted small" }, "The quick read"),
        h("h2", {}, ov.lean),
        h("div", { class: "ink2 small" }, `${ov.good} of ${ov.total} signals positive${ov.bad ? `, ${ov.bad} negative` : ""}`),
        ov.score != null ? h("div", { class: "muted small tnum" }, `${fmtPts(ov.earned)} of ${fmtPts(ov.possible)} points = ${ov.score}`) : null,
        ov.score != null ? scoreTrend(d) : null)),
    summary ? h("p", { class: "verdict-sum" }, summary) : null,
    split ? h("p", { class: "verdict-sum split" }, rich(split)) : null,
    h("div", { class: "signals" }, groups),
    h("p", { class: "muted small", style: "margin:10px 0 0" }, h("span", { class: "only-touch" }, "Tap a row for what it means and how it's scored. "), h("span", { class: "only-hover" }, "Hover a row for what it means; click it for how it's scored. "), "Each check earns 0 to 1 on a sliding scale, and business checks weigh more than mood checks (analyst targets, price trend). The bars split the same points into business, price and mood; they add up to the score. It's a checklist, not a prediction. ", h("a", { href: `#/t/${d.symbol}/walk` }, "New to this? Walk through it step by step ›")));
}

// ---- score over time (data/scores/<SYM>.json, written by scripts/score_history.mjs)
// Fetched once per ticker when its Summary opens; a missing file just means no history yet.
function loadScores(sym) {
  state.scores ??= {};
  return (state.scores[sym] ??= fetchJSON(`data/scores/${sym}.json`).catch(() => null));
}
// Saved days before today's data, plus today's point computed here, so the line always ends on the
// same score as the ring (even right after a rule change, before the next update rescores the past).
function scoreSeries(d, file) {
  const today = A.scorePoint(d, tickers().map((t) => t.symbol));
  return [...(file?.points || []).filter((p) => p.date < today.date && p.score != null), today];
}
function scoreTrend(d) {
  const box = h("div", { class: "score-trend small" });
  loadScores(d.symbol).then((file) => {
    const pts = scoreSeries(d, file);
    if (pts.length < 2) { box.append(h("span", { class: "muted" }, "Score history starts with the next daily update.")); return; }
    const first = pts[0], last = pts[pts.length - 1], diff = last.score - first.score;
    box.append(h("span", { html: sparkline(pts.map((p) => p.score), { width: 64, height: 20 }) }),
      h("span", { class: "ink2 tnum" }, `${diff > 0 ? `Up ${diff}` : diff < 0 ? `Down ${-diff}` : "Unchanged"} since ${A.date(first.date, { month: "short", day: "numeric" })}`),
      h("button", { class: "linkish small", type: "button", on: { click: () => openScoreSheet(d, file, pts) } }, "How it moved ›"));
  });
  return box;
}
const ST_WORD = { g: "green", o: "amber", b: "red", n: "not judged" };
function openScoreSheet(d, file, pts) {
  const labels = Object.fromEntries(signalsFor(d).map((s) => [s.key, s.label]));
  const kind = d.type === "ETF" ? "fund" : "equity";
  const moves = A.scoreMoves(pts, kind).filter((m) => m.diff !== 0 || m.why.length).reverse();
  const fd = (s) => A.date(s, { month: "short", day: "numeric" });
  const sign = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(Math.abs(x) < 1 ? 1 : 0)}`;
  const reason = (w) => {
    const l = labels[w.key] || w.key;
    if (w.flip) return `${l} ${w.toSt === "n" ? "couldn't be judged, so it left the score" : "could be judged again, so it rejoined the score"}.`;
    return `${l}: ${w.from.toFixed(2)} → ${w.to.toFixed(2)} of its points${w.fromSt !== w.toSt ? ` (${ST_WORD[w.fromSt]} → ${ST_WORD[w.toSt]})` : ""}, about ${sign(w.pts)}.`;
  };
  const c = h("div", {});
  openSheet((s) => s.append(...[sheetHead(`${d.symbol} score over time`),
    h("p", { class: "ink2" }, `One point per day of data (${pts.length} so far, from ${fd(pts[0].date)}). Every past day is rescored with today's rules, so the line moves only when ${A.shortName(d)}'s numbers or the market moved, never because the rules changed. 70+ reads Strong, 45–69 Mixed. `, qmark("scoreHistory")),
    file && file.version !== A.SCORE_VERSION ? h("p", { class: "muted small" }, "The rules changed since the last update, so the past days will be rescored at the next one. Today's point already uses the new rules.") : null,
    c,
    h("h3", {}, "What moved it"),
    moves.length ? h("div", { class: "score-moves" }, moves.map((m) => h("div", { class: "score-move" },
      h("div", { class: "tnum" }, h("b", {}, `${fd(m.prev)} → ${fd(m.date)}: `), `${m.from} → ${m.to} (${m.diff > 0 ? "+" : m.diff < 0 ? "−" : "±"}${Math.abs(m.diff)})`),
      m.why.length ? h("ul", {}, m.why.map((w) => h("li", { class: "small ink2" }, reason(w)))) : h("p", { class: "small muted" }, "Tiny shifts in several checks, none worth listing.")))) : h("p", { class: "muted" }, "No moves yet."),
    h("p", { class: "muted small" }, "A check's points × its weight, as a share of the day's total, gives its part of the move. Rounding means the parts may not add up exactly. Not financial advice.")].filter(Boolean)), { cls: "wide" });
  requestAnimationFrame(() => lineChart(c, { dates: pts.map((p) => p.date), series: [{ name: "Score", values: pts.map((p) => p.score), color: "var(--series-1)" }],
    yRange: [0, 100], yFormat: (v) => v.toFixed(0), xFormat: (s) => fd(s), tipTitle: (s) => A.date(s), area: false, height: 200, ariaLabel: `${d.symbol} checklist score by day`,
    tipLabel: (i) => Object.entries(pts[i].parts || {}).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} ${v ?? "—"}`).join(" · ") }));
}

// A part's heading: name, a bar filled to its share of its own points, and the points.
function partHead(p) {
  const tip = `${p.label} covers ${p.about}: ${p.checks.map((s) => s.label.toLowerCase()).join(", ")}. ${p.score != null ? `It earned ${fmtPts(p.earned)} of its ${fmtPts(p.possible)} points, which is ${p.score} out of 100 for this part.` : "None of its checks could be judged yet."}`;
  return h("div", { class: "part-head has-tip", "data-tip": tip, "data-tip-title": p.label },
    h("span", { class: "part-name" }, p.label),
    h("span", { class: "part-track", "aria-hidden": "true" }, p.score != null ? h("span", { class: "part-fill", style: `width:${Math.max(2, p.score)}%` }) : null),
    h("span", { class: "part-pts tnum" }, p.score != null ? `${p.score} · ${fmtPts(p.earned)} of ${fmtPts(p.possible)} pts` : "not judged"));
}

// Home-card tooltip line: "Business 74 · Price 40 · Mood 61".
export const partsLine = (ov) => (ov.parts || []).map((p) => `${p.label} ${p.score ?? "—"}`).join(" · ");

export const fmtPts = (x) => (Math.round(x * 10) / 10).toString();
// One line under each check: its sliding scale, what it earned, and its weight.
export function signalMath(s, ov) {
  if (s.status === "na") return h("p", { class: "muted small" }, "Not judged yet, so it's left out of the score.");
  if (!isNum(s.pts)) return null;
  return h("p", { class: "muted small tnum" }, `How it's scored: ${s.rule}. Here it earns ${s.pts.toFixed(2)} × weight ${s.weight} = ${fmtPts(s.pts * s.weight)} of the ${fmtPts(ov.possible)} points.`);
}

export function rangeFigure(lo, hi, cur, { mean, labels } = {}) {
  if (![lo, hi, cur].every(isNum) || hi <= lo) return null;
  const p = (v) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  return h("div", { class: "range" },
    h("div", { class: "range-track" },
      isNum(mean) ? h("div", { class: "range-dot mean", style: `left:${p(mean)}`, title: `Average ${A.price(mean)}` }) : null,
      h("div", { class: "range-dot", style: `left:${p(cur)}`, title: `Current ${A.price(cur)}` })),
    h("div", { class: "range-labels" }, h("span", {}, labels?.[0] ?? A.price(lo)), h("span", {}, labels?.[1] ?? A.price(hi))));
}

// Each firm's latest 12-month target as a dot, with today's price and the average marked.
export const RATING_GROUP = (r) => /strong buy|buy|outperform|overweight|positive|accumulate/i.test(r || "") ? 0 : /sell|underperform|underweight|negative|reduce/i.test(r || "") ? 2 : 1;
export const RATING_COLORS = ["#5598e7", "#a3a29b", "#e66767"], RATING_NAMES = ["Buy", "Hold", "Sell"];
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
export function ratingChip(r) {
  if (!r) return h("span", { class: "muted" }, "—");
  const gi = RATING_GROUP(r);
  return h("span", { class: "rchip", "data-tip": RATING_WORDS[r.toLowerCase()] || `This firm's word for ${RATING_NAMES[gi]}.`, "data-tip-title": `“${r}” = ${RATING_NAMES[gi]}` },
    r,
    r.toLowerCase() === RATING_NAMES[gi].toLowerCase() ? null : h("span", { class: "muted" }, ` = ${RATING_NAMES[gi]}`));
}
// Each firm's most recent target (the actions list is newest first).
export function firmTargets(d) {
  const seen = new Set(), out = [];
  for (const x of d.analysts?.actions || []) {
    if (!x.firm || seen.has(x.firm) || !isNum(x.target) || x.target <= 0) continue;
    seen.add(x.firm); out.push(x);
  }
  return out;
}
export function targetStrip(d) {
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

export function tabSummary(d, body) {
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
