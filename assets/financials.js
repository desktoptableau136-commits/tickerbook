// Financials tab.
import * as A from "./analysis.js";
import { GLOSSARY } from "./glossary.js";
import { lineChart, columnChart, hbars, legend } from "./charts.js";
import { card, dashMQ, fitDash, grid, h, isNum, pill, pref, rich, termBtn, tile } from "./core.js";
import { openTerm } from "./sheets.js";

// ---------------------------------------------------------------- financials
export function tabFinancials(d, body) {
  let mode = pref("finMode") || "quarterly";
  const host = h("div", {});
  const seg = h("div", { class: "seg fin-seg", role: "group", "aria-label": "Period" },
    [["quarterly", "Quarterly"], ["annual", "Annual"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String(k === mode),
      on: { click: (e) => { mode = k; pref("finMode", k); seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); fitDash(); } } }, l)));
  body.append(seg, host);

  const draw = () => {
    host.replaceChildren();
    const rows = d.financials?.[mode] || [];
    if (!rows.length) { host.append(card(null, {}, h("p", { class: "empty" }, "No financial statements available."))); return; }
    const cats = rows.map((r) => (mode === "annual" ? `FY${r.period.slice(2, 4)}` : A.quarterLabel(r.period)));
    const g = grid("financials");
    host.append(g);
    const money = (v, axis) => (axis ? A.money(v, { digits: 0 }).replace(".0", "") : A.money(v));
    const yoy = (field) => {
      const step = mode === "annual" ? 1 : 4;
      const a = rows[rows.length - 1]?.[field], b = rows[rows.length - 1 - step]?.[field];
      return isNum(a) && isNum(b) && b !== 0 ? (a - b) / Math.abs(b) : null;
    };
    const mk = (title, key, field, sub, area) => {
      const c = h("div", {});
      g.append(card(title, { term: key, sub, area }, c));
      requestAnimationFrame(() => columnChart(c, { categories: cats, series: [{ name: title, values: rows.map((r) => r[field]), color: "var(--series-1)" }], yFormat: money, ariaLabel: title, height: dashMQ.matches ? 150 : 200,
        colorFor: (si, i, v) => (v < 0 ? "var(--bad)" : "var(--series-1)") }));
    };
    const ry = yoy("revenue"), ny = yoy("netIncome");
    mk("Revenue", "revenue", "revenue", isNum(ry) ? `Latest ${A.pct(ry, { sign: true })} vs a year earlier` : "Total sales", "rev");
    const lastNI = rows[rows.length - 1]?.netIncome, prevNI = rows[rows.length - 1 - (mode === "annual" ? 1 : 4)]?.netIncome;
    const niSub = isNum(lastNI) && isNum(prevNI) && lastNI < 0 && prevNI > 0 ? "Swung to a loss vs a year earlier · red = loss"
      : isNum(lastNI) && isNum(prevNI) && lastNI > 0 && prevNI < 0 ? "Back to a profit vs a year earlier"
      : isNum(ny) ? `Latest ${A.pct(ny, { sign: true })} vs a year earlier · red = loss` : "Red bars are losses";
    mk("Net income (profit)", "netMargin", "netIncome", niSub, "ni");
    mk("Free cash flow", "freeCashflow", "freeCashflow", "Cash left after investing in the business", "fcf");

    const c = h("div", {});
    g.append(card("Margins", { area: "margins", term: "operatingMargin", sub: "Cents of profit kept per $1 of sales" },
      legend([{ name: "Gross", color: "var(--series-1)", kind: "line" }, { name: "Operating", color: "var(--series-2)", kind: "line" }, { name: "Net", color: "var(--series-3)", kind: "line" }]), c));
    const m = (a, b) => (isNum(a) && isNum(b) && b ? a / b : null);
    requestAnimationFrame(() => lineChart(c, {
      dates: cats, area: false, height: dashMQ.matches ? 150 : 200,
      series: [
        { name: "Gross", values: rows.map((r) => m(r.grossProfit, r.revenue)), color: "var(--series-1)" },
        { name: "Operating", values: rows.map((r) => m(r.operatingIncome, r.revenue)), color: "var(--series-2)" },
        { name: "Net", values: rows.map((r) => m(r.netIncome, r.revenue)), color: "var(--series-3)" },
      ],
      yFormat: (v) => `${(v * 100).toFixed(0)}%`, xFormat: (s) => s, ariaLabel: "Margins over time",
    }));

    const f = d.fundamentals;
    const lev = A.leverage(d), levNotes = A.leverageNotes(d);
    g.append(card("Balance sheet", { area: "bal", sub: "What it owns vs what it owes (latest)" },
      h("div", { class: "tiles" },
        tile("Cash", A.money(f.cash)),
        tile("Debt", A.money(f.debt)),
        tile("Net debt", lev && lev.netDebt < 0 ? `${A.money(-lev.netDebt)} net cash` : A.money(lev?.netDebt), null, "netDebtToEbitda"),
        tile("Net debt / EBITDA", lev ? A.times(lev.ratio) : "—", levNotes?.company ? `Company: ${A.num(levNotes.company.ratio, 1)}×` : levNotes?.est ? `≈${A.num(levNotes.est.ratio, 1)}× company basis` : levNotes ? "Reads high: see below" : null, "netDebtToEbitda"),
        tile("Debt / equity", A.num(f.debtToEquity, 2), null, "debtToEquity"),
        tile("Current ratio", A.num(f.currentRatio, 2), null, "currentRatio"),
        tile("Return on equity", A.pct(f.roe), null, "roe"),
        tile("Short interest", A.pct(f.shortPercentOfFloat), null, "shortInterest")),
      levNotes ? h("div", { class: "lev-notes" },
        h("div", { class: "small", style: "font-weight:600" }, `Why ${A.times(levNotes.lev.ratio)} may not match what ${A.shortName(d)} reports`),
        levNotes.lines.map((t) => h("p", { class: "small ink2" }, rich(t))),
        levNotes.company?.text ? h("p", { class: "small muted" }, "From the release: “", levNotes.company.text, "”") : null) : null));

    const eq = A.earningsQuality(d);
    if (eq) g.append(card("Are the profits real?", { area: "quality", term: "earningsQuality", right: pill(eq.tone, eq.label),
      sub: "Five warning signs that profit isn't turning into real value for owners · not part of the score" },
      h("div", { class: "signals one" }, eq.checks.map((c) => h("details", { class: "signal" },
        h("summary", {}, h("span", { class: "lbl" }, h("span", { class: "has-tip", "data-tip": c.text, "data-tip-title": `${c.label}: ${c.word}` }, c.label)), h("span", { class: "val" }, c.value), pill(c.status, c.word)),
        h("div", { class: "body" }, h("p", {}, c.text),
          c.steps.length ? h("ul", { class: "steps small muted tnum" }, c.steps.map((t) => h("li", {}, t))) : null,
          GLOSSARY[c.term] ? h("button", { class: "linkish small", type: "button", on: { click: () => openTerm(c.term) } }, `What's ${GLOSSARY[c.term].term.toLowerCase()}?`) : null)))),
      h("p", { class: "muted small", style: "margin:10px 0 0" }, h("span", { class: "only-touch" }, "Tap a row for the math. "), h("span", { class: "only-hover" }, "Hover or click a row for the math. "),
        "One sign alone is rarely proof: treat these as questions to ask. They don't change the checklist score.")));

    const cu = A.cashUses(d);
    if (cu) {
      const share = (v) => (cu.fcf > 0 ? ` (${A.pct(v / cu.fcf, { digits: 0 })})` : "");
      const fy = (r) => `FY${r.period.slice(2, 4)}`;
      const signed = (v) => (isNum(v) && v !== 0 ? `${v > 0 ? "+" : "−"}${A.money(Math.abs(v))}` : "—");
      g.append(card("Where the cash goes", { area: "cash", class: "span", term: "capitalAllocation", right: pill(cu.tone, cu.label),
        sub: `What ${A.shortName(d)} did with its free cash flow, ${cu.span} (fiscal years, from the cash-flow statement)` },
        h("div", { class: "cash" },
          h("div", { class: "cash-story" }, cu.lines.map((t) => h("p", {}, rich(t)))),
          h("div", { class: "cash-bars" },
            h("div", { class: "muted small", style: "margin-bottom:8px" }, `Spending as a share of the ${A.money(cu.fcf)} free cash flow`),
            hbars([{ label: "Free cash flow", value: Math.max(0, cu.fcf), highlight: true }, ...cu.parts.filter((p) => p.value > 0).map((p) => ({ label: p.label, value: p.value }))],
              (v) => `${A.money(v)}${v !== cu.fcf ? share(v) : ""}`),
            h("p", { class: "muted small", style: "margin:8px 0 0" }, cu.left >= 0 ? `About ${A.money(cu.left)} was left over (added to cash or invested elsewhere).`
              : `It spent ${A.money(-cu.left)} more than its free cash flow, covered by ${cu.debt > 0 ? "borrowing" : "cash it already had"}.`),
            h("div", { class: "tiles", style: "margin-top:10px" },
              tile("Share count", isNum(cu.sh1) ? `${A.num(cu.sh1 / 1e6, 0)}M` : "—", isNum(cu.shareChg) ? `${A.pct(cu.shareChg, { sign: true, digits: 1 })} since ${fy(cu.rows[0])}` : null, "shareCount"),
              tile("Handed back last year", A.pct(cu.yieldNow), "Buybacks + dividends ÷ market value", "buybacks"))),
          h("div", { class: "table-wrap cash-table" }, h("table", { class: "sticky-first" },
            h("thead", {}, h("tr", {}, h("th", {}, ""), cu.rows.map((r) => h("th", {}, fy(r))))),
            h("tbody", {},
              h("tr", {}, h("td", {}, termBtn("freeCashflow", "Free cash flow")), cu.rows.map((r) => h("td", { class: r.freeCashflow < 0 ? "down" : "" }, A.money(r.freeCashflow)))),
              h("tr", {}, h("td", {}, termBtn("buybacks", "Buybacks")), cu.rows.map((r) => h("td", {}, isNum(r.buybacks) && r.buybacks ? A.money(-r.buybacks) : "—"))),
              h("tr", {}, h("td", {}, termBtn("dividendYield", "Dividends")), cu.rows.map((r) => h("td", {}, isNum(r.dividendsPaid) && r.dividendsPaid ? A.money(-r.dividendsPaid) : "—"))),
              h("tr", {}, h("td", {}, h("span", { class: "has-tip", "data-tip": "+ means it borrowed more than it repaid that year; − means it paid debt down.", "data-tip-title": "Debt, net" }, "Debt (+ borrowed, − repaid)")),
                cu.rows.map((r) => h("td", {}, signed(r.netDebtIssued)))),
              h("tr", {}, h("td", {}, "Acquisitions"), cu.rows.map((r) => h("td", {}, isNum(r.acquisitions) && r.acquisitions < 0 ? A.money(-r.acquisitions) : isNum(r.acquisitions) && r.acquisitions > 0 ? `sold ${A.money(r.acquisitions)}` : "—"))),
              h("tr", {}, h("td", {}, termBtn("shareCount", "Shares (diluted)")), cu.rows.map((r) => h("td", {}, isNum(r.dilutedShares) ? `${A.num(r.dilutedShares / 1e6, 0)}M` : "—")))))))));
    }

    const L = [["revenue", "Revenue", "revenue"], ["grossProfit", "Gross profit", "grossMargin"], ["operatingIncome", "Operating income", "operatingMargin"], ["netIncome", "Net income", "netMargin"],
      ["eps", "EPS (reported)", "adjustedEps"], ["unusualItems", "Unusual items", "unusualItems"], ["operatingCashflow", "Operating cash flow", "operatingCashflow"], ["capex", "Capex", "capex"],
      ["freeCashflow", "Free cash flow", "freeCashflow"], ["buybacks", "Buybacks", "buybacks"], ["dividendsPaid", "Dividends paid", "dividendYield"], ["rnd", "R&D", null], ["interestExpense", "Interest expense", null]];
    g.append(card("All the numbers", { area: "table", class: "span dense", sub: "Negative capex/buybacks/dividends = cash going out" },
      h("div", { class: "table-wrap" }, h("table", { class: "sticky-first" },
        h("thead", {}, h("tr", {}, h("th", {}, ""), cats.map((x) => h("th", {}, x)))),
        h("tbody", {}, L.filter(([k]) => rows.some((r) => isNum(r[k]))).map(([k, label, term]) =>
          h("tr", {}, h("td", {}, term ? termBtn(term, label) : label), rows.map((r) => h("td", { class: isNum(r[k]) && r[k] < 0 ? "down" : "" }, k === "eps" ? A.price(r[k]) : A.money(r[k]))))))))));
    fitDash();
  };
  draw();
}
