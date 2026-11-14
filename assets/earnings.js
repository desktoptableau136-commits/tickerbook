// Earnings tab.
import * as A from "./analysis.js";
import { lineChart, columnChart, legend } from "./charts.js";
import { card, dashMQ, grid, h, isNum, pill, qmark, rich, signClass, termBtn } from "./core.js";
import { rangeFigure } from "./summary.js";

// ---------------------------------------------------------------- earnings
const FILING_SUMMARY_8K = "Companies must file one within four business days of anything important. Item 9.01 (attached documents) is left out.";
export function tabEarnings(d, body) {
  const e = d.earnings;
  const story = A.earningsStory(d);
  const g = grid("earnings", true);
  body.append(g);

  const score = A.quarterScore(d);
  const IC = { good: "✓", bad: "✕", note: "!" };
  g.append(card("Last quarter in plain English", { area: "story", class: "span" },
    score ? h("div", { class: "qscore" },
      h("div", { class: "qscore-head" }, pill(score.tone, score.label),
        h("span", { class: "small ink2" }, `${score.good} of ${score.n} checks positive, ${score.bad} negative`)),
      h("div", { class: "qscore-checks" }, score.checks.map((c) => h("span", { class: `qchk ${c.kind}` },
        h("span", { class: "ic", "aria-hidden": "true" }, IC[c.kind]), h("span", { class: "muted" }, `${c.name}: `), h("b", {}, c.word))))) : null,
    story.length ? h("div", { class: "story" }, story.map((s) => h("div", { class: `story-line ${s.kind}` },
      h("span", { class: "ic", "aria-hidden": "true" }, { good: "✓", bad: "✕", note: "!", plain: "•" }[s.kind]),
      h("div", {}, rich(s.text), s.term ? qmark(s.term) : null)))) : h("p", { class: "muted" }, "No recent earnings report found."),
    (() => {
      const calls = (d.news || []).filter((n) => /earnings call|conference call|q[1-4]\s*(fy)?\s*20\d\d.*(earnings|results)|(earnings|results).*q[1-4]/i.test(n.title)).slice(0, 3);
      return calls.length ? h("div", { class: "call-links" }, h("h3", {}, "What was said on the call"),
        h("p", { class: "muted small", style: "margin:2px 0 6px" }, "Recent coverage of the earnings call, including management's outlook (guidance):"),
        calls.map((n) => h("a", { class: "call-link", href: n.url, target: "_blank", rel: "noopener noreferrer" }, n.title, h("span", { class: "muted small" }, ` · ${n.publisher || ""}`)))) : null;
    })(),
    h("p", { class: "muted small", style: "margin:12px 0 0" }, "Full call transcripts aren't in the free data. The company's investor relations page has the slides and replay. ",
      h("a", { href: "#/learn/earnings" }, "How to read an earnings report ›"))));

  const hist = e.history || [];
  if (hist.length) {
    const c = h("div", {});
    const anyLoss = hist.some((x) => x.epsActual < 0);
    g.append(card("Earnings per share vs estimates", { area: "eps", term: "epsSurprise", sub: `Bars are what they earned; the line is what analysts expected${anyLoss ? " · red = a loss" : ""}` },
      legend([{ name: "Actual EPS", color: "var(--series-1)" }, ...(anyLoss ? [{ name: "Loss", color: "var(--bad)" }] : []), { name: "Estimate", color: "var(--ink)", kind: "tick" }]), c));
    requestAnimationFrame(() => columnChart(c, {
      categories: hist.map((x) => A.date(x.date, { month: "short", year: "2-digit" })),
      series: [{ name: "Actual", values: hist.map((x) => x.epsActual), color: "var(--series-1)" }],
      markers: [{ name: "Estimate", values: hist.map((x) => x.epsEstimate), color: "var(--ink)" }],
      yFormat: (v, axis) => (axis ? `$${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}` : A.price(v)), height: dashMQ.matches ? 210 : 200,
      colorFor: (si, i, v) => (v < 0 ? "var(--bad)" : "var(--series-1)"),
      tipRows: (i) => [
        { color: "var(--series-1)", value: A.price(hist[i].epsActual), label: "actual" },
        { color: "var(--ink)", value: A.price(hist[i].epsEstimate), label: "estimate" },
        { value: A.oneOffMiss(d, hist[i]) ? "Miss caused by a one-off charge" : `${hist[i].surprise >= 0 ? "Beat" : "Missed"} by ${A.pct(Math.abs(hist[i].surprise))}` },
        { value: isNum(hist[i].reaction) ? `${A.pct(hist[i].reaction, { sign: true })}` : "—", label: "stock next session" },
      ],
      ariaLabel: "Actual EPS vs estimate by quarter",
    }));

    const recent = hist.slice(-8);
    const oneTip = (o) => `Missed by ${A.price(o.missPerShare)} a share. One-time items: ${o.items.map((it) => `${it.label.toLowerCase()} ${it.amount < 0 ? "−" : "+"}${A.money(Math.abs(it.amount))}`).join("; ") || A.money(o.total)}. ` +
      `After tax that's about ${A.price(o.perShare)} a share, which covers the miss. Analysts' estimates leave these out.`;
    const surprisePill = (x) => A.oneOffMiss(d, x)
      ? h("span", { class: "pill ok", "data-tip": oneTip(A.oneOffMiss(d, x)), "data-tip-title": `${A.pct(x.surprise, { sign: true })} on paper` }, h("span", { class: "ic", "aria-hidden": "true" }, "!"), "One-off")
      : h("span", { class: `pill ${x.surprise >= 0 ? "good" : "bad"}` }, h("span", { class: "ic", "aria-hidden": "true" }, x.surprise >= 0 ? "✓" : "✕"), A.pct(x.surprise, { sign: true }));
    const wide = h("div", { class: "table-wrap only-dash" }, h("table", { class: "wide-hist sticky-first" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), recent.map((x) => h("th", {}, A.date(x.date, { month: "short", year: "2-digit" }))))),
      h("tbody", {},
        h("tr", {}, h("td", {}, "Estimate"), recent.map((x) => h("td", {}, A.price(x.epsEstimate)))),
        h("tr", {}, h("td", {}, "Actual"), recent.map((x) => h("td", {}, h("b", {}, A.price(x.epsActual))))),
        h("tr", {}, h("td", {}, termBtn("epsSurprise", "Beat / miss")), recent.map((x) => h("td", {}, surprisePill(x)))),
        h("tr", {}, h("td", {}, termBtn("earningsReaction", "Stock next day")), recent.map((x) => h("td", { class: signClass(x.reaction) }, A.pct(x.reaction, { sign: true })))))));
    // the one-off quarters, explained: how big the charge was vs how big the miss was
    const offs = recent.map((x) => ({ x, o: A.oneOffMiss(d, x) })).filter((r) => r.o).reverse();
    const offBox = offs.length ? h("div", { class: "oneoffs" },
      h("h3", {}, termBtn("unusualItems", "The one-off quarters, explained")),
      h("p", { class: "muted small", style: "margin:2px 0 8px" }, "The size of the “miss” matches the size of the charge. The breakdown comes from the company's income statement."),
      h("div", { class: "oneoff-grid" }, offs.map(({ x, o }) => h("div", { class: "oneoff" },
        h("div", { class: "oneoff-head" }, h("b", {}, A.date(x.date, { month: "short", year: "numeric" })),
          h("span", { class: "small ink2 tnum" }, rich(`missed by **${A.price(o.missPerShare)}** · one-off cost ≈ **${A.price(o.perShare)}** a share after tax`))),
        h("div", { class: "oneoff-bars", role: "img", "aria-label": `Miss ${A.price(o.missPerShare)} vs charge ${A.price(o.perShare)} per share` },
          (() => { const mx = Math.max(o.missPerShare, o.perShare);
            return [["Miss", o.missPerShare, "var(--bad)"], ["One-off charge", o.perShare, "var(--warn)"]].map(([l, v, c]) =>
              h("div", { class: "ob" }, h("span", { class: "small muted" }, l), h("div", { class: "ob-track" }, h("div", { style: `width:${(v / mx) * 100}%;background:${c}` })), h("span", { class: "small tnum" }, A.price(v)))); })()),
        h("table", { class: "steps-table oneoff-items" }, h("tbody", {},
          o.items.map((it) => h("tr", {}, h("td", {}, it.label), h("td", { class: `tnum ${it.amount < 0 ? "down" : "up"}` }, `${it.amount < 0 ? "−" : "+"}${A.money(Math.abs(it.amount))}`))),
          h("tr", {}, h("td", {}, h("b", {}, "Total before tax")), h("td", { class: "tnum" }, h("b", {}, `${o.total < 0 ? "−" : "+"}${A.money(Math.abs(o.total))}`))),
          h("tr", {}, h("td", {}, `After tax${o.taxKnown ? "" : " (estimated at 21%)"} ÷ ${A.num(o.shares / 1e6, 0)}M shares`), h("td", { class: "tnum" }, `${A.price(o.perShare)} a share`)))),
        d.filing?.oneOffs?.length && d.filing.period && Math.abs(new Date(d.filing.filed) - new Date(x.date)) < 20 * 864e5
          ? h("p", { class: "small ink2", style: "margin:6px 0 0" }, h("b", {}, "What the company said: "), (() => { const tr = A.translateRelease(d.filing.oneOffs[0]); return tr ? rich(tr.text) : d.filing.oneOffs[0]; })()) : null)))) : null;
    const beats = recent.filter((x) => x.surprise > 0).length, oneOffs = recent.filter((x) => A.oneOffMiss(d, x)).length;
    const moves = recent.filter((x) => isNum(x.reaction)).map((x) => Math.abs(x.reaction));
    g.append(card("Report history", { area: "hist", term: "earningsReaction",
      sub: `Beat estimates ${beats} of the last ${recent.length} quarters${oneOffs ? ` (${oneOffs} miss${oneOffs > 1 ? "es were" : " was"} a one-off charge)` : ""}${moves.length ? ` · the stock typically moves ±${A.pct(moves.reduce((a, b) => a + b, 0) / moves.length)} the day after a report` : ""}` },
      wide,
      h("div", { class: "table-wrap no-dash" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Reported"), h("th", {}, "Estimate"), h("th", {}, "Actual"), h("th", {}, "Surprise"), h("th", {}, "Stock move"))),
        h("tbody", {}, [...hist].reverse().map((x) => h("tr", {},
          h("td", {}, A.date(x.date)),
          h("td", {}, A.price(x.epsEstimate)),
          h("td", {}, A.price(x.epsActual)),
          h("td", {}, surprisePill(x)),
          h("td", { class: signClass(x.reaction) }, A.pct(x.reaction, { sign: true }))))))), offBox));
  }

  // one press-release sentence: a plain-English point with a colored icon, the original tucked underneath
const PR_IC = { good: "✓", bad: "✕", note: "!", plain: "•" };
function releasePoint(q, fl) {
  const maxYear = Math.max(0, ...[...(fl.highlights || []), ...(fl.guidance || []), ...(fl.oneOffs || [])].map((x) => +((x.match(/fiscal year (20\d\d)/i) || [])[1] || 0)));
  const tr = A.translateRelease(q, { maxYear });
  return h("div", { class: `story-line pr ${tr ? tr.tone : "plain"}` },
    h("span", { class: "ic", "aria-hidden": "true" }, PR_IC[tr ? tr.tone : "plain"]),
    h("div", {},
      tr ? [h("span", { class: `pr-tag ${tr.tone}` }, tr.tag), " ", rich(tr.text)] : h("span", {}, q),
      tr ? h("details", { class: "pr-orig" }, h("summary", {}, "Their exact words"), h("p", {}, `“${q.replace(/^[“"]|[”"]$/g, "")}”`)) : null));
}

// the company's own press release (SEC 8-K), when fetch.py could get it
  const fl = d.filing;
  if (fl && (fl.guidance?.length || fl.highlights?.length || isNum(fl.adjustedEps))) {
    const last = hist[hist.length - 1];
    const same = last && Math.abs(new Date(fl.filed) - new Date(last.date)) < 20 * 864e5;
    const adjVs = same && isNum(fl.adjustedEps) && isNum(last.epsEstimate) ? fl.adjustedEps / last.epsEstimate - 1 : null;
    g.append(card("In the company's own words", { area: "filing", class: "span", term: "guidance",
      sub: `What it said in its earnings press release (filed ${A.date(fl.filed)}), translated into plain English. Open “their exact words” to see the original sentence.` },
      h("div", { class: "filing" },
        isNum(fl.adjustedEps) ? h("div", { class: "filing-adj" }, h("div", { class: "muted small" }, termBtn("adjustedEps", "Its own adjusted EPS")),
          h("div", { class: "big tnum" }, A.price(fl.adjustedEps)),
          isNum(adjVs) ? h("div", { class: "small" }, pill(adjVs >= 0 ? "good" : "bad", `${adjVs >= 0 ? "Beat" : "Missed"} the ${A.price(last.epsEstimate)} estimate by ${A.pct(Math.abs(adjVs))}`)) : null,
          h("p", { class: "muted small", style: "margin:6px 0 0" }, "Companies leave one-offs out of “adjusted” EPS. That's usually the number analysts compare against.")) : null,
        ...(() => {
          // press releases repeat themselves; show each translated point once
          const seen = new Set();
          return [["Headlines", fl.highlights], ["Plans and outlook", fl.guidance], ["One-time items", fl.oneOffs]].map(([title, xs]) => {
            const pts = (xs || []).filter((q) => {
              const tr = A.translateRelease(q, {}), key = tr ? tr.tag + (tr.text.match(/\$[\d.]+[BMK]?/) || [""])[0] : q;
              if (seen.has(key)) return false;
              seen.add(key); return true;
            });
            return pts.length ? h("div", {}, h("h3", {}, title), h("div", { class: "pr-list" }, pts.map((q) => releasePoint(q, fl)))) : null;
          });
        })()),
      h("a", { class: "small", href: fl.url, target: "_blank", rel: "noopener noreferrer" }, "Read the full press release on SEC.gov ›")));
  }

  // ---- the company's own filings
  const src = A.filingSources(d);
  if (src) {
    const fd = (x) => A.date(x, { month: "short", day: "numeric", year: "numeric" });
    const main = src.rows.filter((r) => r.kind !== "event"), events = src.rows.filter((r) => r.kind === "event");
    const link = (r, text) => h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, text);
    g.append(card("Read the originals", { area: "sources", class: "span", term: "secFilings",
      sub: "The company's own filings with the SEC, the US market regulator. This dashboard's numbers come from Yahoo Finance, which is unofficial; these are the source." },
      h("div", { class: "sources" },
        h("div", {}, main.map((r) => h("div", { class: "source" },
          h("div", {}, h("b", {}, link(r, `${r.name} (${r.form})`)), h("span", { class: "muted small" }, ` · filed ${fd(r.filed)}${r.period && r.kind !== "proxy" ? `, covering to ${fd(r.period)}` : ""}`)),
          h("p", { class: "small ink2" }, r.what)))),
        events.length ? h("div", {}, h("h3", {}, "Recent news filings (8-K)"),
          h("p", { class: "muted small", style: "margin:0 0 6px" }, FILING_SUMMARY_8K),
          events.map((r) => h("div", { class: "source" },
            h("div", {}, link(r, fd(r.filed)), r.serious ? h("span", {}, " ", pill("bad", "Worth a look")) : null),
            h("p", { class: "small ink2" }, r.said || "No item numbers listed.", r.items.length ? h("span", { class: "muted" }, ` (item${r.items.length > 1 ? "s" : ""} ${r.items.join(", ")})`) : null)))) : null),
      h("p", { class: "small", style: "margin:10px 0 0" },
        h("a", { href: src.edgar, target: "_blank", rel: "noopener noreferrer" }, "Every filing on SEC EDGAR ›"),
        d.profile?.website ? [" · ", h("a", { href: d.profile.website, target: "_blank", rel: "noopener noreferrer" }, "Company website (look for Investors) ›")] : null)));
  }

  const n = A.nextEarningsText(d);
  const nx = e.next;
  if (n) {
    g.append(card("Next report", { area: "next", right: n.days != null && n.days >= 0 ? h("span", { class: "tag plain" }, `in ${n.days} days`) : null },
      h("p", { style: "margin:0 0 8px" }, n.text),
      nx && isNum(nx.epsLow) && isNum(nx.epsHigh) ? h("div", {}, h("div", { class: "muted small" }, h("span", { class: "has-tip", "data-tip": "A wide range means analysts disagree, so a bigger surprise either way is more likely." }, "Range of analyst EPS estimates")),
        rangeFigure(Math.min(nx.epsLow, nx.epsEstimate ?? nx.epsLow), Math.max(nx.epsHigh, nx.epsEstimate ?? nx.epsHigh), nx.epsEstimate, { labels: [`Low ${A.price(nx.epsLow)}`, `High ${A.price(nx.epsHigh)}`] })) : null));
  }

  const P = { "0q": "This quarter", "+1q": "Next quarter", "0y": "This fiscal year", "+1y": "Next fiscal year" };
  if ((e.epsEstimate || []).length) {
    g.append(card("What analysts expect", { area: "expect", term: "consensus", sub: "Growth is vs the same period a year earlier" },
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Period"), h("th", {}, "EPS estimate"), h("th", {}, "Revenue estimate"))),
        h("tbody", {}, e.epsEstimate.filter((r) => P[r.period]).map((r) => {
          const rv = A.estRow(e.revenueEstimate, r.period);
          return h("tr", {}, h("td", {}, P[r.period], h("div", { class: "muted small" }, `${r.numberOfAnalysts ?? "?"} analysts`)),
            h("td", {}, h("b", {}, A.price(r.avg)), h("div", { class: `small ${signClass(r.growth)}` }, `${A.pct(r.growth, { sign: true })} YoY`)),
            h("td", {}, h("b", {}, A.money(rv.avg)), h("div", { class: `small ${signClass(rv.growth)}` }, `${A.pct(rv.growth, { sign: true })} YoY`)));
        }))))));
  }

  const t = A.estRow(e.epsTrend, "+1y"), t0 = A.estRow(e.epsTrend, "0y");
  if (isNum(t.current)) {
    const keys = ["90daysAgo", "60daysAgo", "30daysAgo", "7daysAgo", "current"];
    const labels = ["90d ago", "60d ago", "30d ago", "7d ago", "Now"];
    const c = h("div", {});
    const rv = A.estRow(e.epsRevisions, "+1y");
    g.append(card("Are estimates rising or falling?", { area: "trend", term: "estimateRevisions", sub: isNum(rv.upLast30days) ? `Last 30 days: ${rv.upLast30days} analysts raised next year's estimate, ${rv.downLast30days ?? 0} cut it` : "Consensus EPS estimate over the last 90 days" },
      legend([{ name: "Next fiscal year", color: "var(--series-1)", kind: "line" }, { name: "This fiscal year", color: "var(--series-2)", kind: "line" }]), c));
    requestAnimationFrame(() => lineChart(c, {
      dates: labels, area: false, height: 180, fill: true,
      series: [{ name: "Next fiscal year", values: keys.map((k) => t[k]), color: "var(--series-1)" }, { name: "This fiscal year", values: keys.map((k) => t0[k]), color: "var(--series-2)" }],
      yFormat: (v) => `$${v.toFixed(2)}`, xFormat: (s) => s, ariaLabel: "EPS estimate trend",
    }));
  }
}
