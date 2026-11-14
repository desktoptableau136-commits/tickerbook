// Dividends tab.
import * as A from "./analysis.js";
import { GLOSSARY } from "./glossary.js";
import { lineChart, columnChart, legend } from "./charts.js";
import { arrow, card, dashMQ, fitDash, grid, h, isNum, pill, rich, showMore, signClass, termBtn, tile } from "./core.js";
import { openTerm } from "./sheets.js";

// ---------------------------------------------------------------- dividends
export function tabDividends(d, body) {
  const s = A.dividendStory(d);
  if (!s) { body.append(card(null, {}, h("p", { class: "empty" }, "Dividend data arrives with the next data refresh."))); return; }
  if (!s.pays) {
    const g = grid("divnone", true);
    const cu = d.type === "EQUITY" ? A.cashUses(d) : null;
    g.append(card(`${s.name} doesn't pay a dividend`, { area: "none", class: "span", term: "dividendYield" },
      h("p", {}, "Owning it pays you nothing along the way: all of your return would have to come from the share price rising."),
      cu ? [h("p", { class: "ink2" }, "Here's what it did with its spare cash instead:"), ...cu.lines.map((t) => h("p", { class: "ink2" }, rich(t))),
        h("p", { class: "muted small" }, "More detail in ", h("a", { href: `#/t/${d.symbol}/financials` }, "Financials → Where the cash goes"), ".")] : null,
      h("p", { class: "muted small" }, "Companies that don't pay usually say they can earn more by reinvesting the cash (or buying back shares). For a dividend-income approach, look for companies with a long record of paying and raising.")));
    body.append(g);
    return;
  }
  const g = grid(s.isFund ? "divfund" : "dividends", true);
  const fd = (x) => A.date(x);
  const upcoming = s.exDate && s.exDate >= s.today;

  // ---- the dividend in brief
  g.append(card("The dividend in brief", { area: "brief", term: "dividendYield" },
    h("div", { class: "tiles" },
      tile("Yield", A.pct(s.yld, { digits: 2 }), `${A.price(s.rate)} a year${s.announced ? " (announced)" : ""} ÷ ${A.price(d.quote.price)} price`, "dividendYield"),
      s.announced ? tile("Next payment", A.price(s.announced.each), `Raised from ${A.price(s.announced.from)} · paid ${s.freqWord}`)
        : tile(s.isFund ? "Last 12 months" : "Per payment", s.isFund ? A.price(s.rate) : A.price(s.lastReg.amount), s.isFund ? `Paid ${s.payWord}` : `Paid ${s.freqWord}`),
      upcoming ? tile("Next ex-dividend date", fd(s.exDate), s.payDate && s.payDate >= s.exDate ? `Paid ${fd(s.payDate)}` : "Own it the day before", "exDividend")
        : tile("Last ex-dividend date", fd(s.exDate || s.last.date), s.payDate && s.payDate >= (s.exDate || "") ? `Paid ${fd(s.payDate)}` : null, "exDividend"),
      s.isFund ? tile("Growth, 5 years", s.growth[5] ? `${A.pct(s.growth[5].cagr, { sign: true })}/yr` : "—", s.growth[5] ? `${A.price(s.growth[5].from)} → ${A.price(s.growth[5].to)} a year` : null, "dividendGrowth")
        : tile("Raises in a row", s.streak ? `${s.streak}${s.streakAtLeast ? "+" : ""} year${s.streak === 1 && !s.streakAtLeast ? "" : "s"}` : "None", s.lastCut ? `Last cut ${s.lastCut.year}` : `Paying since ${s.sinceYear}`, "dividendStreak")),
    h("div", { class: "div-story" }, s.lines.map((t) => h("p", {}, rich(t)))),
    s.isFund ? h("p", { class: "muted small", style: "margin-top:12px" }, "The safety checks on company pages don't apply here: a fund's payout is the sum of what hundreds of companies pay, so it can't be cut by one bad decision.") : null));

  // ---- can it afford it?
  if (!s.isFund) {
    const ov = s.tally;
    g.append(card("Can it afford it?", { area: "safety", right: s.verdict ? pill(s.verdict.tone, s.verdict.label) : null,
      sub: ov.total ? `${ov.good} of ${ov.total} checks pass${ov.bad ? `, ${ov.bad} fail` : ""}${s.checks.some((c) => c.status === "na") ? " (some can't be judged yet)" : ""}` : null },
      h("div", { class: "signals one" }, s.checks.map((c) => h("details", { class: "signal" },
        h("summary", {}, h("span", { class: "lbl" }, h("span", { class: "has-tip", "data-tip": c.text, "data-tip-title": `${c.label}: ${c.word}` }, c.label)), h("span", { class: "val" }, c.value), pill(c.status, c.word)),
        h("div", { class: "body" }, h("p", {}, c.text),
          c.multi ? h("p", { class: "small muted" }, `Over ${c.multi.span}: ${A.money(c.multi.div)} ÷ ${A.money(c.multi.fcf)} = ${A.pct(c.multi.payout, { digits: 0 })}, which smooths out one-off years.`) : null,
          c.term ? h("button", { class: "linkish small", type: "button", on: { click: () => openTerm(c.term) } }, `What's ${GLOSSARY[c.term].term.toLowerCase()}?`) : null)))),
      h("p", { class: "muted small", style: "margin:10px 0 0" }, h("span", { class: "only-touch" }, "Tap a row for the math. "), h("span", { class: "only-hover" }, "Hover or click a row for the math. "),
        "A simple checklist (green = 1, amber = ½, red = 0), not a prediction. Dividends get cut when cash runs short, debt piles up or the business shrinks; these checks look at each.")));
  }

  // ---- what the dividends added
  if (s.ret) {
    const r = s.ret, yrs = Math.round(r.years);
    g.append(card("What dividends added", { area: "ret", term: "totalReturn", sub: `${yrs} years from ${fd(r.start)}, as if each dividend bought more shares` },
      h("div", { class: "tiles" },
        tile("Price only", A.pct(r.priceOnly, { sign: true, digits: 0 }), `${A.price(r.rawStart)} → ${A.price(r.rawEnd)}`),
        tile("With dividends", A.pct(r.total, { sign: true, digits: 0 }), "Reinvested", "totalReturn"),
        tile("Dividends added", `${r.added >= 0 ? "+" : "−"}${Math.abs(r.added * 100).toFixed(0)} pts`, "Of the total return"),
        tile("Yield on cost", A.pct(r.yoc, { digits: 1 }), `${A.price(s.rate)} ÷ the ${A.price(r.rawStart)} price then`, "yieldOnCost")),
      s.income ? h("p", { class: "ink2", style: "margin:12px 0 0" }, rich(`**$10,000** invested today buys about ${A.num(s.income.shares, 1)} shares, which would pay about **${A.price(s.income.year)} a year** (${A.price(s.income.each)} ${s.freqWord}) at the current dividend, before tax.`)) : null));
  }

  // ---- per year
  // the current year shows as a lighter "so far" bar, so a big raise this year isn't hidden
  const full = s.byYear.filter((y) => !y.partial).slice(-15), cur = s.byYear.find((y) => y.partial);
  const yrs = cur?.count ? [...full.slice(-14), cur] : full;
  if (full.length >= 2) {
    const hasSpecial = yrs.some((y) => y.special > 0);
    const cuts = full.filter((y) => y.cut).map((y) => y.year);
    const c = h("div", {});
    g.append(card("Dividend per share, by year", { area: "years", term: "dividendGrowth",
      sub: [`What one share paid each calendar year`, cur?.count ? ` · ${cur.year} so far: ${A.price(cur.regular + cur.special)}` : "", cuts.length ? ` · cut in ${cuts.join(", ")} (see hover)` : ""].join("") },
      hasSpecial || cur?.count ? legend([{ name: "Regular", color: "var(--series-1)" }, ...(hasSpecial ? [{ name: "Special (one-time)", color: "var(--series-2)" }] : []),
        ...(cur?.count ? [{ name: `${cur.year} so far`, color: "var(--series-muted)" }] : [])]) : null, c));
    requestAnimationFrame(() => columnChart(c, {
      categories: yrs.map((y) => `'${String(y.year).slice(2)}`),
      series: [{ name: "Regular", values: yrs.map((y) => y.regular), color: "var(--series-1)" }, ...(hasSpecial ? [{ name: "Special", values: yrs.map((y) => y.special || null), color: "var(--series-2)" }] : [])],
      colorFor: (si, i) => (yrs[i].partial ? "var(--series-muted)" : si ? "var(--series-2)" : "var(--series-1)"),
      yFormat: (v, axis) => (axis ? `$${v.toFixed(v < 2 ? 2 : 0)}` : A.price(v)),
      tipRows: (i) => {
        const y = yrs[i], prev = yrs[i - 1];
        const rows = [{ color: y.partial ? "var(--series-muted)" : "var(--series-1)", label: `${y.count} payment${y.count === 1 ? "" : "s"}${y.partial ? " so far" : ""}`, value: A.price(y.regular) }];
        if (y.special) rows.push({ color: "var(--series-2)", label: "Special", value: A.price(y.special) });
        if (prev?.regular > 0 && y.regular > 0 && !y.partial) rows.push({ label: "vs year before", value: A.pct(y.regular / prev.regular - 1, { sign: true }) });
        if (!s.isFund && (y.raised || y.cut)) rows.push({ label: y.cut ? "✕ Cut" : "▲ Raised", value: y.cut && y.raised ? "and raised" : "this year" });
        return rows;
      },
      ariaLabel: "Dividend per share by year", height: dashMQ.matches ? 230 : 200,
    }));
  }

  // ---- yield over time
  if (s.yh.dates.length >= 6) {
    const c = h("div", {});
    g.append(card("Yield over time", { area: "yield", term: "dividendYield",
      sub: s.usual ? `Trailing 12-month dividends ÷ price, month by month · the flat line is its middle, ${A.pct(s.usual.mid, { digits: 2 })}` : "Trailing 12-month dividends ÷ price, month by month" },
      c, h("p", { class: "muted small", style: "margin:8px 0 0" }, "The yield rises when the price falls (or the dividend grows), and falls when the price rises.")));
    requestAnimationFrame(() => lineChart(c, { dates: s.yh.dates, series: [{ name: "Yield", values: s.yh.values, color: "var(--series-1)" }], area: false,
      refLine: s.usual?.mid ?? null, yFormat: (v, axis) => `${(v * 100).toFixed(axis ? 1 : 2)}%`, xFormat: (x) => A.date(x, { month: "short", year: "2-digit" }),
      tipTitle: (x) => A.date(x, { month: "short", year: "numeric" }), ariaLabel: "Dividend yield over time", height: dashMQ.matches ? 230 : 200 }));
  }

  // ---- payments
  const pays = [...s.payments].reverse().slice(0, 60);
  const list = h("div", { class: "pay-list" }, pays.map((p, i) => {
    // compared per year, so a switch from yearly to quarterly payments isn't a "cut"
    const prev = pays.slice(i + 1).find((x) => isNum(x.yearly));
    const ch = !s.isFund && isNum(p.yearly) && prev ? p.yearly / prev.yearly - 1 : null;
    return h("div", { class: "list-row" },
      h("div", { class: "grow" }, fd(p.date)),
      p.special ? h("span", { class: "small muted" }, termBtn("specialDividend", "Special")) : p.glitch ? h("span", { class: "small muted has-tip", "data-tip": "A payment far below the ones either side of it, which the company never actually made. Left out of every figure." }, "Data error, ignored")
        : isNum(ch) && Math.abs(ch) >= 0.005 ? h("span", { class: `small tnum ${signClass(ch)}` }, `${arrow(ch)} ${ch > 0 ? "Raised" : "Cut"} ${ch >= 1 ? A.riseText(ch).replace(" as much", "") : A.pct(Math.abs(ch))}`) : null,
      h("span", { class: "tnum pay-amt" }, A.price(p.amount)));
  }));
  const more = showMore(list, 7);
  g.append(card("Payments", { area: "pays", term: "exDividend", sub: `Per share, by ex-dividend date${s.isFund ? "" : " · adjusted for stock splits"}` }, list, more));

  body.append(g);
  fitDash();
}

/// ---------------------------------------------------------------- walkthrough
// One slide per question: the real card from its tab, what that card is for, and what it says
// for this company (A.walkSteps). Each needed tab is rendered off-screen once and its card is
// moved into the slide, so a slide always matches the tab.
