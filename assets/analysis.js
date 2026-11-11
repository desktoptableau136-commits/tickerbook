// Formatting, the signal scorecard, plain-English narratives and the fair-value model.
// Everything here is pure: data in, numbers/sentences out.

// ------------------------------------------------------------------ formatting

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function money(v, { compact = true, digits } = {}) {
  if (!isNum(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (compact) {
    if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(digits ?? 2)}T`;
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(digits ?? (a >= 1e11 ? 0 : 1))}B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(digits ?? 0)}M`;
  }
  return `${s}$${a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const price = (v) => money(v, { compact: false });

export function pct(v, { digits = 1, sign = false } = {}) {
  if (!isNum(v)) return "—";
  const p = v * 100;
  const str = Math.abs(p).toFixed(digits);
  const zero = Number(str) === 0;
  const s = zero ? "" : p < 0 ? "−" : sign && p > 0 ? "+" : "";
  return `${s}${str}%`;
}

export function times(v, digits = 1) {
  return isNum(v) ? `${v.toFixed(digits)}×` : "—";
}

export function num(v, digits = 2) {
  if (!isNum(v)) return "—";
  const s = v < 0 ? "−" : "";
  return s + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function date(d, opts = { month: "short", day: "numeric", year: "numeric" }) {
  if (!d) return "—";
  const dt = new Date(d.length === 10 ? d + "T12:00:00" : d);
  return dt.toLocaleDateString("en-US", opts);
}

export function quarterLabel(period) {
  const dt = new Date(period + "T12:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '");
}

export function daysUntil(d) {
  if (!d) return null;
  const ms = new Date(d + "T12:00:00") - new Date();
  return Math.round(ms / 86400000);
}

export function ago(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

// ------------------------------------------------------------------ data helpers

export const estRow = (rows, period) => (rows || []).find((r) => r.period === period) || {};

export function priceChange(d, tradingDays) {
  const c = d.prices?.close || [];
  if (c.length <= tradingDays) return null;
  return c[c.length - 1] / c[c.length - 1 - tradingDays] - 1;
}

export function expectedGrowth(d) {
  const next = estRow(d.earnings?.epsEstimate, "+1y").growth;
  const ltg = estRow(d.earnings?.growth, "LTG").stockTrend;
  return isNum(ltg) ? ltg : isNum(next) ? next : null;
}

function lastQuarterBeats(d) {
  const h = (d.earnings?.history || []).slice(-4);
  return { n: h.length, beats: h.filter((x) => isNum(x.surprise) && x.surprise > 0).length };
}

// ------------------------------------------------------------------ signals

// status: "good" | "ok" | "bad" | "na". `word` is the short label shown in the pill.
function sig(key, label, status, word, value, text, termKey) {
  return { key, label, status, word, value, text, term: termKey };
}

export function equitySignals(d) {
  const v = d.valuation || {}, f = d.fundamentals || {}, q = d.quote || {}, a = d.analysts || {};
  const out = [];

  // 1. Valuation vs growth
  const g = expectedGrowth(d);
  const fpe = v.forwardPE;
  const peg = isNum(fpe) && isNum(g) && g > 0 ? fpe / (g * 100) : v.peg;
  if (!isNum(fpe) || fpe <= 0) {
    out.push(sig("valuation", "Valuation", "na", "Unclear", "—",
      "No meaningful forward P/E (expected earnings are negative or missing), so we can't judge price against profit.", "forwardPE"));
  } else {
    const st = !isNum(peg) ? (fpe < 18 ? "good" : fpe < 30 ? "ok" : "bad") : peg < 1.2 ? "good" : peg < 2 ? "ok" : "bad";
    const word = { good: "Reasonable", ok: "Fair", bad: "Pricey" }[st];
    const gTxt = isNum(g) ? ` with about ${pct(g, { digits: 0 })} expected yearly earnings growth` : "";
    const meaning = {
      good: "You're not paying much for the growth on offer. If the estimates hold, there's room for the stock to rise.",
      ok: "The price looks roughly in line with expected growth. Returns will mostly depend on the company delivering.",
      bad: "The price already assumes a lot of growth. Any disappointment could hit the stock hard.",
    }[st];
    const low = fpe < 6 ? " A forward P/E this low is unusual; it often means the market doubts the estimates." : "";
    const lev = leverage(d);
    if (st === "good" && lev && lev.ratio > 3.5) {
      out.push(sig("valuation", "Valuation", "ok", "Cheap, but risky", `${times(fpe)} fwd P/E${isNum(peg) ? ` · PEG ${num(peg, 1)}` : ""}`,
        `Trading at only ${times(fpe)} next year's expected earnings${gTxt}, which looks cheap. But the company carries heavy debt (${num(lev.ratio, 1)}× EBITDA), so its earnings are riskier than the P/E suggests. Low prices on heavily indebted companies are often the market pricing in that risk.`, "peg"));
    } else {
      out.push(sig("valuation", "Valuation", st, word, `${times(fpe)} fwd P/E${isNum(peg) ? ` · PEG ${num(peg, 1)}` : ""}`,
        `Trading at ${times(fpe)} next year's expected earnings${gTxt}. ${meaning}${low}`, "peg"));
    }
  }

  // 2. Growth
  const rg = f.revenueGrowth;
  if (isNum(rg)) {
    const st = rg >= 0.1 ? "good" : rg >= 0.03 ? "ok" : "bad";
    out.push(sig("growth", "Sales growth", st, { good: "Growing fast", ok: "Steady", bad: "Weak" }[st], `${pct(rg, { sign: true })} YoY`,
      {
        good: `Revenue grew ${pct(rg)} vs a year ago. Customers are spending more, which supports future profit growth.`,
        ok: `Revenue grew ${pct(rg)} vs a year ago: positive but modest. Profit growth will lean on cost control or buybacks.`,
        bad: `Revenue ${rg < 0 ? "fell" : "barely grew"} (${pct(rg, { sign: true })} vs a year ago). Shrinking or flat sales make it hard to grow profits long term.`,
      }[st], "revenueGrowth"));
  }

  // 3. Profitability
  const om = f.operatingMargin;
  if (isNum(om)) {
    const st = om >= 0.2 ? "good" : om >= 0.1 ? "ok" : "bad";
    const fcf = isNum(f.freeCashflow) ? ` It produced ${money(f.freeCashflow)} of free cash flow over the last year.` : "";
    out.push(sig("profit", "Profitability", st, { good: "High margins", ok: "Decent", bad: "Thin margins" }[st], `${pct(om)} op. margin`,
      `Keeps about ${Math.round(om * 100)}¢ of operating profit from every $1 of sales.${fcf} ${{
        good: "Strong margins mean pricing power and cash to reinvest.",
        ok: "Healthy, though not exceptional.",
        bad: "Thin margins leave little cushion if costs rise or sales slow.",
      }[st]}`, "operatingMargin"));
  }

  // 4. Balance sheet
  const nd = isNum(f.debt) && isNum(f.cash) ? f.debt - f.cash : f.netDebt;
  if (isNum(nd) && isNum(f.ebitda) && f.ebitda > 0) {
    const lev = nd / f.ebitda;
    const st = lev < 1.5 ? "good" : lev < 3.5 ? "ok" : "bad";
    out.push(sig("health", "Debt load", st, { good: "Strong", ok: "Manageable", bad: "Heavy debt" }[st],
      lev < 0 ? "Net cash" : `${times(lev)} net debt/EBITDA`,
      lev < 0
        ? `Has more cash (${money(f.cash)}) than debt (${money(f.debt)}). A very safe balance sheet that gives flexibility in downturns.`
        : `Owes ${money(nd)} more than it holds in cash: about ${num(lev, 1)} years of EBITDA. ${{
            good: "Comfortable. Debt isn't a meaningful risk here.",
            ok: "Manageable, but worth watching if business slows.",
            bad: "High. Interest costs eat into profit, and there's little room for error if rates stay high or business weakens.",
          }[st]}`, "netDebtToEbitda"));
  }

  // 5. Earnings track record
  const { n, beats } = lastQuarterBeats(d);
  if (n) {
    const st = beats === n ? "good" : beats >= n / 2 ? "ok" : "bad";
    out.push(sig("track", "Earnings record", st, { good: "Reliable", ok: "Mixed", bad: "Misses" }[st], `${beats} of ${n} beats`,
      `Beat analyst EPS estimates in ${beats} of the last ${n} quarters. ${{
        good: "Management sets expectations it can clear, which is good for confidence.",
        ok: "Some misses. Results are less predictable than the best companies'.",
        bad: "Frequently falls short of expectations, a sign the business is harder to forecast or under pressure.",
      }[st]}`, "epsSurprise"));
  }

  // 6. Estimate momentum
  const t1 = estRow(d.earnings?.epsTrend, "+1y");
  const r1 = estRow(d.earnings?.epsRevisions, "+1y");
  if (isNum(t1.current) && isNum(t1["90daysAgo"]) && t1["90daysAgo"] !== 0) {
    const ch = t1.current / t1["90daysAgo"] - 1;
    const st = ch > 0.01 ? "good" : ch > -0.01 ? "ok" : "bad";
    const rv = isNum(r1.upLast30days) ? ` In the last 30 days, ${r1.upLast30days} analysts raised and ${r1.downLast30days ?? 0} cut.` : "";
    out.push(sig("revisions", "Estimate trend", st, { good: "Rising", ok: "Flat", bad: "Falling" }[st], `${pct(ch, { sign: true })} in 90 days`,
      `Next year's EPS estimate has moved ${pct(ch, { sign: true })} over 90 days (to ${price(t1.current)}).${rv} ${{
        good: "Analysts keep finding the business better than expected, historically a good sign for the stock.",
        ok: "Expectations are stable.",
        bad: "Analysts are cutting forecasts. That pressure often weighs on the stock until it stops.",
      }[st]}`, "estimateRevisions"));
  }

  // 7. Analyst view
  const tg = a.targets || {}, tMid = isNum(tg.median) ? tg.median : tg.mean;
  if (isNum(tMid) && isNum(q.price)) {
    const up = tMid / q.price - 1;
    const st = up > 0.15 ? "good" : up > 0 ? "ok" : "bad";
    const rating = (a.recommendationKey || "").replace("_", " ");
    out.push(sig("analysts", "Analyst view", st, { good: "Upside", ok: "Modest upside", bad: "Below target" }[st], `${pct(up, { sign: true })} to target`,
      `${a.count ?? "Several"} analysts' middle (median) 12-month target is ${price(tMid)}, ${pct(Math.abs(up))} ${up >= 0 ? "above" : "below"} today's price` +
        `${rating ? `; consensus rating "${rating}"` : ""}. Targets follow sentiment, so use this as a mood check, not a forecast.`, "priceTarget"));
  }

  // 8. Price trend
  if (isNum(q.ma200) && isNum(q.price)) {
    const vs = q.price / q.ma200 - 1;
    const st = vs >= 0 ? "good" : vs > -0.1 ? "ok" : "bad";
    out.push(sig("trend", "Price trend", st, { good: "Uptrend", ok: "Soft", bad: "Downtrend" }[st], `${pct(vs, { sign: true })} vs 200-day avg`,
      {
        good: `Trading ${pct(vs)} above its 200-day average. The longer-term trend is up.`,
        ok: `Slightly below its 200-day average (${pct(vs, { sign: true })}). The trend has cooled.`,
        bad: `Well below its 200-day average (${pct(vs, { sign: true })}). The market has been selling. That can be a bargain if the business is sound, or a warning if it isn't. The other signals help you tell which.`,
      }[st], "ma200"));
  }

  return out;
}

export function fundSignals(d, watchSymbols = []) {
  const f = d.fund || {}, q = d.quote || {};
  const out = [];

  if (isNum(f.expenseRatio)) {
    const st = f.expenseRatio <= 0.001 ? "good" : f.expenseRatio <= 0.005 ? "ok" : "bad";
    const per10k = f.expenseRatio * 10000;
    out.push(sig("cost", "Cost", st, { good: "Very cheap", ok: "Reasonable", bad: "Expensive" }[st], `${pct(f.expenseRatio, { digits: 2 })} / yr`,
      `Costs about $${per10k.toFixed(per10k < 10 ? 0 : 0)} a year per $10,000 invested${isNum(f.categoryExpenseRatio) ? ` vs ~$${Math.round(f.categoryExpenseRatio * 10000)} for similar funds` : ""}. Low fees leave more of the return for you.`, "expenseRatio"));
  }

  if (isNum(f.trailingPE)) {
    const st = f.trailingPE < 18 ? "good" : f.trailingPE < 23 ? "ok" : "bad";
    out.push(sig("valuation", "Market valuation", st, { good: "Below average", ok: "Above average", bad: "Rich" }[st], `${times(f.trailingPE)} P/E`,
      `The companies in this fund trade at ${times(f.trailingPE)} their past year's earnings vs a long-run average around 16–18. ${{
        good: "Stocks are reasonably priced by historical standards.",
        ok: "A bit above average, which is normal in a growing economy.",
        bad: "Expensive by historical standards. Future returns may be lower than the last decade's, though markets can stay pricey for years. Investing a fixed amount regularly (dollar-cost averaging) softens timing risk.",
      }[st]}`, "pe"));
  }

  const h = f.holdings || [];
  if (h.length) {
    const top = h.reduce((s, x) => s + (x.weight || 0), 0);
    const st = top < 0.3 ? "good" : top < 0.45 ? "ok" : "bad";
    const overlap = h.filter((x) => watchSymbols.some((w) => w.replace("GOOGL", "GOOG") === x.symbol.replace("GOOGL", "GOOG")));
    const ov = overlap.length ? ` Note: you already follow ${[...new Set(overlap.map((x) => x.symbol.replace("GOOGL", "GOOG")))].join(" and ")}, which ${overlap.length > 1 ? "are" : "is"} also in this fund.` : "";
    out.push(sig("concentration", "Diversification", st, { good: "Broad", ok: "Top-heavy", bad: "Concentrated" }[st], `Top 10 = ${pct(top, { digits: 0 })}`,
      `The 10 largest holdings make up ${pct(top, { digits: 0 })} of the fund.${st !== "good" ? " Big tech drives a large share of its moves." : ""}${ov}`, "concentration"));
  }

  if (isNum(f.fiveYearReturn)) {
    const st = f.fiveYearReturn >= 0.08 ? "good" : f.fiveYearReturn >= 0.04 ? "ok" : "bad";
    out.push(sig("returns", "Long-term returns", st, { good: "Strong", ok: "Modest", bad: "Weak" }[st], `${pct(f.fiveYearReturn)} / yr (5y)`,
      `Averaged ${pct(f.fiveYearReturn)} a year over 5 years${isNum(f.threeYearReturn) ? ` and ${pct(f.threeYearReturn)} over 3 years` : ""}. The stock market's very long-run average is about 10% a year. Past returns don't predict future ones.`, "indexFund"));
  }

  if (isNum(q.ma200) && isNum(q.price)) {
    const vs = q.price / q.ma200 - 1;
    const st = vs >= 0 ? "good" : vs > -0.1 ? "ok" : "bad";
    out.push(sig("trend", "Price trend", st, { good: "Uptrend", ok: "Soft", bad: "Downtrend" }[st], `${pct(vs, { sign: true })} vs 200-day avg`,
      st === "good" ? "The market is above its 200-day average: the longer-term trend is up."
        : "The market is below its 200-day average. Long-term index investors have historically done well buying during dips.", "ma200"));
  }

  return out;
}

export function overall(signals) {
  const scored = signals.filter((s) => s.status !== "na");
  if (!scored.length) return { score: null, lean: "Not enough data", tone: "na" };
  const pts = scored.reduce((t, s) => t + (s.status === "good" ? 1 : s.status === "ok" ? 0.5 : 0), 0);
  const score = Math.round((pts / scored.length) * 100);
  const good = scored.filter((s) => s.status === "good").length;
  const bad = scored.filter((s) => s.status === "bad").length;
  const lean = score >= 70 ? "Looks strong" : score >= 45 ? "Mixed picture" : "Proceed with caution";
  const tone = score >= 70 ? "good" : score >= 45 ? "ok" : "bad";
  return { score, lean, tone, good, bad, total: scored.length };
}

// ------------------------------------------------------------------ narratives

export function earningsStory(d) {
  const hist = d.earnings?.history || [];
  const h = hist[hist.length - 1];
  if (!h) return [];
  const name = shortName(d);
  const out = [];
  const beat = isNum(h.surprise) && h.surprise > 0;
  const one = oneOffMiss(d, h);
  out.push({
    kind: one ? "note" : beat ? "good" : "bad",
    text: `On ${date(h.date)}, ${name} reported ${price(h.epsActual)} earnings per share vs the ${price(h.epsEstimate)} analysts expected` +
      (one ? `. On paper that's a ${price(one.missPerShare)} miss, but **a one-time charge cost about ${price(one.perShare)} a share** after tax (see the next point).`
        : `: ${beat ? "a beat" : "a miss"} of ${pct(Math.abs(h.surprise))}.`),
  });

  const qs = d.financials?.quarterly || [];
  const last = qs[qs.length - 1];
  const yearAgo = qs.length >= 5 ? qs[qs.length - 5] : null;
  if (last && isNum(last.unusualItems) && Math.abs(last.unusualItems) > 0.15 * Math.max(Math.abs(last.netIncome || 0), Math.abs(last.revenue || 0) * 0.05)) {
    const neg = last.unusualItems < 0;
    out.push({
      kind: "note",
      term: "unusualItems",
      text: `That includes about **${money(Math.abs(last.unusualItems))} of one-time ${neg ? "charges" : "gains"}**${(() => { const o = oneOffs(last); return o?.items.length ? `, mostly ${o.items[0].label.toLowerCase()} (${money(Math.abs(o.items[0].amount))})` : " (write-downs, restructuring and similar)"; })()}. ` +
        (neg && last.netIncome < 0 && Math.abs(last.unusualItems) > Math.abs(last.netIncome)
          ? `Those charges were bigger than the entire ${money(Math.abs(last.netIncome))} loss, so the underlying business was likely still profitable. The reported "miss" is mostly accounting, not a collapse in sales.`
          : neg ? "The underlying business did better than the headline EPS suggests." : "The headline profit is flattered by them.") +
        (one ? " Analysts' estimates leave charges like this out: write-downs often follow big events such as an acquisition, but their size is only decided when the books close, so nobody can forecast them." : ""),
    });
  }

  if (last) {
    let t = `Revenue was ${money(last.revenue)}`;
    if (yearAgo && isNum(yearAgo.revenue)) {
      const g = last.revenue / yearAgo.revenue - 1;
      t += `, ${g >= 0 ? "up" : "down"} ${pct(Math.abs(g))} from a year earlier`;
    }
    const om = isNum(last.operatingIncome) ? last.operatingIncome / last.revenue : null;
    const omY = yearAgo && isNum(yearAgo.operatingIncome) ? yearAgo.operatingIncome / yearAgo.revenue : null;
    if (isNum(om)) {
      t += `. Operating margin was ${pct(om)}`;
      if (isNum(omY)) t += ` (${om >= omY ? "up" : "down"} from ${pct(omY)})`;
    }
    out.push({ kind: "plain", text: t + "." });
  }

  if (isNum(h.reaction)) {
    const r = h.reaction;
    let read;
    if (beat && r < -0.02) read = "Falling after a beat usually means the outlook (guidance) or some detail of the report disappointed, or expectations were even higher than the official estimates.";
    else if (!beat && r > 0.02) read = "Rising after a miss usually means the results were better than feared, or the outlook was encouraging.";
    else if (beat && r > 0.02) read = "The market liked what it heard.";
    else if (!beat && r < -0.02) read = "The market took the miss badly.";
    else read = "A muted reaction: the report roughly matched what investors expected.";
    out.push({ kind: r >= 0 ? "good" : "bad", term: "earningsReaction", text: `The stock moved ${pct(r, { sign: true })} in the next trading session. ${read}` });
  }

  const t1 = estRow(d.earnings?.epsTrend, "+1y");
  const r1 = estRow(d.earnings?.epsRevisions, "+1y");
  if (isNum(t1.current) && isNum(t1["30daysAgo"])) {
    const ch = t1.current / t1["30daysAgo"] - 1;
    out.push({
      kind: ch > 0.005 ? "good" : ch < -0.005 ? "bad" : "plain",
      term: "estimateRevisions",
      text: `Since then, analysts have ${ch > 0.005 ? "raised" : ch < -0.005 ? "cut" : "barely changed"} next year's EPS estimate (${pct(ch, { sign: true })} in 30 days, to ${price(t1.current)})` +
        (isNum(r1.upLast30days) ? `, with ${r1.upLast30days} raising and ${r1.downLast30days ?? 0} cutting` : "") +
        `. ${ch > 0.005 ? "That suggests they read the report as better than the headline." : ch < -0.005 ? "That suggests the outlook got worse." : ""}`.trim(),
    });
  }
  return out;
}

export function nextEarningsText(d) {
  const n = d.earnings?.next;
  if (!n) return null;
  const days = daysUntil(n.date);
  const when = `${date(n.date)}${n.time ? `, ${n.time}` : ""}`;
  const est = isNum(n.epsEstimate) ? ` Analysts expect ${price(n.epsEstimate)} EPS` : "";
  const rev = isNum(n.revenueEstimate) ? ` on ${money(n.revenueEstimate)} revenue` : "";
  return {
    days, when, isEstimate: n.isEstimate,
    text: `${when}${n.isEstimate ? " (date not yet confirmed)" : ""}.${est}${rev}${est ? "." : ""}`,
  };
}

export function shortName(d) {
  return (d.name || d.symbol).replace(/,? (Inc\.?|Corporation|Corp\.?|Incorporated|Holdings?|Ltd\.?|plc|Co\.)$/i, "").replace(/ Class [A-C]$/i, "");
}

// ------------------------------------------------------------------ fair-value model

// Price today = (EPS in N years × exit P/E) ÷ (1 + required return)^N
export function fairValue({ eps, growth, years, exitPE, discount }) {
  if (!isNum(eps) || eps <= 0) return null;
  const future = eps * Math.pow(1 + growth, years) * exitPE;
  return future / Math.pow(1 + discount, years);
}

export function impliedGrowth(priceNow, { eps, years, exitPE, discount }) {
  if (!isNum(eps) || eps <= 0 || !isNum(priceNow)) return null;
  // solve fairValue(g) = price by bisection over -50%..+100%
  let lo = -0.5, hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fv = fairValue({ eps, growth: mid, years, exitPE, discount });
    if (fv > priceNow) hi = mid; else lo = mid;
  }
  const g = (lo + hi) / 2;
  return g > 0.99 || g < -0.49 ? null : g;
}

// Growth analysts expect over the next two fiscal years, averaged (compounded) so a
// one-year rebound after a weak year doesn't get treated as the long-run rate.
export function twoYearGrowth(d) {
  const ltg = estRow(d.earnings?.growth, "LTG").stockTrend;
  if (isNum(ltg)) return ltg;
  const g0 = estRow(d.earnings?.epsEstimate, "0y").growth, g1 = estRow(d.earnings?.epsEstimate, "+1y").growth;
  if (isNum(g0) && isNum(g1)) return Math.sqrt((1 + g0) * (1 + g1)) - 1;
  return isNum(g1) ? g1 : isNum(g0) ? g0 : null;
}

export function modelDefaults(d) {
  const e0 = estRow(d.earnings?.epsEstimate, "0y").avg;
  const eps = isNum(e0) && e0 > 0 ? e0 : d.fundamentals?.epsForward;
  // Default growth: analysts' 2-year view, capped at 15% (fast growth rarely lasts 5+ years)
  let g = twoYearGrowth(d);
  g = isNum(g) ? Math.min(Math.max(g, 0), 0.15) : 0.06;
  // Default exit P/E: the multiple the market pays TODAY on the same EPS, so the base case
  // means "the business grows as expected and sentiment doesn't change". Capped at 28.
  const curPE = isNum(eps) && eps > 0 ? d.quote.price / eps : null;
  const exitPE = isNum(curPE) ? Math.max(2, Math.min(28, Math.round(curPE * 2) / 2)) : 18;
  return { eps, growth: Math.round(g * 100) / 100, years: 5, exitPE, discount: 0.1, currentPE: curPE };
}

export function leverage(d) {
  const f = d.fundamentals || {};
  const nd = isNum(f.debt) && isNum(f.cash) ? f.debt - f.cash : f.netDebt;
  return isNum(nd) && isNum(f.ebitda) && f.ebitda > 0 ? { netDebt: nd, ratio: nd / f.ebitda } : null;
}

// Plain-English warnings shown next to the fair-value result.
export function modelWarnings(d, m, fv) {
  const out = [];
  const lev = leverage(d), mcap = d.quote?.marketCap;
  if (lev && lev.ratio > 3.5) {
    out.push(`Heavy debt: ${shortName(d)} owes ${money(lev.netDebt)} more than it holds in cash` +
      (isNum(mcap) && lev.netDebt > mcap ? `, more than ${Math.floor(lev.netDebt / mcap)}× the value of all its shares (${money(mcap)})` : "") +
      `. With that much debt, a small drop in the business can wipe out a big chunk of profit for shareholders. This model doesn't capture that risk, and it's a big reason the market pays such a low P/E.`);
  }
  if (isNum(m.currentPE) && m.currentPE < 8) {
    out.push(`The market only pays ${times(m.currentPE)} this year's expected earnings, very low compared to ~17–20 for a typical stock. That usually means investors doubt the earnings will last (competition, shrinking customers, debt). Assuming a higher exit P/E is a bet that those fears are wrong.`);
  }
  if (isNum(fv) && fv / d.quote.price > 1.6) {
    out.push("When a simple model says a stock is worth far more than its price, the model is usually missing a risk the market sees. Find out what that is before trusting the number.");
  }
  return out;
}

// ------------------------------------------------------------------ multi-method valuation
// Each method returns its value plus the exact steps (with numbers plugged in) so the
// dashboard can show how every figure was reached.

export function valuationInputs(d) {
  const f = d.fundamentals || {}, q = d.quote || {};
  const base = modelDefaults(d);
  const lev = leverage(d);
  const heavyDebt = !!(lev && lev.ratio > 3.5);
  const shares = f.sharesImplied || (isNum(q.marketCap) && q.price ? q.marketCap / q.price : f.sharesOutstanding);
  return {
    ...base,
    discount: heavyDebt ? 0.12 : 0.1,
    heavyDebt,
    terminal: 0.025,
    fcfps: isNum(f.freeCashflow) && shares ? f.freeCashflow / shares : null,
    shares,
    analystGrowth: twoYearGrowth(d),
  };
}

export function presets(def) {
  const r2 = (x) => Math.round(x * 100) / 100, half = (x) => Math.max(2, Math.round(x * 2) / 2);
  return {
    bear: { growth: r2(Math.max(0, def.growth * 0.5)), exitPE: half(def.exitPE * 0.75), discount: r2(def.discount + 0.01), terminal: 0.015 },
    base: { growth: def.growth, exitPE: def.exitPE, discount: def.discount, terminal: def.terminal },
    bull: { growth: r2(Math.min(0.3, def.growth * 1.35)), exitPE: half(def.exitPE * 1.2), discount: r2(def.discount - 0.01), terminal: 0.03 },
  };
}

function dcfValue(fcf, g, n, r, tg) {
  let pv = 0;
  const rows = [];
  for (let t = 1; t <= n; t++) {
    const cf = fcf * Math.pow(1 + g, t), disc = Math.pow(1 + r, t);
    pv += cf / disc;
    rows.push({ t, cf, pv: cf / disc });
  }
  const last = fcf * Math.pow(1 + g, n);
  const tv = (last * (1 + tg)) / (r - tg);
  const pvTv = tv / Math.pow(1 + r, n);
  return { value: pv + pvTv, pvYears: pv, tv, pvTv, rows, last };
}

function solve(fn, target, lo = -0.5, hi = 1) {
  if (!isNum(target)) return null;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (fn(mid) > target) hi = mid; else lo = mid; }
  const g = (lo + hi) / 2;
  return g > 0.99 || g < -0.49 ? null : g;
}

export function valuationMethods(d, m) {
  const P = d.quote.price, f = d.fundamentals || {}, out = [];
  const pc = (x, dg = 1) => pct(x, { digits: dg });

  // 1. Earnings growth (P/E)
  {
    const okEps = isNum(m.eps) && m.eps > 0;
    const futEps = okEps ? m.eps * Math.pow(1 + m.growth, m.years) : null;
    const futPx = okEps ? futEps * m.exitPE : null;
    const val = okEps ? futPx / Math.pow(1 + m.discount, m.years) : null;
    out.push({
      id: "pe", name: "Future profits", term: "fairValue", value: val, include: okEps,
      short: "If profits grow as expected and investors keep paying today's price-to-profit ratio, what's that worth now?",
      plain: okEps ? `Expected profit this year: **${price(m.eps)} a share**. Growing ${pc(m.growth, 0)} a year, that's ${price(futEps)} in ${m.years} years. ` +
        `If investors then pay **${num(m.exitPE, 1)}× profit** (${Math.abs(m.exitPE - (m.currentPE ?? m.exitPE)) < 0.6 ? "what they pay today" : "your exit P/E"}), the stock is ${price(futPx)}. ` +
        `To earn ${pc(m.discount)} a year getting there, pay **${price(val)} today**.` : null,
      reason: okEps ? null : "Needs positive expected earnings.",
      implied: okEps ? solve((g) => (m.eps * Math.pow(1 + g, m.years) * m.exitPE) / Math.pow(1 + m.discount, m.years), P) : null,
      steps: okEps ? [
        ["Starting EPS (analysts' estimate for this fiscal year)", price(m.eps)],
        [`EPS in ${m.years} years = ${price(m.eps)} × (1 + ${pc(m.growth, 0)})^${m.years}`, price(futEps)],
        [`Price in ${m.years} years = ${price(futEps)} × ${num(m.exitPE, 1)} exit P/E`, price(futPx)],
        [`Value today = ${price(futPx)} ÷ (1 + ${pc(m.discount)})^${m.years}`, price(val)],
      ] : [],
    });
  }

  // 2. Discounted free cash flow
  {
    const fcfps = m.fcfps;
    const conv = isNum(f.freeCashflow) && isNum(f.netIncomeTTM) && f.netIncomeTTM > 0 ? f.freeCashflow / f.netIncomeTTM : null;
    let reason = null, include = true;
    if (!isNum(fcfps) || fcfps <= 0) { reason = "Free cash flow over the last year was zero or negative, so there's nothing to project."; include = false; }
    else if (m.discount <= m.terminal) { reason = "Required return must be higher than terminal growth."; include = false; }
    else if (isNum(conv) && conv < 0.5) {
      reason = `Left out of the average by default: over the last year ${shortName(d)} turned ${money(f.netIncomeTTM)} of profit into only ${money(f.freeCashflow)} of free cash flow, ` +
        `because it spent ${money(Math.abs(f.capexTTM ?? 0))} on capex (data centers, equipment). Projecting today's unusually low cash flow forward would undervalue it. Include it if you think that spending will stay this high.`;
      include = false;
    }
    const r = isNum(fcfps) && fcfps > 0 && m.discount > m.terminal ? dcfValue(fcfps, m.growth, m.years, m.discount, m.terminal) : null;
    out.push({
      id: "dcf", name: "Cash it generates (DCF)", term: "freeCashflow", value: r?.value ?? null, include, optional: !!r, reason,
      short: "Add up all the spare cash the business should produce for shareholders from now on, in today's dollars.",
      tvShare: r ? r.pvTv / r.value : null,
      plain: r ? `Last year it produced **${price(fcfps)} of spare cash a share**. Grow that ${pc(m.growth, 0)} a year for ${m.years} years, then ${pc(m.terminal)} forever, ` +
        `and convert to today's dollars at ${pc(m.discount)} a year: **${price(r.value)}**. **${Math.round((r.pvTv / r.value) * 100)}% of it comes after year ${m.years}**, so this assumes the business stays strong for decades.` : null,
      implied: r ? solve((g) => dcfValue(fcfps, g, m.years, m.discount, m.terminal).value, P) : null,
      steps: r ? [
        [`Free cash flow per share, last 12 months (${money(f.freeCashflow)} ÷ ${shareLabel(m.shares)} shares)`, price(fcfps)],
        ...r.rows.map((x) => [`Year ${x.t}: ${price(x.cf)} cash, worth today ÷ (1 + ${pc(m.discount)})^${x.t}`, price(x.pv)]),
        [`Value of years 1–${m.years} combined`, price(r.pvYears)],
        [`Everything after year ${m.years} ("terminal value") = ${price(r.last)} × (1 + ${pc(m.terminal)}) ÷ (${pc(m.discount)} − ${pc(m.terminal)})`, price(r.tv)],
        [`Terminal value in today's dollars ÷ (1 + ${pc(m.discount)})^${m.years}`, price(r.pvTv)],
        ["Value today = years 1–5 + terminal value", price(r.value)],
      ] : [],
    });
  }

  // 3. Analyst targets (the median, so one extreme target can't drag it around)
  {
    const tg = d.analysts?.targets || {}, useMed = isNum(tg.median), t = useMed ? tg.median : tg.mean;
    const val = isNum(t) ? t / (1 + m.discount) : null;
    out.push({
      id: "analyst", name: "What Wall Street expects", term: "priceTarget", value: val, include: isNum(t),
      short: `The ${useMed ? "middle" : "average"} analyst price target for a year from now, in today's dollars.`,
      plain: isNum(t) ? `The ${useMed ? "middle" : "average"} target of the ${d.analysts.count ?? ""} analysts covering ${shortName(d)} is **${price(t)} a year from now**` +
        (useMed && isNum(tg.mean) && Math.abs(tg.mean / tg.median - 1) > 0.05 ? ` (the average is ${price(tg.mean)}, pulled ${tg.mean > tg.median ? "up" : "down"} by a few extreme targets)` : "") +
        `. Wanting ${pc(m.discount)} a year, that's **${price(val)} today**. Targets follow the mood, so treat this as sentiment.` : null,
      reason: isNum(t) ? null : "No analyst targets available.",
      steps: isNum(t) ? [
        [`${useMed ? "Median" : "Average"} target of ${d.analysts.count ?? "all"} analysts (12 months out)`, price(t)],
        [`Value today = ${price(t)} ÷ (1 + ${pc(m.discount)})`, price(val)],
      ] : [],
    });
  }

  // 4. Priced like its peers: whole-company multiple (EV/EBITDA), then subtract the debt
  {
    const name = shortName(d), cl = netClaims(d), ebitda = f.ebitda, sh = m.shares;
    const peers = (d.peers?.list || []).filter((p) => isNum(p.evToEbitda) && p.evToEbitda > 0 && p.evToEbitda < 40);
    const vals = peers.map((p) => p.evToEbitda).sort((a, b) => a - b);
    const mult = quantile(vals, 0.5), q1 = quantile(vals, 0.25), q3 = quantile(vals, 0.75);
    let reason = null, include = true, val = null, ev = null, eq = null;
    if (vals.length < 3) { reason = "Not enough comparable companies with usable data."; include = false; }
    else if (!isNum(ebitda) || ebitda <= 0) { reason = "Needs positive EBITDA (operating earnings)."; include = false; }
    else if (!cl || !isNum(sh)) { reason = "Missing debt or share-count data."; include = false; }
    else {
      ev = mult * ebitda; eq = ev - cl.value; val = eq > 0 ? eq / sh : null;
      if (!isNum(val)) { reason = `At the peers' multiple the debt is bigger than the whole business, leaving nothing for shareholders.`; include = false; }
      else if (vals.length < 4) { reason = `Left out of the average by default: only ${vals.length} of the companies Yahoo lists in ${name}'s industry have usable numbers, too few for a fair comparison. Check the list and tick it if they look comparable.`; include = false; }
      else if (q3 / q1 > 1.6) {
        reason = `Left out of the average by default: the companies Yahoo lists in ${name}'s industry are valued very differently from each other (the middle half range from ${times(q1)} to ${times(q3)}), so their median isn't a reliable yardstick. Check the list and tick it if they look like fair comparisons.`;
        include = false;
      }
    }
    const per1x = isNum(ebitda) && isNum(sh) ? ebitda / sh : null;
    const heavy = cl && isNum(ev) && cl.value / ev > 0.5;
    const names = peers.slice(0, 4).map((p) => p.symbol).join(", ");
    out.push({
      id: "peers", name: "Priced like its peers", term: "evToEbitda", value: val, include, optional: isNum(val),
      short: "What similar companies sell for, counting their debt, applied to this one. Then the debt is paid off first.",
      peers: d.peers?.list || [], peerMedian: mult, peerKey: "evToEbitda", peerMax: 40,
      plain: isNum(ev) ? `Companies like ${names}${peers.length > 4 ? " and others" : ""} sell for **${times(mult)} their yearly operating earnings** (EBITDA), debt included. ` +
        `At that price all of ${name} is worth ${money(ev)}. ` +
        (cl.value > 0 ? `**Lenders are paid first: subtract ${money(cl.value)}.** That leaves ${money(Math.max(eq, 0))} for shareholders` : `${name} has more cash than debt, so add ${money(-cl.value)}, giving ${money(eq)} for shareholders`) +
        (isNum(val) ? `: **${price(val)} a share**.` : ".") +
        (heavy && isNum(per1x) ? ` Debt takes most of the value, so **each 1× change in the multiple moves this by ${price(per1x)}**.` : "") : null,
      reason,
      steps: isNum(ev) ? [
        [`Peers' median EV/EBITDA (${vals.length} companies; the full list is below)`, times(mult)],
        [`${name}'s own EV/EBITDA today, for comparison`, times(d.valuation?.evToEbitda)],
        [`Whole-company value = ${money(ebitda)} EBITDA (last 12 months) × ${times(mult)}`, money(ev)],
        cl.value >= 0 ? [`− Debt minus cash${cl.src === "ev" ? " (plus other claims such as minority stakes)" : ""}`, `−${money(cl.value)}`] : ["+ Net cash (cash minus debt)", `+${money(-cl.value)}`],
        ["= Left for shareholders", money(eq)],
        [`÷ ${shareLabel(sh)} shares`, isNum(val) ? price(val) : "$0"],
      ] : [],
    });
  }

  // 5. Peers' price-to-profit (forward P/E)
  {
    const name = shortName(d), okEps = isNum(m.eps) && m.eps > 0;
    const peers = (d.peers?.list || []).filter((p) => isNum(p.forwardPE) && p.forwardPE > 0 && p.forwardPE < 60);
    const vals = peers.map((p) => p.forwardPE).sort((a, b) => a - b);
    const mult = quantile(vals, 0.5), q1 = quantile(vals, 0.25), q3 = quantile(vals, 0.75);
    const cl = netClaims(d), mc = d.quote?.marketCap, debtShare = cl && isNum(mc) && cl.value > 0 ? cl.value / (cl.value + mc) : 0;
    let reason = null, include = true, val = null;
    if (vals.length < 3) { reason = "Not enough comparable companies with usable data."; include = false; }
    else if (!okEps) { reason = "Needs positive expected earnings."; include = false; }
    else {
      val = mult * m.eps;
      if (vals.length < 4) { reason = `Left out by default: only ${vals.length} peers have usable numbers, too few for a fair comparison.`; include = false; }
      else if (q3 / q1 > 1.6) { reason = `Left out by default: the peers are priced very differently from each other (the middle half range from ${times(q1)} to ${times(q3)}), so their median isn't a reliable yardstick.`; include = false; }
      else if (debtShare > 0.5) { reason = `Left out by default: **debt is ${pct(debtShare, { digits: 0 })} of ${name}'s value**, far more than most peers. Heavily indebted companies deserve a lower P/E, and this comparison can't see that. Method 4 handles debt properly.`; include = false; }
    }
    const names = peers.slice(0, 4).map((p) => p.symbol).join(", ");
    out.push({
      id: "peerpe", name: "Peers' price-to-profit", term: "pe", value: val, include, optional: isNum(val),
      short: "What investors pay for each $1 of a competitor's profit, applied to this one's profit.",
      peers: d.peers?.list || [], peerMedian: mult, peerKey: "forwardPE", peerMax: 60,
      plain: isNum(val) ? `Investors pay **${times(mult)} expected profit** for companies like ${names}. ${name} is expected to earn ${price(m.eps)} a share, so at the same ratio it would be **${price(val)}**. ` +
        "Profit is counted after interest, so this sees the interest bill but not the extra risk that heavy debt adds." : null,
      reason,
      steps: isNum(val) ? [
        [`Peers' median forward P/E (${vals.length} companies; list below)`, times(mult)],
        [`${name}'s own forward P/E today, for comparison`, times(d.valuation?.forwardPE)],
        [`Value = ${price(m.eps)} expected EPS × ${times(mult)}`, price(val)],
      ] : [],
    });
  }

  // 6. Back to its usual P/E (its own last few fiscal years)
  {
    const name = shortName(d), okEps = isNum(m.eps) && m.eps > 0, yrs = pastPEs(d);
    const vals = yrs.map((y) => y.pe).sort((a, b) => a - b);
    const mult = quantile(vals, 0.5), lo = vals[0], hi = vals[vals.length - 1];
    let reason = null, include = true, val = null;
    if (yrs.length < 3) { reason = "Needs at least three years of profits and prices."; include = false; }
    else if (!okEps) { reason = "Needs positive expected earnings."; include = false; }
    else {
      val = mult * m.eps;
      if (hi / lo > 2) { reason = `Left out by default: its P/E has swung from **${times(lo)} to ${times(hi)}** in ${yrs.length} years, so there's no steady "usual" level to return to. A swing like that usually means the market changed its mind about the business for a reason.`; include = false; }
    }
    const nowPE = okEps ? P / m.eps : null;
    out.push({
      id: "past", name: "Back to its usual price-to-profit", term: "pe", value: val, include, optional: isNum(val),
      short: "If investors went back to paying the price-to-profit ratio they typically paid in recent years.",
      years: yrs,
      plain: isNum(val) ? `At the end of each of the last ${yrs.length} fiscal years, investors paid between ${times(lo)} and ${times(hi)} profit for ${name} (**typically ${times(mult)}**). ` +
        `Today they pay ${times(nowPE)}. Back at ${times(mult)} its expected ${price(m.eps)} profit, the stock would be **${price(val)}**. ` +
        (nowPE < lo * 0.9 ? "**It's cheaper now than in any recent year.** Ask what changed before assuming it will bounce back." : nowPE > hi * 1.1 ? "**It's pricier now than in any recent year.**" : "") : null,
      reason,
      steps: isNum(val) ? [
        ...yrs.map((y) => [`${y.period.slice(0, 4)}: price ${price(y.price)} ÷ ${price(y.eps)} EPS`, times(y.pe)]),
        ["Typical (median) of those years", times(mult)],
        [`Value = ${price(m.eps)} expected EPS × ${times(mult)}`, price(val)],
      ] : [],
    });
  }

  // 7. No-growth floor (earnings power value): today's operating profit, forever, minus the debt
  {
    const name = shortName(d), cl = netClaims(d), sh = m.shares;
    const qs = (d.financials?.quarterly || []).slice(-4);
    const ebit = qs.length === 4 && qs.every((x) => isNum(x.operatingIncome)) ? qs.reduce((s, x) => s + x.operatingIncome, 0) : null;
    const r = Math.min(0.12, Math.max(0.05, m.discount - (m.heavyDebt ? 0.04 : 0.02)));
    const tax = 0.21;
    let reason = null, val = null, biz = null, eq = null;
    if (!isNum(ebit) || ebit <= 0) reason = "Needs positive operating profit over the last four quarters.";
    else if (!cl || !isNum(sh)) reason = "Missing debt or share-count data.";
    else {
      biz = (ebit * (1 - tax)) / r; eq = biz - cl.value; val = eq > 0 ? eq / sh : null;
      const forGrowth = isNum(val) ? 1 - val / P : 1;
      reason = isNum(val)
        ? `A floor, not a fair value, so it's left out of the average by default. It shows that **${pct(Math.max(0, forGrowth), { digits: 0 })} of today's price is paying for growth** (or for lower interest rates).`
        : `A floor, not a fair value. **If ${name} never grew, its debt would be worth more than the whole business**, so today's share price is entirely a bet on growth (or on the debt getting cheaper).`;
    }
    out.push({
      id: "floor", name: "If it never grows", term: "enterpriseValue", value: val, include: false, optional: isNum(val), floor: true,
      display: isNum(biz) && !isNum(val) ? "$0" : null,
      short: "Today's operating profit, earned every year forever with no growth, minus the debt.",
      plain: isNum(biz) ? `Over the last year ${name} made **${money(ebit)} of operating profit** (${money(ebit * (1 - tax))} after a ${pct(tax, { digits: 0 })} tax). ` +
        `Earned forever with no growth, and valued at ${pc(r)} a year, the whole business is worth ${money(biz)}. ` +
        (cl.value > 0 ? `**Minus ${money(cl.value)} for lenders**` : `Plus ${money(-cl.value)} net cash`) + `, that's **${isNum(val) ? `${price(val)} a share` : "nothing left for shareholders"}**.` : null,
      reason,
      steps: isNum(biz) ? [
        [`Operating profit, last 4 quarters`, money(ebit)],
        [`After ${pct(tax, { digits: 0 })} tax`, money(ebit * (1 - tax))],
        [`Whole-company value = ${money(ebit * (1 - tax))} ÷ ${pc(r)} (a typical yearly return for lenders and owners together${m.heavyDebt ? "; debt is cheaper than shares, so this is below the 12% used above" : ""})`, money(biz)],
        cl.value >= 0 ? ["− Debt minus cash (and other claims)", `−${money(cl.value)}`] : ["+ Net cash", `+${money(-cl.value)}`],
        ["= Left for shareholders", money(eq)],
        [`÷ ${shareLabel(sh)} shares`, isNum(val) ? price(val) : "$0"],
      ] : [],
    });
  }
  return out;
}

const shareLabel = (sh) => (sh >= 1e9 ? `${(sh / 1e9).toFixed(2)}B` : `${Math.round(sh / 1e6)}M`);

// Price-to-profit at the end of each fiscal year: closing price that day ÷ that year's EPS.
export function pastPEs(d) {
  const dates = d.prices?.dates || [], close = d.prices?.close || [];
  const out = [];
  for (const y of d.financials?.annual || []) {
    if (!isNum(y.eps) || y.eps <= 0) continue;
    let i = dates.length - 1;
    while (i >= 0 && dates[i] > y.period) i--;
    if (i < 0 || new Date(y.period) - new Date(dates[i]) > 10 * 864e5) continue;
    if (isNum(close[i])) out.push({ period: y.period, price: close[i], eps: y.eps, pe: close[i] / y.eps });
  }
  return out;
}

export function blend(methods, included) {
  const vals = methods.filter((x) => included[x.id] && isNum(x.value)).map((x) => x.value);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { avg, low: Math.min(...vals), high: Math.max(...vals), n: vals.length, spread: Math.max(...vals) / Math.min(...vals) };
}


// How much to trust the blend, in plain English.
export function confidence(b) {
  if (!b || b.n < 2) return null;
  if (b.spread < 1.25) return { tone: "good", label: "Methods agree", text: "The methods land close together, so the average is a reasonable rough estimate." };
  if (b.spread < 1.6) return { tone: "ok", label: "Some disagreement", text: "The methods differ somewhat. Treat the average as a rough guide, not a precise number." };
  return { tone: "bad", label: "Big disagreement", text: "The methods are **far apart**, so the average hides a lot of uncertainty. Here's why:" };
}

// Why the included methods disagree, using this company's own numbers.
export function explainSpread(d, methods, included, m) {
  const inc = methods.filter((x) => included[x.id] && isNum(x.value));
  if (inc.length < 2) return [];
  const hi = inc.reduce((a, b) => (b.value > a.value ? b : a)), lo = inc.reduce((a, b) => (b.value < a.value ? b : a));
  if (hi.value / lo.value < 1.25) return [];
  const name = shortName(d), P = d.quote.price, f = d.fundamentals || {};
  const out = [];
  const fcfYield = isNum(f.freeCashflow) && isNum(d.quote.marketCap) ? f.freeCashflow / d.quote.marketCap : null;
  const pair = `"${hi.name}" (${price(hi.value)}) vs "${lo.name}" (${price(lo.value)})`;

  if (hi.id === "dcf" && lo.id === "pe") {
    out.push(`The biggest gap is ${pair}.`);
    out.push(`The cash method is high because ${name} throws off a lot of cash compared to its share price${isNum(fcfYield) ? `: about ${pct(fcfYield, { digits: 0 })} of its market value every year` : ""}, and it assumes that continues forever (${Math.round((hi.tvShare ?? 0) * 100)}% of its value comes after year ${m.years}).`);
    out.push(`The profits method is low because it keeps today's ${num(m.exitPE, 1)}× price-to-profit ratio. That ratio already contains the market's doubts, so the method inherits them.`);
  } else if (hi.id === "pe" && lo.id === "dcf") {
    out.push(`The biggest gap is ${pair}.`);
    out.push(`${name} currently turns less of its profit into spare cash${isNum(f.netIncomeTTM) && f.netIncomeTTM > 0 && isNum(f.freeCashflow) ? ` (${pct(f.freeCashflow / f.netIncomeTTM, { digits: 0 })} of profit last year)` : ""}, usually because it's investing heavily. The cash method takes today's low cash flow at face value; the profits method doesn't.`);
  } else if (hi.id === "peers" || lo.id === "peers") {
    const pm = hi.id === "peers" ? hi : lo;
    out.push(`The biggest gap is ${pair}.`);
    out.push(`"${pm.name}" values the whole business like its competitors and then subtracts the debt. ${hi.id === "peers" ? `It's higher because ${name} trades at a lower multiple than its peers today. Either the market sees problems the peers don't have, or ${name} is cheap.` : `It's lower because ${name} is priced richer than its peers today, usually because investors expect faster growth.`}`);
  } else if (hi.id === "past") {
    out.push(`The biggest gap is ${pair}.`);
    out.push(`${name} used to be priced higher. "${hi.name}" assumes investors go back to paying what they used to; the market today isn't willing to.`);
  } else if (hi.id === "peerpe") {
    out.push(`The biggest gap is ${pair}.`);
    out.push(`Competitors are priced at a higher price-to-profit ratio than ${name}. Either the market sees problems they don't have (debt, shrinking customers), or ${name} is cheap.`);
  } else if (hi.id === "analyst") {
    out.push(`Analysts are more optimistic than the models: ${pair}. Their targets often assume the company's problems get resolved.`);
  } else if (lo.id === "analyst") {
    out.push(`Analysts are more cautious than the models: ${pair}. They may be seeing risks the simple math doesn't capture.`);
  } else {
    out.push(`The biggest gap is ${pair}. Open each method to compare their inputs.`);
  }

  const closest = inc.reduce((a, b) => (Math.abs(b.value - P) < Math.abs(a.value - P) ? b : a));
  out.push(`Today's price (${price(P)}) sits closest to "${closest.name}" (${price(closest.value)}), so the market is effectively valuing ${name} that way.`);
  if (hi.id === "dcf" && lo.id === "pe") {
    out.push(`So the question you have to answer is whether ${name}'s cash will keep flowing for many years. If yes, the higher numbers make sense and the stock may be cheap. If you think the business is slowly shrinking, today's price may be about right.`);
  }
  return out;
}

// Rough headline mood from keywords. Not real sentiment analysis; labelled as such in the UI.
const POS = "\\b(beat|beats|tops|surge[sd]?|soar(s|ed)?|jump(s|ed)?|rall(y|ies|ied)|gain(s|ed)?|rise[sn]?|rising|record|upgrade[sd]?|raise[sd]?|strong(er)?|boost(s|ed)?|outperform\\w*|bullish|wins?)\\b";
const NEG = "\\b(miss(es|ed)?|fall(s|en)?|fell|drop(s|ped)?|plunge[sd]?|slump(s|ed)?|tumble[sd]?|sink(s)?|sank|cut(s)?|downgrade[sd]?|lawsuit|probe|investigation|warn(s|ed|ing)?|weak(er|ness)?|sell-?off|loss(es)?|lose[s]?|losing|bearish|decline[sd]?|layoffs?|recall|fine[sd]|concerns?|fears?)\\b";
// ------------------------------------------------------------------ press release, translated
// Turns a sentence from a company's press release into a short plain-English point.
// Pattern-based (no AI): returns null when no pattern fits, and the UI then shows the sentence as-is.
const AMT_RE = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand)?/gi;
function amounts(s) {
  return [...s.matchAll(AMT_RE)].map((m) => {
    const n = parseFloat(m[1].replace(/,/g, "")), u = (m[2] || "").toLowerCase();
    return { value: n * (u === "billion" ? 1e9 : u === "million" ? 1e6 : u === "thousand" ? 1e3 : 1), text: u ? money(n * (u === "billion" ? 1e9 : u === "million" ? 1e6 : 1e3)) : price(n) };
  });
}
const big = (am) => am.filter((x) => x.value >= 1e6);
export function translateRelease(s, ctx = {}) {
  const am = amounts(s), bigs = big(am), pc = (s.match(/(\d+(?:\.\d+)?)\s?%/) || [])[1];
  const largest = bigs.length ? bigs.reduce((x, y) => (y.value > x.value ? y : x)) : null;
  const yr = (s.match(/fiscal year (20\d\d)/i) || [])[1];
  const earlier = yr && ctx.maxYear && +yr < ctx.maxYear ? "A year earlier: " : "";
  const T = (tone, tag, text) => ({ tone, tag, text });

  if (/net loss/i.test(s) && /impairment|write-?down/i.test(s) && bigs.length >= 2) {
    return T("note", "One-off", `**Reported a loss of about ${bigs[0].text}**, but it was caused by a one-time ${largest.text} write-down. The everyday business didn't lose that money.`);
  }
  if (/(decline|decrease|fell|lower)[^.]*net income|net income[^.]*(decline|decrease|fell)/i.test(s) && /impairment|write-?down/i.test(s) && largest) {
    const gain = /extinguishment of debt|debt exchange/i.test(s) ? bigs.find((x) => x !== largest) : null;
    return T("note", "One-off", `**Profit was lower mainly because of the one-time ${largest.text} write-down.**` + (gain ? ` A one-time ${gain.text} gain from refinancing its debt made up part of it.` : ""));
  }
  if (/impairment|write-?downs?|write-?offs?/i.test(s) && largest) {
    return T("note", "One-off", `**One-time write-down of about ${largest.text}.** The company admitted something it owns${/franchise/i.test(s) ? " (the local licenses that let it sell cable service)" : ""} is worth less than it paid. It's an accounting hit: no cash actually left the company.`);
  }
  const inv = s.match(/net (gains?|losses?) (?:from|on) (?:\w+ )?investments? in ([A-Z][\w.&-]*)/i);
  if (inv) {
    const gain = /gain/i.test(inv[1]), ps = am.find((x) => x.value < 100);
    return T("note", "One-off", `${earlier}**Its stake in ${inv[2]} ${gain ? "rose" : "fell"} in value, ${gain ? "adding" : "cutting"} about ${bigs[0]?.text ?? "some money"} ${gain ? "to" : "from"} profit**${ps ? ` (${ps.text} a share)` : ""}. A one-off, not from selling its products.`);
  }
  if (/extinguishment of debt|debt exchange/i.test(s) && largest) {
    return T("note", "One-off", `**One-time gain of about ${largest.text}** from swapping old debt for new debt on better terms. A paper gain, not from the business.`);
  }
  if (/restructuring|severance|integration costs|transaction costs/i.test(s) && largest && !/cash flows?/i.test(s)) {
    return T("note", "One-off", `**About ${largest.text} of costs from reorganizing or merging.** These should stop once the change is finished.`);
  }
  if (/cash flows? from operating activities|operating cash flow/i.test(s) && bigs.length >= 2) {
    const [now, before] = bigs, down = now.value < before.value;
    const why = [/timing/i.test(s) ? "when taxes were paid" : null, /one-time/i.test(s) ? "one-time merger costs" : null].filter(Boolean);
    return T(down ? "bad" : "good", "Cash", `**Cash coming in from the business: ${now.text}, ${down ? "down" : "up"} from ${before.text} a year ago.**` +
      (down && why.length ? ` Mostly because of ${why.join(" and ")}, so not necessarily a lasting problem.` : ""));
  }
  if (/capital expenditures|capex/i.test(s) && largest) {
    return T("plain", "Plan", `**Plans to spend about ${largest.text}${/full year|annual/i.test(s) ? " this year" : ""} on its network and equipment** (called capex). Spending now to earn more later; it uses up cash in the meantime.`);
  }
  if (/(expense|cost) savings|synerg/i.test(s) && largest) {
    const months = (s.match(/(\d+) months/) || [])[1], syn = /synerg/i.test(s) && bigs.length > 1 ? bigs[1] : null;
    return T("good", "Cost cuts", `**Aims to cut about ${bigs[0].text} a year in costs**${months ? ` within ${months} months` : ""}` +
      (syn ? `, plus over ${syn.text} of savings from combining with the company it bought` : "") + ". Lower costs mean more profit if sales hold up.");
  }
  if (/returned[^.]*shareholders|dividends and (share )?repurchases/i.test(s) && largest) {
    return T("good", "Shareholders", `**Paid shareholders ${largest.text}** in dividends and by buying back its own shares (fewer shares means each remaining one owns a bigger slice).`);
  }
  // names are matched case-sensitively (capitalized words only)
  const rev = s.match(/(?:^|\s)((?:[A-Z][\w&]*\s){0,3})[Rr]evenues?\s+(increased|grew|rose|decreased|declined|fell)\s+(\d+(?:\.\d+)?%)\s+to\s+\$/);
  if (rev && largest) {
    const lead = (s.match(/^((?:[A-Z][\w&]*\s){1,3})/) || [])[1] || "";
    const up = /increased|grew|rose/i.test(rev[2]), who = (rev[1].trim() || lead.replace(/\s+(delivered|reported|posted)\s*$/, "").trim()).replace(/^Consolidated\s+/, "").replace(/^Total\s+/, "");
    return T(up ? "good" : "bad", up ? "Growth" : "Shrinking", `**${who ? `${who} sales` : "Sales"} ${up ? "up" : "down"} ${rev[3]}** to ${largest.text}.` + (up && parseFloat(rev[3]) >= 50 ? " That's very fast growth." : ""));
  }
  const rev2 = s.match(/((?:[A-Z][\w&]*\s){1,3})revenue of \$[\d.,]+\s*(?:billion|million)?,?\s+with growth (accelerating |slowing )?to (\d+%)/);
  if (rev2 && largest) {
    return T("good", "Growth", `**${rev2[1].trim()} sales: ${largest.text}, up ${rev2[3]}**${rev2[2] && /accel/i.test(rev2[2]) ? ", and growth is speeding up" : ""}.`);
  }
  const added = [...s.matchAll(/(\d+(?:\.\d+)?) million (customer relationships|customers|subscribers|passings|homes)/gi)];
  if (added.length && /added|grew|gained/i.test(s)) {
    const word = (w) => (/passing/i.test(w) ? "homes and businesses it can reach" : "customers");
    return T("good", "Bigger", `**Got bigger:** added ${added.map((m) => `${m[1]} million ${word(m[2])}`).join(" and ")}.`);
  }
  if (/expects|outlook|guidance|targeting|anticipates/i.test(s)) {
    return T("plain", "Outlook", `**What management expects:** ${bigs.length ? `the main figure is ${largest.text}.` : "see their exact words."}`);
  }
  return null;
}

// Analyst ratings as a net score: strong buy +2, buy +1, hold 0, sell −1, strong sell −2.
export function ratingScore(r) {
  if (!r) return null;
  const n = ["strongBuy", "buy", "hold", "sell", "strongSell"].reduce((s, k) => s + (r[k] || 0), 0);
  if (!n) return null;
  const net = 2 * (r.strongBuy || 0) + (r.buy || 0) - (r.sell || 0) - 2 * (r.strongSell || 0), avg = net / n;
  const label = avg >= 1.5 ? "Strong buy" : avg >= 0.5 ? "Buy" : avg > 0.1 ? "Hold, leaning buy" : avg >= -0.1 ? "Hold" : avg > -0.5 ? "Hold, leaning sell" : avg > -1.5 ? "Sell" : "Strong sell";
  return { n, net, avg, label, tone: avg >= 0.5 ? "good" : avg <= -0.5 ? "bad" : "ok" };
}

// For each glossary term with a numeric rule of thumb: where this company sits.
// Returns { tone: good|ok|bad, value, text } or null. Thresholds match the glossary "rule" text.
export function judge(key, d) {
  if (!d) return null;
  const f = d.fundamentals || {}, v = d.valuation || {}, q = d.quote || {}, fu = d.fund || {};
  const band = (x, okAt, goodAt, fmt, words, higherIsBetter = true) => {
    if (!isNum(x)) return null;
    const tone = higherIsBetter ? (x >= goodAt ? "good" : x >= okAt ? "ok" : "bad") : (x <= goodAt ? "good" : x <= okAt ? "ok" : "bad");
    return { tone, value: fmt(x), text: words[tone] };
  };
  const p1 = (x) => pct(x, { digits: 1 });
  switch (key) {
    case "pe": return isNum(v.trailingPE) && v.trailingPE > 0 ? band(v.trailingPE, 25, 18, times, { good: "At or below the market's long-run ~16–18", ok: "Above the long-run average", bad: "Well above the long-run average" }, false) : null;
    case "forwardPE": {
      if (!isNum(v.forwardPE) || v.forwardPE <= 0 || !isNum(v.trailingPE) || v.trailingPE <= 0) return null;
      const r = v.forwardPE / v.trailingPE;
      return { tone: r < 0.9 ? "good" : r <= 1.05 ? "ok" : "bad", value: `${times(v.forwardPE)} vs ${times(v.trailingPE)} trailing`, text: r < 0.9 ? "Lower than trailing: profits expected to grow" : r <= 1.05 ? "About the same as trailing" : "Higher than trailing: profits expected to shrink" };
    }
    case "peg": return isNum(v.peg) && v.peg > 0 ? band(v.peg, 2, 1, (x) => num(x, 2), { good: "Under 1: cheap for its growth", ok: "1–2: fair", bad: "Over 2: paying up" }, false) : null;
    case "revenueGrowth": return band(f.revenueGrowth, 0, 0.05, p1, { good: "Growing at a solid pace", ok: "Barely growing", bad: "Shrinking" });
    case "operatingMargin": return band(f.operatingMargin, 0.1, 0.2, p1, { good: "Over 20%: strong", ok: "10–20%: decent", bad: "Under 10%: thin" });
    case "freeCashflow": {
      if (!isNum(f.freeCashflow) || !isNum(q.marketCap)) return null;
      const y = f.freeCashflow / q.marketCap;
      return { tone: y > 0.05 ? "good" : y > 0 ? "ok" : "bad", value: `${pct(y)} FCF yield`, text: y > 0.05 ? "Over 5%: generous" : y > 0 ? "Positive, under 5%" : "Negative: burning cash" };
    }
    case "debtToEquity": return isNum(f.debtToEquity) ? band(f.debtToEquity, 2, 0.5, (x) => num(x, 2), { good: "Under 0.5: conservative", ok: "Moderate", bad: "Over 2: heavy" }, false) : null;
    case "netDebtToEbitda": {
      const l = leverage(d);
      return l ? { tone: l.ratio < 1.5 ? "good" : l.ratio < 3.5 ? "ok" : "bad", value: l.ratio < 0 ? "Net cash" : times(l.ratio), text: l.ratio < 0 ? "More cash than debt" : l.ratio < 1.5 ? "Under 1.5×: comfortable" : l.ratio < 3.5 ? "1.5–3.5×: manageable" : "Over 3.5×: high" } : null;
    }
    case "currentRatio": return isNum(f.currentRatio) ? { tone: f.currentRatio >= 1 ? "good" : "ok", value: num(f.currentRatio, 2), text: f.currentRatio >= 1 ? "Over 1: comfortable" : "Under 1: worth noting" } : null;
    case "roe": return band(f.roe, 0, 0.15, p1, { good: "Over 15%: good", ok: "Positive but under 15%", bad: "Negative" });
    case "evToEbitda": return isNum(v.evToEbitda) && v.evToEbitda > 0 ? band(v.evToEbitda, 20, 8, times, { good: "Under 8×: cheap", ok: "8–20×: typical", bad: "Over 20×: expensive" }, false) : null;
    case "dividendYield": return isNum(v.dividendYield) && v.dividendYield > 0 ? { tone: v.dividendYield > 0.06 || v.dividendYield < 0.01 ? "ok" : "good", value: pct(v.dividendYield, { digits: 2 }), text: v.dividendYield > 0.06 ? "Over 6%: check it's sustainable" : v.dividendYield < 0.01 ? "Under 1%: small; most of your return comes from the price" : "1–6%: a normal, healthy yield" } : null;
    case "payoutRatio": return isNum(v.payoutRatio) && v.payoutRatio > 0 ? band(v.payoutRatio, 1, 0.6, (x) => pct(x, { digits: 0 }), { good: "Under 60%: comfortable", ok: "60–100%: stretched", bad: "Over 100%: paying more than it earns" }, false) : null;
    case "shortInterest": return isNum(f.shortPercentOfFloat) ? band(f.shortPercentOfFloat, 0.15, 0.05, p1, { good: "Under 5%: normal", ok: "5–15%: elevated", bad: "Over 15%: many investors betting against it" }, false) : null;
    case "ma200": {
      if (!isNum(q.price) || !isNum(q.ma200)) return null;
      const x = q.price / q.ma200 - 1;
      return { tone: x >= 0 ? "good" : x > -0.1 ? "ok" : "bad", value: `${pct(x, { sign: true })} vs 200-day`, text: x >= 0 ? "Above: the trend is up" : x > -0.1 ? "Slightly below" : "Well below: downtrend" };
    }
    case "priceTarget": {
      const t = d.analysts?.targets || {}, tv = isNum(t.median) ? t.median : t.mean;
      if (!isNum(tv) || !isNum(q.price)) return null;
      const up = tv / q.price - 1;
      return { tone: up > 0.15 ? "good" : up > 0 ? "ok" : "bad", value: `${pct(up, { sign: true })} to the middle target`, text: up > 0.15 ? "Analysts see good upside" : up > 0 ? "Modest upside" : "Trading above most targets" };
    }
    case "analystRating": {
      const sc = ratingScore((d.analysts?.summary || []).find((r) => r.period === "0m"));
      return sc ? { tone: sc.tone, value: `net ${sc.net > 0 ? "+" : ""}${sc.net} from ${sc.n} analysts`, text: sc.label } : null;
    }
    case "epsSurprise": {
      const h = (d.earnings?.history || []).filter((x) => isNum(x.surprise)).slice(-8);
      if (!h.length) return null;
      const b = h.filter((x) => x.surprise > 0).length, one = h.filter((x) => oneOffMiss(d, x)).length, r = (b + one) / h.length;
      return { tone: r >= 0.7 ? "good" : r >= 0.5 ? "ok" : "bad", value: `Beat ${b} of ${h.length}${one ? ` (+${one} one-off)` : ""}`, text: r >= 0.7 ? "Beats as often as healthy companies do" : r >= 0.5 ? "Misses more than most big companies" : "Misses often" };
    }
    case "estimateRevisions": {
      const t1 = estRow(d.earnings?.epsTrend, "+1y");
      if (!isNum(t1.current) || !isNum(t1["90daysAgo"]) || !t1["90daysAgo"]) return null;
      const ch = t1.current / t1["90daysAgo"] - 1;
      return { tone: ch > 0.01 ? "good" : ch > -0.01 ? "ok" : "bad", value: `${pct(ch, { sign: true })} in 90 days`, text: ch > 0.01 ? "Estimates rising" : ch > -0.01 ? "Estimates steady" : "Estimates falling: a warning" };
    }
    case "expenseRatio": return band(fu.expenseRatio, 0.005, 0.001, (x) => pct(x, { digits: 2 }), { good: "Under 0.10%: very cheap", ok: "0.10–0.50%: fine", bad: "Expensive for an index fund" }, false);
    case "netAssets": return isNum(fu.netAssets) ? { tone: fu.netAssets >= 1e9 ? "good" : "ok", value: money(fu.netAssets), text: fu.netAssets >= 1e9 ? "Comfortably large" : "On the small side" } : null;
    default: return null;
  }
}

export function newsMood(n) {
  const t = `${n.title || ""} ${n.summary || ""}`;
  const p = (t.match(new RegExp(POS, "gi")) || []).length, q = (t.match(new RegExp(NEG, "gi")) || []).length;
  if (p > q) return { tone: "good", word: "Upbeat", icon: "▲" };
  if (q > p) return { tone: "bad", word: "Downbeat", icon: "▼" };
  return { tone: "na", word: "Neutral", icon: "•" };
}


function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// What lenders and other claimants are owed ahead of shareholders, net of cash.
// Prefer Yahoo's enterprise value minus market cap (includes leases, minority stakes);
// fall back to debt minus cash.
export function netClaims(d) {
  const ev = d.valuation?.enterpriseValue, mc = d.quote?.marketCap, f = d.fundamentals || {};
  if (isNum(ev) && isNum(mc)) return { value: ev - mc, src: "ev" };
  if (isNum(f.debt) && isNum(f.cash)) return { value: f.debt - f.cash, src: "debt" };
  return null;
}

// Plain-English "how is the debt counted?" for the valuation tab.
export function debtPicture(d, m) {
  const c = netClaims(d), mc = d.quote?.marketCap, name = shortName(d);
  if (!c || !isNum(mc) || mc <= 0) return null;
  const ev = mc + c.value;
  if (c.value <= 0.05 * ev) {
    return { tone: "good", label: c.value < 0 ? "More cash than debt" : "Little debt",
      lines: [`${name} ${c.value < 0 ? `holds ${money(-c.value)} more in cash than it owes` : "owes very little"}, so debt barely affects what the shares are worth. Every method can mostly ignore it.`] };
  }
  const share = c.value / ev, heavy = share > 0.5;
  const lines = [
    `**Lenders are owed ${money(c.value)}** (debt minus cash): **${pct(share, { digits: 0 })} of the whole company** (${money(ev)}). Shareholders own the other ${pct(1 - share, { digits: 0 })}, the ${money(mc)} the shares are worth.`,
    `**Debt is a lever.** If the business became 10% more or less valuable, the debt wouldn't change, so **the shares would move about ${pct((0.1 * ev) / mc, { digits: 0 })}**.${heavy ? ` That's why ${name}'s stock swings so hard.` : ""}`,
    `**Methods 4 and 7 subtract the debt directly.** Methods 1, 2, 5 and 6 use profit or cash after interest, so they see this year's interest bill but not the risk of refinancing at higher rates${m?.heavyDebt ? " (that's why their required return is raised to 12%)" : ""}. Analysts build debt into their own targets.`,
  ];
  if (heavy && isNum(m?.eps) && m.eps > 0) lines.push(`A plain price-to-profit shortcut like "expected profit × 18" (${price(m.eps * 18)} here) ignores debt completely. Heavily indebted companies normally trade at much lower P/Es, which is partly why the market pays only ${times(m.currentPE)}.`);
  return { tone: heavy ? "bad" : "ok", label: heavy ? "Debt is most of the company" : "Meaningful debt", lines };
}

// The quarterly statement an earnings report covers: the last quarter ending before the report.
export function reportQuarter(d, reportDate) {
  const t = new Date(reportDate).getTime();
  const qs = (d.financials?.quarterly || []).filter((q) => { const e = new Date(q.period).getTime(); return e < t && t - e < 120 * 864e5; });
  return qs[qs.length - 1] || null;
}

// A miss that's mostly explained by one-time charges (write-downs etc.). Analysts' estimates
// leave those out because nobody can predict their size or timing.
export function oneOffMiss(d, x) {
  if (!x || !isNum(x.surprise) || x.surprise > -0.05 || !isNum(x.epsEstimate) || !isNum(x.epsActual)) return null;
  const q = reportQuarter(d, x.date), o = oneOffs(q);
  if (!o || o.total >= 0) return null;
  const shortfall = (x.epsEstimate - x.epsActual) * o.shares;
  return -o.total >= 0.6 * shortfall ? { ...o, charge: -o.total, perShare: -o.perShareAfterTax, missPerShare: x.epsEstimate - x.epsActual } : null;
}

// What a quarter's one-time items were, from Yahoo's line items. Amounts are the effect on profit
// (negative = charge). After-tax per share is what actually shows up in EPS.
const ONEOFF_LINES = [
  ["writeOff", "Write-down of assets (impairment)", -1], ["impairment", "Write-down of assets (impairment)", -1],
  ["restructuring", "Merger, acquisition and restructuring costs", -1], ["otherSpecial", "Other special items", -1],
  ["gainSecurities", "Gains or losses on investments", 1], ["gainBusiness", "Selling part of the business", 1], ["gainPpe", "Selling property and equipment", 1],
];
export function oneOffs(q) {
  if (!q || !isNum(q.unusualItems) || q.unusualItems === 0 || !isNum(q.netIncome) || !isNum(q.eps) || q.eps === 0) return null;
  const shares = q.netIncome / q.eps;
  if (!(shares > 0)) return null;
  const total = q.unusualItems, after = isNum(q.unusualTax) ? total - q.unusualTax : total * 0.79;
  const byLabel = {};
  for (const [k, label, sign] of ONEOFF_LINES) if (isNum(q[k]) && q[k] !== 0) byLabel[label] = (byLabel[label] || 0) + sign * q[k];
  const items = Object.entries(byLabel).map(([label, amount]) => ({ label, amount }))
    .filter((x) => Math.abs(x.amount) >= Math.max(1e6, 0.02 * Math.abs(total))).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return { total, afterTax: after, shares, perShare: total / shares, perShareAfterTax: after / shares, items, taxKnown: isNum(q.unusualTax) };
}

// A quick report card for the latest quarter: five checks, each good / bad / neutral.
export function quarterScore(d) {
  const hist = d.earnings?.history || [], x = hist[hist.length - 1];
  if (!x) return null;
  const checks = [];
  const one = oneOffMiss(d, x);
  checks.push({ name: "Profit vs estimate", kind: one ? "note" : x.surprise > 0 ? "good" : "bad", word: one ? "One-off charge" : x.surprise > 0 ? "Beat" : "Missed" });
  const qs = d.financials?.quarterly || [], last = reportQuarter(d, x.date) || qs[qs.length - 1];
  const i = qs.indexOf(last), ya = i >= 4 ? qs[i - 4] : null;
  if (last && ya && isNum(last.revenue) && isNum(ya.revenue)) {
    const g = last.revenue / ya.revenue - 1;
    checks.push({ name: "Sales growth", kind: g > 0.02 ? "good" : g < -0.02 ? "bad" : "note", word: `${pct(g, { sign: true, digits: 0 })} YoY` });
  }
  if (last && ya && [last.operatingIncome, last.revenue, ya.operatingIncome, ya.revenue].every(isNum)) {
    const dm = last.operatingIncome / last.revenue - ya.operatingIncome / ya.revenue;
    checks.push({ name: "Margins", kind: dm > 0.01 ? "good" : dm < -0.01 ? "bad" : "note", word: dm > 0.01 ? "Wider" : dm < -0.01 ? "Thinner" : "Steady" });
  }
  if (isNum(x.reaction)) checks.push({ name: "Market reaction", kind: x.reaction > 0.02 ? "good" : x.reaction < -0.02 ? "bad" : "note", word: pct(x.reaction, { sign: true }) });
  const t1 = estRow(d.earnings?.epsTrend, "+1y");
  if (isNum(t1.current) && isNum(t1["30daysAgo"])) {
    const ch = t1.current / t1["30daysAgo"] - 1;
    checks.push({ name: "Outlook (estimates)", kind: ch > 0.005 ? "good" : ch < -0.005 ? "bad" : "note", word: ch > 0.005 ? "Raised" : ch < -0.005 ? "Cut" : "Unchanged" });
  }
  const good = checks.filter((c) => c.kind === "good").length, bad = checks.filter((c) => c.kind === "bad").length;
  const net = good - bad;
  const v = net >= 2 ? ["good", "Good quarter"] : net <= -2 ? ["bad", "Weak quarter"] : ["ok", "Mixed quarter"];
  return { tone: v[0], label: v[1], good, bad, n: checks.length, checks };
}
