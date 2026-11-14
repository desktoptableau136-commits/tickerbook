// Valuation tab.
import * as A from "./analysis.js";
import { lineChart, legend } from "./charts.js";
import { arrow, card, grid, h, isNum, pill, rich, signClass, termBtn, tile, view } from "./core.js";

// ---------------------------------------------------------------- valuation
export function tabValuation(d, body) {
  const v = d.valuation, q = d.quote, f = d.fundamentals;
  const g = grid("valuation");
  body.append(g);
  const fcfYield = isNum(f.freeCashflow) && isNum(q.marketCap) ? f.freeCashflow / q.marketCap : null;

  const def = A.valuationInputs(d);
  const P = A.presets(def);
  const m = { ...def };
  const included = {};
  let firstRun = true;

  const resultBox = h("div", { class: "fv" });
  const scale = h("div", {});
  const methodsBox = h("div", { class: "methods" });
  const warnBox = h("div", {});
  const spreadBox = h("div", {});
  const sliders = [];
  const slider = (key, label, min, max, step, fmt, hint, term) => {
    const val = h("b", { class: "tnum" }, fmt(m[key]));
    const input = h("input", { type: "range", min, max, step, value: m[key], "aria-label": label,
      on: { input: (e) => { m[key] = +e.target.value; val.textContent = fmt(m[key]); calc(); } } });
    input.addEventListener("input", () => presetBtns.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false")));
    sliders.push({ key, input, val, fmt });
    return h("div", { class: "slider" }, h("label", {}, h("span", {}, term ? termBtn(term, label) : label), val), input, hint ? h("div", { class: "hint" }, hint) : null);
  };
  const setAll = (vals) => { Object.assign(m, vals); sliders.forEach((s) => { s.input.value = m[s.key]; s.val.textContent = s.fmt(m[s.key]); }); calc(); };

  const calc = () => {
    const methods = A.valuationMethods(d, m);
    if (firstRun) { methods.forEach((x) => (included[x.id] = x.include)); firstRun = false; }
    methods.forEach((x) => { if (!isNum(x.value)) included[x.id] = false; });
    const b = A.blend(methods, included);

    // headline
    resultBox.replaceChildren();
    if (!b) {
      resultBox.append(h("p", { class: "muted", style: "margin:0" }, "No method can be calculated with these inputs. Try including another method below."));
    } else {
      const gap = b.avg / q.price - 1;
      const [tone, word] = gap > 0.15 ? ["good", "Looks cheap"] : gap > -0.1 ? ["ok", "About fair"] : ["bad", "Looks expensive"];
      resultBox.append(
        h("div", { class: "muted small" }, `Fair value · average of ${b.n} method${b.n === 1 ? "" : "s"}`),
        h("div", { class: "big tnum" }, A.price(b.avg)),
        h("div", { class: `tnum ${signClass(gap)}`, style: "font-weight:650" }, `${arrow(gap)} ${A.pct(Math.abs(gap))} ${gap >= 0 ? "above" : "below"} today's price`),
        h("div", { style: "margin-top:6px" }, pill(tone, word)),
        b.n > 1 ? h("div", { class: "small ink2 tnum", style: "margin-top:4px" }, `Methods range ${A.price(b.low)} – ${A.price(b.high)}`) : null);
    }

    // scale: every method's value vs today's price
    scale.replaceChildren();
    const pts = methods.filter((x) => isNum(x.value));
    if (pts.length) {
      const all = [...pts.map((x) => x.value), q.price, ...(b ? [b.avg] : [])];
      const lo = Math.min(...all) * 0.92, hi = Math.max(...all) * 1.06;
      const pos = (x) => `${((x - lo) / (hi - lo)) * 100}%`;
      scale.append(h("div", { class: "vscale", role: "img", "aria-label": pts.map((x) => `${x.name} ${A.price(x.value)}`).join(", ") + `, today ${A.price(q.price)}` },
        h("div", { class: "vscale-track" }),
        b && b.n > 1 ? h("div", { class: "vscale-band", style: `left:${pos(b.low)};width:calc(${pos(b.high)} - ${pos(b.low)})` }) : null,
        ...pts.map((x, i) => h("div", { class: `vscale-dot ${included[x.id] ? "" : "off"}`, style: `left:${pos(x.value)};z-index:${(included[x.id] ? 20 : 1) + methods.indexOf(x)}`, "data-tip": `${A.price(x.value)}${included[x.id] ? "" : " (not in average)"}`, "data-tip-title": x.name }, String(methods.indexOf(x) + 1))),
        b ? h("div", { class: "vscale-avg", style: `left:${pos(b.avg)}`, "data-tip": A.price(b.avg), "data-tip-title": "Blended fair value" }) : null,
        h("div", { class: "vscale-price", style: `left:${pos(q.price)}` }, h("span", { class: (q.price - lo) / (hi - lo) < 0.15 ? "at-start" : (q.price - lo) / (hi - lo) > 0.85 ? "at-end" : "" }, `Today ${A.price(q.price)}`))),
        legend([{ name: "Method (number = row below)", color: "var(--series-1)" }, { name: "Left out", color: "var(--series-muted)" }, { name: "Fair value", color: "var(--series-2)" }, { name: "Today's price", color: "var(--ink)", kind: "line" }]));
    }

    // methods with their math
    methodsBox.replaceChildren(...methods.map((x, i) => {
      const can = isNum(x.value);
      const box = h("input", { type: "checkbox", "aria-label": `Include ${x.name} in the average`, ...(included[x.id] ? { checked: true } : {}), ...(can ? {} : { disabled: true }),
        on: { change: (e) => { included[x.id] = e.target.checked; calc(); } } });
      const gap = can ? x.value / q.price - 1 : x.display ? -1 : null;
      const tone = gap == null ? "na" : gap > 0.15 ? "good" : gap > -0.1 ? "ok" : "bad";
      return h("details", { class: `method ${included[x.id] ? "" : "excluded"}` },
        h("summary", {},
          h("label", { class: "method-check", on: { click: (e) => e.stopPropagation() } }, box),
          h("span", { class: "method-num" }, String(i + 1)),
          h("span", { class: "method-name" }, h("b", {}, x.name, x.floor ? h("span", { class: "tag plain mini" }, "floor") : !included[x.id] && can ? h("span", { class: "tag plain mini" }, "left out") : null), h("span", { class: "muted small" }, x.short)),
          h("span", { class: "method-val tnum" }, can ? A.price(x.value) : x.display || "n/a",
            gap != null ? h("span", { class: `mv ${tone}` }, h("span", { class: "ic", "aria-hidden": "true" }, gap >= 0 ? "▲" : "▼"), `${A.pct(Math.abs(gap), { digits: 0 })} ${gap >= 0 ? "above" : "below"}`) : null)),
        h("div", { class: "method-body" },
          x.plain ? h("p", { class: "method-plain" }, rich(x.plain)) : null,
          x.reason ? h("p", { class: "notice", style: "margin:0 0 8px" }, rich(x.reason)) : null,
          x.steps.length ? h("table", { class: "steps-table" }, h("tbody", {}, x.steps.map(([a, val]) => h("tr", {}, h("td", {}, a), h("td", { class: "tnum" }, val))))) : null,
          x.peers?.length ? (() => {
            const K = x.peerKey, cols = [["evToEbitda", "EV/EBITDA"], ["forwardPE", "Fwd P/E"]];
            const used = (p) => isNum(p[K]) && p[K] > 0 && p[K] < x.peerMax;
            const cell = (p, k) => k === K && !used(p) ? `${isNum(p[k]) ? A.times(p[k]) : "—"} (skipped)` : isNum(p[k]) && p[k] > 0 ? A.times(p[k]) : "—";
            return h("div", { class: "table-wrap", style: "margin-top:8px" }, h("table", { class: "steps-table peers-table" },
              h("thead", {}, h("tr", {}, h("th", {}, `Peers (${d.peers.industry || "same industry"})`), cols.map(([k, l]) => h("th", { class: k === K ? "used" : "" }, l)), h("th", {}, "Size"))),
              h("tbody", {},
                h("tr", { class: "self" }, h("td", {}, h("b", {}, `${d.symbol} (this one)`)), cols.map(([k]) => h("td", { class: "tnum" }, A.times(d.valuation?.[k]))), h("td", { class: "tnum" }, A.money(q.marketCap))),
                x.peers.map((p) => h("tr", { class: used(p) ? "" : "unused" }, h("td", {}, p.symbol, h("span", { class: "muted" }, ` · ${p.name}`)),
                  cols.map(([k]) => h("td", { class: `tnum${k === K ? " used" : ""}` }, cell(p, k))), h("td", { class: "tnum" }, A.money(p.marketCap)))))),
              h("p", { class: "muted small", style: "margin:4px 0 0" }, `Peers are the largest companies Yahoo lists in the same industry. Multiples above ${x.peerMax}× or below zero (one-off losses, holding companies) are skipped.`));
          })() : null,
          isNum(x.implied) ? h("p", { class: "small ink2", style: "margin:8px 0 0" }, termBtn("impliedGrowth", "Reverse check:"),
            ` today's price of ${A.price(q.price)} is exactly "fair" under this method if growth is ${A.pct(x.implied, { digits: 1 })} a year` +
            (isNum(def.analystGrowth) ? ` (analysts expect ~${A.pct(def.analystGrowth, { digits: 0 })}).` : ".")) : null));
    }));

    // warnings
    const w = A.modelWarnings(d, m, b?.avg);
    if (false) w.unshift(`The methods disagree a lot (${A.price(b.low)} to ${A.price(b.high)}). Open each one below to see which assumption drives the difference. Usually it's how long you believe the cash flows will last.`);
    const conf = A.confidence(b), why = A.explainSpread(d, methods, included, m);
    spreadBox.replaceChildren();
    if (conf) spreadBox.append(h("div", { class: `spread ${conf.tone}` },
      h("div", { class: "spread-head" }, pill(conf.tone, conf.label), h("span", { class: "small ink2" }, rich(conf.text))),
      why.length ? h("ul", { class: "spread-why" }, why.map((t) => h("li", {}, rich(t)))) : null));
    const dp = A.debtPicture(d, def);
    warnBox.replaceChildren(...w.filter((t) => !(dp && dp.tone === "bad" && t.startsWith("Heavy debt"))).map((t) => h("div", { class: "story-line note small" }, h("span", { class: "ic", "aria-hidden": "true" }, "!"), h("div", {}, t))));
  };

  const scnTip = (k) => `Growth ${A.pct(P[k].growth, { digits: 0 })} a year · exit P/E ${A.num(P[k].exitPE, 1)}× · required return ${A.pct(P[k].discount, { digits: 1 })} · growth after year 5 ${A.pct(P[k].terminal, { digits: 1 })}`;
  const presetBtns = h("div", { class: "presets", role: "group", "aria-label": "Scenario" },
    [["bear", "Bear", "things go worse"], ["base", "Base", "as expected"], ["bull", "Bull", "things go better"]].map(([k, l, sub]) =>
      h("button", { class: "chip", type: "button", "aria-pressed": String(k === "base"), "data-k": k, "data-tip": scnTip(k), "data-tip-title": `${l} case`,
        on: { click: () => { setAll(P[k]); presetBtns.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.k === k))); } } },
        h("b", {}, l), h("span", { class: "chip-sub" }, sub))));

  const assumptions = h("details", { class: "tune" },
    h("summary", {}, h("b", {}, "Fine-tune the assumptions"), h("span", { class: "muted small" }, " · optional · shared by every method · the scenario buttons set them for you")),
    h("div", { class: "tune-grid" },
    slider("growth", "Growth per year", 0, 0.35, 0.01, (x) => A.pct(x, { digits: 0 }),
      isNum(def.analystGrowth) ? `Analysts' 2-year view: ${A.pct(def.analystGrowth, { digits: 0 })}${def.analystGrowth > 0.15 ? " (default capped at 15%; fast growth rarely lasts)" : ""}` : null),
    slider("exitPE", "Exit P/E (method 1)", 2, 45, 0.5, (x) => `${A.num(x, 1)}×`, `Market pays ${A.times(def.currentPE)} today · typical stock ~17–20`, "exitPE"),
    slider("discount", "Required return", 0.06, 0.16, 0.005, (x) => A.pct(x, { digits: 1 }), def.heavyDebt ? "Default 12%: the usual 10% plus 2% for heavy debt" : "What you want to earn per year for the risk", "discountRate"),
    slider("terminal", "Growth after year 5 (method 2)", 0, 0.04, 0.005, (x) => A.pct(x, { digits: 1 }), "Long-run growth forever, usually near inflation (2–3%)"),
    slider("years", "Years projected", 3, 10, 1, (x) => `${x} years`)));

  const nMethods = A.valuationMethods(d, def).length;
  const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  g.append(card(`What's it worth? ${WORDS[nMethods] ? WORDS[nMethods][0].toUpperCase() + WORDS[nMethods].slice(1) : nMethods} ways to estimate it`, { area: "calc", class: "span", term: "fairValue",
    sub: "Each method asks “what is this stock worth?” a different way. Ticked methods are averaged into the fair value." },
    h("div", { class: "calc" },
      h("div", { class: "calc-top" }, resultBox,
        h("div", { class: "calc-scn" },
          h("div", { class: "scn-label" }, h("b", {}, "Scenario"), h("span", { class: "muted small" }, " · hover for the numbers")), presetBtns, scale)),
      spreadBox,
      h("h3", { style: "margin-top:2px" }, `The ${WORDS[nMethods] || nMethods} methods `, h("span", { class: "muted small", style: "font-weight:400" }, "· open one to see its math")), methodsBox, warnBox,
      assumptions,
      h("p", { class: "muted small", style: "margin:0" }, "Simplified models: no dividends, steady growth. Use them to see what the price assumes, not as a target."))));
  requestAnimationFrame(calc);

  const dpic = A.debtPicture(d, def);
  if (dpic) g.append(card("How the debt is counted", { area: "debt", term: "netDebtToEbitda", right: pill(dpic.tone, dpic.label) },
    h("ul", { class: "spread-why debt-why" }, dpic.lines.map((t) => h("li", {}, rich(t))))));
  g.append(card("Valuation ratios", { area: "ratios", sub: "Different ways of asking 'how much am I paying?'" },
    h("div", { class: "tiles" },
      tile("P/E (trailing)", A.times(v.trailingPE), null, "pe"),
      tile("Forward P/E", A.times(v.forwardPE), null, "forwardPE"),
      tile("PEG", A.num(v.peg, 2), null, "peg"),
      tile("Price / sales", A.times(v.priceToSales), null, "priceToSales"),
      tile("EV / EBITDA", A.times(v.evToEbitda), null, "evToEbitda"),
      tile("FCF yield", A.pct(fcfYield), "Free cash flow ÷ market cap", "freeCashflow"),
      tile("Price / book", A.times(v.priceToBook), null, "priceToBook"),
      tile("Dividend yield", v.dividendYield ? A.pct(v.dividendYield, { digits: 2 }) : "None", isNum(v.payoutRatio) && v.payoutRatio > 0 ? `Pays out ${A.pct(v.payoutRatio, { digits: 0 })} of profit` : null, "dividendYield"))));

  const hist = d.history || [];
  if (hist.length >= 5) {
    const c = h("div", {});
    const gaps = A.snapshotGaps(hist), gapAt = new Set(gaps.map((x) => x.next));
    // an empty point before each gap's far side breaks the line instead of drawing across the hole
    const pts = hist.flatMap((x) => (gapAt.has(x.date) ? [{ date: x.date, forwardPE: null }, x] : [x]));
    g.append(card("Forward P/E over time", { area: "hist", term: "forwardPE", sub: gaps.length ? `From this dashboard's daily snapshots · line breaks at ${gaps.length === 1 ? "a gap" : `${gaps.length} gaps`}` : "From this dashboard's daily snapshots" }, c));
    requestAnimationFrame(() => lineChart(c, { dates: pts.map((x) => x.date), series: [{ name: "Forward P/E", values: pts.map((x) => x.forwardPE), color: "var(--series-1)" }],
      yFormat: (x) => `${x.toFixed(1)}×`, xFormat: (s) => A.date(s, { month: "short", day: "numeric" }), tipTitle: (s) => A.date(s), height: 180, fill: true, area: false }));
  } else {
    g.append(card("Valuation history", { area: "hist", sub: "Building up" },
      h("p", { class: "ink2", style: "margin:0" }, `Free data doesn't include past P/E or analyst estimates, so this dashboard saves its own snapshot every trading day. In a couple of weeks you'll see ${d.symbol}'s valuation trend here (${hist.length} snapshot${hist.length === 1 ? "" : "s"} so far).`)));
  }
}
