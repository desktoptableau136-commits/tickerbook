// Ticker page shell (tabs, pager, notices) and the price chart card.
import * as A from "./analysis.js";
import * as GH from "./github.js";
import { lineChart, legend } from "./charts.js";
import { tabAnalysts } from "./analysts.js";
import { arrow, card, changesBanner, h, isNum, logo, pref, rich, setCur, signClass, state, tagIcon, termBtn, tickers, view } from "./core.js";
import { tabDividends } from "./dividends.js";
import { tabEarnings } from "./earnings.js";
import { tabFinancials } from "./financials.js";
import { tabHoldings } from "./holdings.js";
import { tabNews } from "./news.js";
import { tabPeers } from "./peers.js";
import { openResearch, openTickerMenu } from "./research.js";
import { tabSummary } from "./summary.js";
import { tabValuation } from "./valuation.js";
import { tabWalk } from "./walkthrough.js";

// ================================================================ ticker page
export const EQUITY_TABS = [["summary", "Summary"], ["walk", "Walkthrough"], ["earnings", "Earnings"], ["financials", "Financials"], ["dividends", "Dividends"], ["valuation", "Valuation"], ["peers", "Peers"], ["analysts", "Analysts"], ["news", "News"]];
export const FUND_TABS = [["summary", "Summary"], ["walk", "Walkthrough"], ["holdings", "Holdings"], ["dividends", "Dividends"], ["news", "News"]];

export const TAB_FN = { summary: tabSummary, walk: tabWalk, earnings: tabEarnings, financials: tabFinancials, dividends: tabDividends, valuation: tabValuation, peers: tabPeers, analysts: tabAnalysts, news: tabNews, holdings: tabHoldings };

export function renderTicker(sym, tab) {
  const d = state.data[sym];
  if (!d) {
    view.append(h("a", { class: "back", href: "#/" }, "‹ Watchlist"),
      card(`${sym} isn't on your watchlist`, {}, h("p", { class: "muted" }, "Add it with Research to load its data."),
        GH.connected() ? h("button", { class: "btn primary", type: "button", on: { click: () => openResearch(sym) } }, `Research ${sym}`) : h("a", { class: "btn", href: "#/settings" }, "Connect GitHub to research")));
    return;
  }
  setCur(d);
  const tabs = d.type === "ETF" ? FUND_TABS : EQUITY_TABS;
  if (!tabs.some(([k]) => k === tab)) tab = "summary";
  const tag = state.index.tickers.find((t) => t.symbol === sym)?.tag;
  const about = d.profile?.summary;

  const head = h("div", { class: "qtop" },
    h("div", { class: "qid" },
      h("div", { class: "qnav" }, h("a", { class: "back", href: "#/" }, "‹ Watchlist"), tickerPager(sym, tab)),
      h("h1", {}, d.type === "ETF" ? null : logo(d.symbol, d.name, 40), d.symbol, tag ? tagIcon(tag) : null),
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
  view.append(head, archiveNote(d, sym), newListingNote(d), dropNote(d), changesBanner(d) || "", tabBar, body);
  TAB_FN[tab](d, body);
  body.append(h("p", { class: "disclaimer" }, "For learning and research only. Not financial advice."));
}

// Previous / next ticker, in the home page's order and filter, staying on the same tab. Wraps
// around. An archived ticker steps through the archived ones.
function tickerPager(sym, tab) {
  const every = tickers(), me = every.find((t) => t.symbol === sym);
  const active = every.filter((t) => t.tag !== "archived");
  const filtered = state.filter === "all" ? active : active.filter((t) => t.tag === state.filter);
  const list = me?.tag === "archived" ? every.filter((t) => t.tag === "archived") : filtered.some((t) => t.symbol === sym) ? filtered : active;
  const i = list.findIndex((t) => t.symbol === sym);
  if (i < 0 || list.length < 2) return null;
  const which = me?.tag === "archived" ? "archived tickers" : list === filtered && state.filter !== "all" ? `${state.filter} tickers (the home page filter)` : "watchlist";
  const at = (k) => list[(i + k + list.length) % list.length].symbol;
  const link = (k, text) => h("a", { class: "pager-btn", href: `#/t/${at(k)}/${tab}`, "aria-label": `${k < 0 ? "Previous" : "Next"} ticker: ${at(k)}`, "data-tip": `${k < 0 ? "Previous" : "Next"} in your ${which}, on the same tab.`, "data-tip-title": at(k) }, text);
  return h("nav", { class: "pager", "aria-label": "Other tickers" },
    link(-1, `‹ ${at(-1)}`), h("span", { class: "muted tnum" }, `${i + 1} of ${list.length}`), link(1, `${at(1)} ›`));
}

// Sharp drop: the checks lag news, so say so where the score is shown (icon + word with the red tint).
function dropNote(d) {
  const dr = A.sharpDrop(d);
  if (!dr) return "";
  return h("div", { class: "notice bad", role: "note" },
    h("b", {}, "⚠ Big drop: "), `down ${A.pct(-dr.change, { digits: 0 })} in a month (${A.price(dr.from)} on ${A.date(dr.fromDate)} → ${A.price(d.quote.price)}). `,
    "The score is built from reported results and analyst forecasts, which take weeks to catch up with news, and a falling price makes valuation and target upside look better. So the score probably looks rosier than things are. ",
    h("a", { href: `#/t/${d.symbol}/news` }, "Read the news ›"));
}

// Recently listed: why several checks say "too new to judge" (the same rules apply to every stock).
function newListingNote(d) {
  const nl = A.newListing(d);
  if (!nl) return "";
  const g = A.expectedGrowth(d);
  const thin = [nl.reported < 4 ? `the earnings record (${nl.reported} report${nl.reported === 1 ? "" : "s"} so far; it needs 4)` : null,
    nl.tradingDays < 200 ? `the price trend (${nl.tradingDays} trading days; a 200-day average needs 200)` : null,
    "the estimate trend (early estimates swing while analysts learn the business)"].filter(Boolean);
  const span = nl.months < 12 ? "1- or 5-year price comparison" : "5-year price comparison";
  return h("div", { class: "notice arch-note" },
    h("b", {}, "Recently listed: "), `${A.shortName(d)} began trading on ${A.date(nl.listed)} (${nl.months} month${nl.months === 1 ? "" : "s"} ago). `,
    thin.length ? `Some checks need more history, so they're left out of the score: ${thin.length > 1 ? `${thin.slice(0, -1).join(", ")} and ${thin[thin.length - 1]}` : thin[0]}. There's no ${span} yet either. ` : `There's no ${span} yet. `,
    isNum(g) && g > A.WILD_GROWTH ? `Analysts expect about ${A.pct(g, { digits: 0 })} yearly earnings growth, which comes from a tiny base, so valuation is judged on the P/E alone. ` : "",
    "New companies' numbers and estimates tend to swing a lot in their first couple of years, so read everything here as early and rough.");
}

// Archived: when and how stale. Gaps in our own daily snapshots (several archive/unarchive
// cycles give several gaps), since they leave holes in the P/E and estimate history.
function archiveNote(d, sym) {
  const t = state.index.tickers.find((x) => x.symbol === sym);
  const gaps = A.snapshotGaps(d.history);
  const parts = [];
  if (t?.tag === "archived") {
    const on = t.archivedOn || d.archivedOn;
    const sa = t.sinceArchived;
    parts.push(h("span", {}, h("b", {}, "Archived"), on ? ` on ${A.date(on)}` : "", isNum(t.archivedPrice) ? ` at ${A.price(t.archivedPrice)}` : "",
      sa && isNum(sa.move) ? [`; now ${A.price(sa.price)} (${A.date(sa.date)}), `, h("b", { class: signClass(sa.move) }, `${arrow(sa.move)} ${A.pct(sa.move, { sign: true })}`), " since"] : "",
      `. It isn't fully refreshed while archived (only its price is checked), so everything else here is as of ${A.date(d.quote.marketTime || d.updated)}. Its saved history is kept.`,
      GH.connected() ? " " : "", GH.connected() ? h("button", { class: "linkish", type: "button", on: { click: () => openTickerMenu(d) } }, "Unarchive") : null));
  }
  if (gaps.length) {
    // listed inline (not hover-only) so it reads on a phone; the longest few if there are many
    const top = [...gaps].sort((a, b) => b.days - a.days).slice(0, 3).sort((a, b) => a.last.localeCompare(b.last));
    parts.push(h("span", {}, h("b", {}, gaps.length === 1 ? "Gap in daily snapshots: " : `${gaps.length} gaps in daily snapshots: `),
      top.map((g) => A.gapText(g)).join(" · "), gaps.length > 3 ? ` · and ${gaps.length - 3} shorter` : "",
      ". The P/E and analyst-estimate history has holes there; Yahoo doesn't keep past values, so they can't be filled in."));
  }
  return parts.length ? h("div", { class: "notice arch-note" }, ...parts.flatMap((x, i) => (i ? [h("br"), x] : [x]))) : "";
}

// "Show all": hides a list's rows past the first `show` and returns the toggle button (null if not needed).
// ---------------------------------------------------------------- price chart
// hover values for the price chart's % views: "−12.3%" and "$182.40"
const pctTip = (v) => (Math.abs(v) < 0.0005 ? "at its high" : `${v < 0 ? "−" : "+"}${Math.abs(v * 100).toFixed(1)}%`);
const usd = (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const RANGES = [["1M", 21], ["6M", 126], ["YTD", "ytd"], ["1Y", 252], ["5Y", Infinity]];

export function priceCard(d) {
  const box = h("div", { class: "flexcol" });
  let range = pref("range") || "1Y";
  let drops = pref("drops") === "1";
  const perf = h("div", { class: "perf" });
  // "vs" picker: off, one benchmark, or both. A fund tracking a benchmark's own index doesn't get that one.
  const avail = A.BENCHES.filter((b) => state.bench?.[b.key]?.dates?.length && !A.tracksBench(d, b.key));
  const choices = [["off", "No comparison"], ...avail.map((b) => [b.key, `vs ${b.name}`]), ...(avail.length > 1 ? [["both", "vs both"]] : [])];
  const saved = pref("vs") ?? (pref("vsMarket") === "1" ? "SPY" : "off");
  let vs = choices.some(([k]) => k === saved) ? saved : saved === "both" && avail.length ? avail[0].key : "off";
  const picked = () => (vs === "both" ? avail : avail.filter((b) => b.key === vs));

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
    // a recently listed stock's longer ranges start at its first trading day, so say that
    const short = start === 0 && A.newListing(d);
    const span = short ? `since it began trading on ${A.date(dates[0])}` : `over ${{ "1M": "the last month", "6M": "the last 6 months", YTD: "the year so far", "1Y": "the last year", "5Y": "5 years" }[range]}`;
    perf.replaceChildren(h("span", { class: signClass(chg) }, `${d.symbol} ${A.pct(chg, { sign: true })}`), ` ${span}`);
    const c = h("div", {});
    if (drops) {
      // how far below its running high (over all the history we have) it was each day
      const dd = A.drawdowns(dates, close), us = dd.under.slice(start);
      const series = [{ name: d.symbol, values: us, color: "var(--series-1)", tip: (i, v) => `${pctTip(v)} · ${usd(cs[i])}` }];
      for (const b of picked()) {
        const B = state.bench[b.key];
        const bu = A.drawdowns(B.dates, B.close).under, bmap = new Map(B.dates.map((x, i) => [x, i]));
        const bi = ds.map((x) => bmap.get(x));
        series.push({ name: b.name, legend: `${b.name} (${b.key})`, values: bi.map((j) => (j == null ? null : bu[j])), color: b.color, tip: (i, v) => `${pctTip(v)} · ${usd(B.close[bi[i]])}` });
      }
      if (series.length > 1) box.append(legend(series.map((s) => ({ name: s.legend || s.name, color: s.color, kind: "line" }))));
      box.append(c);
      lineChart(c, { dates: ds, series, area: false, refLine: 0, yMax: 0, yFormat: (v, axis) => (axis ? (Math.abs(v) < 0.0005 ? "0%" : `−${Math.abs(v * 100).toFixed(0)}%`) : pctTip(v)), xFormat: fmtX, tipTitle, height: 230, fill: true,
        ariaLabel: `${d.symbol} percent below its previous high, ${range}` });
      const worst = Math.min(...us);
      perf.replaceChildren(h("span", { class: "down" }, `Worst ${A.pct(worst, { digits: 0 })}`), ` in ${span} · now `, h("b", {}, us[us.length - 1] > -0.005 ? "at its high" : `${A.pct(-us[us.length - 1], { digits: 0 })} below its high`));
      const st = A.dropStory(d, state.bench?.SPY);
      if (st) box.append(h("p", { class: "small ink2 drop-note" }, rich(st.lines[0]), " ", rich(st.lines[1] || ""), " ", termBtn("drawdown", "About drops")));
      return;
    }
    if (picked().length) {
      // every line starts at 100 on the first day, so the chart compares % change, not price
      const idxTip = (v) => (v - 100 >= 0 ? "+" : "−") + Math.abs(v - 100).toFixed(1) + "%";
      const series = [{ name: d.symbol, values: cs.map((v) => (v / cs[0]) * 100), color: "var(--series-1)", tip: (i, v) => `${idxTip(v)} · ${usd(cs[i])}` }];
      const results = [];
      for (const b of picked()) {
        const B = state.bench[b.key], bmap = new Map(B.dates.map((x, i) => [x, B.close[i]]));
        const b0 = bmap.get(ds[0]) ?? B.close[B.dates.findIndex((x) => x >= ds[0])];
        if (!isNum(b0)) continue;
        const vals = ds.map((x) => (bmap.has(x) ? (bmap.get(x) / b0) * 100 : null));
        const last = [...vals].reverse().find((v) => v != null);
        series.push({ name: b.name, legend: `${b.name} (${b.key})`, values: vals, color: b.color, tip: (i, v) => `${idxTip(v)} · ${usd(bmap.get(ds[i]))}` });
        if (isNum(last)) results.push({ name: b.name, chg: last / 100 - 1 });
      }
      box.append(legend(series.map((s) => ({ name: s.legend || s.name, color: s.color, kind: "line" }))), c);
      lineChart(c, { dates: ds, series, yFormat: (v) => (v - 100 >= 0 ? "+" : "−") + Math.abs(v - 100).toFixed(0) + "%", xFormat: fmtX, tipTitle, height: 230, fill: true, refLine: 100,
        ariaLabel: `${d.symbol} vs ${results.map((r) => r.name).join(" and ")}, indexed` });
      const verdict = results.map((r, i) => `${chg >= r.chg ? (i ? "beat" : "Beat") : (i ? "trailed" : "Trailed")} the ${r.name} by ${A.pct(Math.abs(chg - r.chg))}`).join(", ");
      perf.append(...results.map((r) => ` · ${r.name} ${A.pct(r.chg, { sign: true })}`), ". ", h("b", {}, verdict));
    } else {
      box.append(c);
      lineChart(c, { dates: ds, series: [{ name: d.symbol, values: cs, color: "var(--series-1)" }],
        yFormat: (v, axis) => (axis && v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(axis ? 0 : 2)}`), xFormat: fmtX, tipTitle, height: 230, fill: true, ariaLabel: `${d.symbol} price, ${range}` });
    }
  };

  const chips = h("div", { class: "chips", role: "group", "aria-label": "Time range" },
    RANGES.map(([k]) => h("button", { class: "chip", type: "button", "aria-pressed": String(k === range),
      on: { click: (e) => { range = k; pref("range", k); chips.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", String(x === e.currentTarget))); draw(); } } }, k)));
  const vsTip = `Compares the % change, with dividends counted for the stock and the market alike. ${avail.map((b) => `${b.name} (tracked by the ${b.key} fund): ${b.about}`).join(" ")}`;
  const tog = avail.length ? h("label", { class: "toggle vs-pick", "data-tip": vsTip, "data-tip-title": "Compare with the market" },
    h("select", { "aria-label": "Compare with the market", on: { change: (e) => { vs = e.target.value; pref("vs", vs); draw(); } } },
      choices.map(([k, label]) => h("option", { value: k, ...(k === vs ? { selected: true } : {}) }, label)))) : null;
  const dropTog = h("label", { class: "toggle", "data-tip": "Shows how far the price was below its previous high on each day, and how long it took to recover.", "data-tip-title": "Drops from a peak" },
    h("input", { type: "checkbox", ...(drops ? { checked: true } : {}), on: { change: (e) => { drops = e.target.checked; pref("drops", drops ? "1" : "0"); draw(); } } }), "Drops");
  requestAnimationFrame(draw);
  return card(null, { area: "chart", class: "span" }, h("div", { class: "chart-controls" }, chips, h("div", { class: "toggles" }, tog, dropTog), perf), box);
}

// The checklist score as a ring filled to the score, in its status color (always shown with the word nearby).
// Card border class matching scoreRing's color; no score keeps the plain border.
export function toneClass(ov) {
  return ov.score == null ? "" : ov.tone === "good" ? " tone-good" : ov.tone === "ok" ? " tone-warn" : " tone-bad";
}

export function scoreRing(ov, size = 76, stroke = 8, cls = "") {
  const r = (size - stroke) / 2, c = size / 2, C = 2 * Math.PI * r;
  const color = ov.tone === "good" ? "good" : ov.tone === "ok" ? "warn" : "bad";
  // the box matches the drawn size so the number stays centered at any size (CSS defaults are 76px / 40px)
  return h("div", { class: `score-ring ${cls}`, style: `width:${size}px;height:${size}px`, role: "img", "aria-label": ov.score != null ? `Score ${ov.score} out of 100` : "No score yet" },
    h("div", { html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/>${ov.score ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--${color})" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(C * ov.score) / 100} ${C}"/>` : ""}</svg>` }),
    h("div", { class: "val tnum" }, ov.score ?? "—"));
}
