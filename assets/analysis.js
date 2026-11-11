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
// Amounts like insider trades: $175K, $1.4M, $13M.
export const moneyShort = (v) => (!isNum(v) ? "—" : Math.abs(v) >= 1e7 ? money(v, { digits: 0 }) : Math.abs(v) >= 1e6 ? money(v, { digits: 1 }) : Math.abs(v) >= 1e3 ? `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v) / 1e3)}K` : money(v, { compact: false }));

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
    const ln = leverageNotes(d), plainLn = ln ? ` ${ln.lines.join(" ").replace(/\*\*/g, "")}` : "";
    out.push(sig("health", "Debt load", st, { good: "Strong", ok: "Manageable", bad: "Heavy debt" }[st],
      lev < 0 ? "Net cash" : `${times(lev)} net debt/EBITDA${ln?.company ? ` · company: ${num(ln.company.ratio, 1)}×` : ""}`,
      lev < 0
        ? `Has more cash (${money(f.cash)}) than debt (${money(f.debt)}). A very safe balance sheet that gives flexibility in downturns.`
        : `Owes ${money(nd)} more than it holds in cash: about ${num(lev, 1)} years of EBITDA. ${{
            good: "Comfortable. Debt isn't a meaningful risk here.",
            ok: "Manageable, but worth watching if business slows.",
            bad: "High. Interest costs eat into profit, and there's little room for error if rates stay high or business weakens.",
          }[st]}${plainLn}`, "netDebtToEbitda"));
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

// Why our net debt / EBITDA can differ from the company's: a recent jump in debt (usually an
// acquisition) that the trailing-12-month EBITDA hasn't caught up with, and the figure the
// company itself reported in its earnings release. Shown wherever the ratio appears.
export function leverageNotes(d) {
  const lev = leverage(d);
  if (!lev || lev.ratio < 0) return null;
  const q = d.fundamentals?.debtByQuarter || [];
  let jump = null;
  for (let i = q.length - 1; i >= Math.max(1, q.length - 3); i--) {
    const a = q[i - 1].debt, b = q[i].debt;
    if (isNum(a) && isNum(b) && a > 0 && b / a - 1 >= 0.1) { jump = { from: a, to: b, pct: b / a - 1, period: q[i].period, months: 3 * (q.length - i) }; break; }
  }
  const L = d.filing?.leverage;
  const company = L && isNum(L.ratio) ? { ...L, filed: d.filing.filed } : null;
  const name = shortName(d), lines = [];
  if (jump) lines.push(`Debt jumped **${pct(jump.pct, { digits: 0 })}** (${money(jump.from)} → ${money(jump.to)}) in the quarter ending ${date(jump.period)}, usually because of an acquisition. Today's debt counts all of it, but the last 12 months of EBITDA include **at most ${jump.months} months** of whatever was bought, so this ratio reads high until a full year has passed.`);
  if (company) lines.push(`${name}'s own figure in its ${date(company.filed)} earnings release: **${num(company.ratio, 1)}×**${company.proForma ? ", on a pro forma basis (as if any deal had been owned for the full 12 months)" : ""}${company.adjusted ? ", using its Adjusted EBITDA" : ""}. Companies usually add back items like stock-based pay and count debt at the amount owed, which tends to give a lower number than ours (${num(lev.ratio, 1)}×, from Yahoo's totals).`);
  if (!lines.length) return null;
  return { lev, jump, company, lines, short: company ? `company reports ${num(company.ratio, 1)}×` : "reads high after a recent debt jump" };
}

// Plain-English warnings shown next to the fair-value result.
export function modelWarnings(d, m, fv) {
  const out = [];
  const lev = leverage(d), mcap = d.quote?.marketCap;
  if (lev && lev.ratio > 3.5) {
    out.push(`Heavy debt: ${shortName(d)} owes ${money(lev.netDebt)} more than it holds in cash` +
      (isNum(mcap) && lev.netDebt > mcap ? `, more than ${Math.floor(lev.netDebt / mcap)}× the value of all its shares (${money(mcap)})` : "") +
      `. With that much debt, a small drop in the business can wipe out a big chunk of profit for shareholders. This model doesn't capture that risk, and it's a big reason the market pays such a low P/E.` +
      (leverageNotes(d) ? ` (Net debt is ${num(lev.ratio, 1)}× EBITDA by our count; ${leverageNotes(d).short}. See Financials → Balance sheet.)` : ""));
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
      const ln = leverageNotes(d);
      return l ? { tone: l.ratio < 1.5 ? "good" : l.ratio < 3.5 ? "ok" : "bad", value: l.ratio < 0 ? "Net cash" : times(l.ratio), text: (l.ratio < 0 ? "More cash than debt" : l.ratio < 1.5 ? "Under 1.5×: comfortable" : l.ratio < 3.5 ? "1.5–3.5×: manageable" : "Over 3.5×: high") + (ln ? ` (${ln.short})` : "") } : null;
    }
    case "currentRatio": return isNum(f.currentRatio) ? { tone: f.currentRatio >= 1 ? "good" : "ok", value: num(f.currentRatio, 2), text: f.currentRatio >= 1 ? "Over 1: comfortable" : "Under 1: worth noting" } : null;
    case "roe": return band(f.roe, 0, 0.15, p1, { good: "Over 15%: good", ok: "Positive but under 15%", bad: "Negative" });
    case "evToEbitda": return isNum(v.evToEbitda) && v.evToEbitda > 0 ? band(v.evToEbitda, 20, 8, times, { good: "Under 8×: cheap", ok: "8–20×: typical", bad: "Over 20×: expensive" }, false) : null;
    case "dividendYield": return isNum(v.dividendYield) && v.dividendYield > 0 ? { tone: v.dividendYield > 0.06 || v.dividendYield < 0.01 ? "ok" : "good", value: pct(v.dividendYield, { digits: 2 }), text: v.dividendYield > 0.06 ? "Over 6%: check it's sustainable" : v.dividendYield < 0.01 ? "Under 1%: small; most of your return comes from the price" : "1–6%: a normal, healthy yield" } : null;
    case "payoutRatio": return isNum(v.payoutRatio) && v.payoutRatio > 0 ? band(v.payoutRatio, 1, 0.6, (x) => pct(x, { digits: 0 }), { good: "Under 60%: comfortable", ok: "60–100%: stretched", bad: "Over 100%: paying more than it earns" }, false) : null;
    case "cashPayout": case "dividendGrowth": case "dividendStreak": {
      const k = { cashPayout: "cash", dividendGrowth: "growth", dividendStreak: "record" }[key];
      const c = dividendStory(d)?.checks?.find((x) => x.key === k);
      return c && c.status !== "na" ? { tone: c.status, value: c.value, text: c.word } : null;
    }
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
    case "shareCount": {
      const c = cashUses(d);
      if (!c || !isNum(c.shareChg)) return null;
      const yrs = Math.max(1, c.rows.length - 1), per = Math.pow(1 + c.shareChg, 1 / yrs) - 1;
      return { tone: per <= 0.005 ? "good" : per <= 0.02 ? "ok" : "bad", value: `${pct(c.shareChg, { sign: true, digits: 0 })} over ${yrs} year${yrs === 1 ? "" : "s"}`,
        text: per < -0.005 ? "Falling: each share owns more" : per <= 0.005 ? "About flat" : per <= 0.02 ? "Rising slowly" : "Rising over 2% a year: dilution" };
    }
    case "capitalAllocation": {
      const c = cashUses(d);
      if (!c || !(c.fcf > 0)) return null;
      const bad = c.returned > c.fcf * 1.1 && c.debt > 0;
      return { tone: bad ? "bad" : c.tone, value: `${pct(c.returned / c.fcf, { digits: 0 })} of free cash flow handed back`, text: bad ? "Paying out more than it makes, with borrowed money" : c.label };
    }
    case "insiders": {
      const s = insiderSummary(d);
      if (!s) return null;
      return { tone: s.buyers ? "good" : "ok", value: s.buyers ? `${s.buyers} buyer${s.buyers === 1 ? "" : "s"} in 12 months` : `${s.sellers} seller${s.sellers === 1 ? "" : "s"}, no buyers in 12 months`, text: s.label };
    }
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

// ------------------------------------------------------------------ insiders

// Open-market buys and sales by executives and directors over the last `days`.
// Grants (pay), gifts and option exercises say little about opinion, so they're counted separately.
export function insiderSummary(d, days = 365) {
  const tx = d.insiders?.transactions;
  if (!tx) return null;
  const since = Date.now() - days * 864e5;
  const recent = tx.filter((x) => new Date(x.date + "T12:00:00") >= since);
  const of = (k) => recent.filter((x) => x.kind === k);
  const total = (xs) => xs.reduce((s, x) => s + (x.value || 0), 0);
  const buys = of("buy"), sells = of("sell"), awards = of("award");
  const bought = total(buys), sold = total(sells);
  const buyers = new Set(buys.map((x) => x.name)).size, sellers = new Set(sells.map((x) => x.name)).size;
  const cap = d.quote?.marketCap;
  const s = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const lines = [];
  if (buys.length) lines.push(`**${s(buyers, "insider")} bought ${moneyShort(bought)}** of stock with their own money${buyers > 1 ? "" : ` (${buys[0].name}${buys[0].role ? `, ${buys[0].role.toLowerCase()}` : ""})`}. Buying is rare and means more than selling: the only reason to buy is expecting the price to rise.`);
  else lines.push("**No insider bought shares on the open market.** That's normal: most executives already get plenty of stock as pay.");
  if (sells.length) lines.push(`${s(sellers, "insider")} sold ${moneyShort(sold)}${isNum(cap) && cap > 0 && sold / cap >= 0.0001 ? ` (${pct(sold / cap, { digits: 2 })} of the company's value)` : ""}. Selling is usually routine: executives are paid mostly in stock and sell to pay taxes, spread out their savings or buy a house, often through plans set up months in advance.`);
  if (awards.length) lines.push(`${s(awards.length, "grant")} of shares as part of pay aren't counted.`);
  const [tone, label] = buyers >= 2 ? ["good", "Insiders buying"] : buyers === 1 ? ["good", "One insider buying"]
    : sells.length ? ["ok", "Selling only (usually routine)"] : ["ok", "No buying or selling"];
  return { recent, buys, sells, awards, bought, sold, buyers, sellers, tone, label, lines, days };
}

// ------------------------------------------------------------------ drops from a peak

const monthsBetween = (a, b) => (new Date(b) - new Date(a)) / (30.44 * 864e5);

// How far the price fell below its previous high, day by day (0 = at a high, −0.2 = 20% below).
// Episodes run from a high to the next new high; `recoverDate` is null when it hasn't got back yet.
export function drawdowns(dates, close) {
  if (!dates?.length || dates.length !== close?.length) return null;
  let peak = close[0], pi = 0, cur = null;
  const under = [], episodes = [];
  for (let i = 0; i < close.length; i++) {
    const c = close[i];
    if (c >= peak) {
      if (cur) { cur.ri = i; episodes.push(cur); cur = null; }
      peak = c; pi = i; under.push(0); continue;
    }
    const dd = c / peak - 1;
    under.push(dd);
    if (!cur) cur = { pi, ti: i, depth: dd, ri: null };
    else if (dd < cur.depth) { cur.ti = i; cur.depth = dd; }
  }
  if (cur) episodes.push(cur);
  const fmt = (e) => e && {
    depth: e.depth, peakDate: dates[e.pi], peakPrice: close[e.pi], troughDate: dates[e.ti], troughPrice: close[e.ti],
    recoverDate: e.ri != null ? dates[e.ri] : null, fallMonths: monthsBetween(dates[e.pi], dates[e.ti]),
    totalMonths: e.ri != null ? monthsBetween(dates[e.pi], dates[e.ri]) : null,
  };
  const worst = episodes.reduce((a, b) => (!a || b.depth < a.depth ? b : a), null);
  return {
    under, worst: fmt(worst),
    big: episodes.filter((e) => e.depth <= -0.2).map(fmt),
    now: { depth: under[under.length - 1], peakDate: dates[pi], peakPrice: peak },
    start: dates[0],
  };
}

// ------------------------------------------------------------------ snapshot gaps
// Stretches of more than a week with no daily snapshot (weekends and holidays are shorter),
// e.g. while the ticker was archived or updates were failing. Several archive/unarchive
// cycles simply give several gaps.
export function snapshotGaps(hist, minDays = 8) {
  const out = [];
  for (let i = 1; i < (hist?.length || 0); i++) {
    const last = hist[i - 1].date, next = hist[i].date;
    const days = Math.round((new Date(next) - new Date(last)) / 864e5);
    if (days >= minDays) out.push({ last, next, days: days - 1 });
  }
  return out;
}

export function gapText(g) {
  const f = (s) => date(s, { month: "short", day: "numeric", year: "numeric" });
  return `${g.days} days (${f(g.last)} → ${f(g.next)})`;
}

// ------------------------------------------------------------------ benchmarks
// The price chart compares against funds (dividends folded in, like every ticker's prices),
// not the indexes, which leave dividends out. Colors stay fixed per benchmark.
export const BENCHES = [
  { key: "SPY", name: "S&P 500", color: "var(--series-2)",
    about: "500 of the largest US companies, weighted by size. The usual meaning of \"the market\"." },
  { key: "QQQ", name: "Nasdaq 100", color: "var(--series-3)",
    about: "The 100 largest non-financial companies on the Nasdaq exchange. Heavy in tech, so it shows whether a stock beat tech as a group." },
];
const NOT_PLAIN = /equal|growth|value|dividend|volatil|momentum|quality|leverag|2x|3x|inverse|short|bear|bull|ESG|buffer|option|covered/i;
// True when the ticker is (or is a plain fund tracking) that benchmark's index, so comparing would be pointless.
export function tracksBench(d, key) {
  if (d.symbol === key) return true;
  if (d.type !== "ETF") return false;
  const name = `${d.name || ""} ${d.longName || ""}`;
  const re = key === "SPY" ? /S&P\s*500/i : /Nasdaq[-\s]*100/i;
  return re.test(name) && !NOT_PLAIN.test(name);
}

// A benchmark's move between two dates.
export function benchMove(bench, from, to) {
  if (!bench?.dates?.length) return null;
  const at = (dt) => { const i = bench.dates.findIndex((x) => x >= dt); return i < 0 ? null : bench.close[i]; };
  const a = at(from), b = at(to);
  return isNum(a) && isNum(b) ? b / a - 1 : null;
}

export function dropStory(d, bench) {
  const dd = drawdowns(d.prices?.dates, d.prices?.close);
  if (!dd?.worst) return null;
  const w = dd.worst, yrs = Math.round(monthsBetween(dd.start, d.prices.dates[d.prices.dates.length - 1]) / 12);
  const mo = (m) => (m < 1.5 ? "about a month" : m < 21 ? `${Math.round(m)} months` : `${(m / 12).toFixed(1).replace(".0", "")} years`);
  const when = (s) => date(s, { month: "short", year: "numeric" });
  const lines = [];
  lines.push(`**Worst drop in ${yrs} years: ${pct(w.depth, { digits: 0 })}**, from ${price(w.peakPrice)} (${when(w.peakDate)}) to ${price(w.troughPrice)} (${when(w.troughDate)}).` +
    (w.recoverDate ? ` It took **${mo(w.totalMonths)}** from that high to get back to it.` : " **It hasn't got back to that high yet.**"));
  const bm = !tracksBench(d, "SPY") ? benchMove(bench, w.peakDate, w.troughDate) : null;
  if (isNum(bm)) lines.push(`The S&P 500 ${bm < -0.005 ? `fell ${pct(-bm, { digits: 0 })}` : bm > 0.005 ? `rose ${pct(bm, { digits: 0 })}` : "was flat"} over the same stretch, so ${bm > w.depth * 0.6 ? "most of the drop was this company's own, not the whole market's" : "much of it was the whole market falling"}.`);
  if (dd.big.length > 1) lines.push(`It fell 20% or more ${dd.big.length} separate times in ${yrs} years.`);
  const n = dd.now;
  lines.push(n.depth > -0.03 ? "Today it's at or near its high." : `Today it's **${pct(-n.depth, { digits: 0 })} below** its high of ${price(n.peakPrice)} (${when(n.peakDate)}).`);
  return { ...dd, years: yrs, lines };
}

// ------------------------------------------------------------------ where the cash goes

// The last few fiscal years of free cash flow and what it was spent on. Cash-flow rows are
// signed the way the statement shows them: money going out is negative.
export function cashUses(d, years = 4) {
  const rows = (d.financials?.annual || []).filter((r) => isNum(r.freeCashflow)).slice(-years);
  if (rows.length < 2) return null;
  const S = (k) => rows.reduce((s, r) => s + (isNum(r[k]) ? r[k] : 0), 0);
  const fcf = S("freeCashflow"), buybacks = -S("buybacks"), dividends = -S("dividendsPaid"),
    debt = S("netDebtIssued"), acq = -S("acquisitions"), issued = S("stockIssued");
  const returned = buybacks + dividends;
  const name = shortName(d);
  const fy = (r) => `FY${r.period.slice(2, 4)}`;
  const span = `${fy(rows[0])}–${fy(rows[rows.length - 1])}`;
  const sh0 = rows.find((r) => isNum(r.dilutedShares))?.dilutedShares, sh1 = [...rows].reverse().find((r) => isNum(r.dilutedShares))?.dilutedShares;
  const shareChg = isNum(sh0) && isNum(sh1) && sh0 ? sh1 / sh0 - 1 : null;
  const last = rows[rows.length - 1], cap = d.quote?.marketCap;
  const lastReturned = -((last.buybacks || 0) + (last.dividendsPaid || 0));
  const yieldNow = isNum(cap) && cap > 0 && lastReturned > 0 ? lastReturned / cap : null;

  const lines = [];
  lines.push(`Over ${rows.length} fiscal years (${span}) ${name} made **${money(fcf)} of free cash flow**: the cash left after running and investing in the business.`);
  if (returned > 0) lines.push(`It handed **${money(returned)}${fcf > 0 ? ` (${pct(returned / fcf, { digits: 0 })} of it)` : ""}** back to shareholders: ${money(buybacks)} buying back its own shares${dividends > 0 ? ` and ${money(dividends)} in dividends.` : ". It pays no dividend."}`);
  else lines.push("It didn't buy back shares or pay dividends.");
  if (debt > 0.05 * Math.abs(fcf)) lines.push(`It **borrowed ${money(debt)} more than it repaid**${returned > fcf ? ", which helped pay for handing back more cash than it made" : ""}.`);
  else if (debt < -0.05 * Math.abs(fcf)) lines.push(`It **paid down ${money(-debt)} of debt** (after any new borrowing).`);
  if (acq > 0.05 * Math.abs(fcf)) {
    const big = rows.reduce((a, r) => (-(r.acquisitions || 0) > -(a.acquisitions || 0) ? r : a), rows[0]);
    lines.push(`It spent **${money(acq)} buying other companies**${-(big.acquisitions || 0) > 0.6 * acq ? `, mostly in ${fy(big)}` : ""}.`);
  }
  if (isNum(shareChg)) lines.push(shareChg < -0.01 ? `Its share count **fell ${pct(-shareChg, { digits: 0 })}**, so each remaining share owns a bigger slice of the company.`
    : shareChg > 0.01 ? `Its share count **rose ${pct(shareChg, { digits: 0 })}**: new shares (usually paid to employees) shrink each existing share's slice.`
    : buybacks > 0 ? "Its share count barely moved: the buybacks mostly offset the new shares it pays employees with." : "Its share count barely moved.");

  const parts = [
    { key: "buybacks", label: "Buybacks", value: buybacks },
    { key: "dividends", label: "Dividends", value: dividends },
    { key: "debt", label: "Debt repaid", value: debt < 0 ? -debt : 0 },
    { key: "acq", label: "Acquisitions", value: acq > 0 ? acq : 0 },
  ];
  const left = fcf - parts.reduce((s, p) => s + p.value, 0);
  const [tone, label] = returned > fcf * 1.1 && debt > 0 ? ["ok", "Pays out more than it makes"]
    : acq > returned && acq > 0.3 * fcf ? ["ok", "Spends most on acquisitions"]
    : returned >= 0.6 * fcf ? ["good", "Returns most of its cash"] : ["ok", "Keeps or reinvests most of it"];
  return { rows, span, fcf, buybacks, dividends, debt, acq, issued, returned, shareChg, sh0, sh1, yieldNow, parts, left, tone, label, lines };
}

// ------------------------------------------------------------------ dividends

const DAY = 864e5;
export const FREQ_WORD = { 12: "every month", 4: "every quarter", 2: "twice a year", 1: "once a year" };
const PAY_WORD = { 12: "monthly", 4: "quarterly", 2: "half-yearly", 1: "yearly" };
const median = (xs) => {
  const s = xs.filter(isNum).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

// Everything the Dividends tab shows. Thresholds here match the glossary rules for
// cashPayout, dividendGrowth and dividendStreak (and judge("payoutRatio"/"netDebtToEbitda")).
export function dividendStory(d) {
  const dv = d.dividends;
  if (!dv) return null;
  const name = shortName(d), isFund = d.type === "ETF", px = d.quote?.price;
  if (!dv.pays || !dv.payments?.length) return { pays: false, name };
  const all = dv.payments.map((p) => ({ ...p, t: Date.parse(`${p.date}T12:00:00`), year: +p.date.slice(0, 4) }));
  const last = all[all.length - 1];

  // how often: the typical gap between the last few payments
  const gaps = all.slice(-6).map((p, i, a) => (i ? (p.t - a[i - 1].t) / DAY : null)).filter(isNum);
  const gap = median(gaps);
  const freq = !isNum(gap) ? 4 : gap <= 45 ? 12 : gap <= 130 ? 4 : gap <= 250 ? 2 : 1;

  // one-time "special" payments (companies only): well above the payments around them
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (isFund) { p.special = false; continue; }
    const base = median(all.slice(Math.max(0, i - 4), i).map((x) => x.regular ?? x.amount)), next = all[i + 1]?.amount;
    p.special = isNum(base) && p.amount > 1.8 * base && (next == null ? isNum(dv.forwardRate) && p.amount > (1.5 * dv.forwardRate) / freq : next < p.amount / 1.5);
    // paid on the normal schedule: Yahoo lumps the regular payment and the special together
    if (p.special && i && (p.t - all[i - 1].t) / DAY > 0.6 * (gap || 91)) { p.regular = base; p.extra = p.amount - base; }
  }
  // Yahoo glitches: a lone tiny payment between two normal ones (VZ, Jul 2000)
  if (!isFund) for (let i = 1; i < all.length - 1; i++) {
    const a = all[i - 1].amount, b = all[i].amount, c = all[i + 1].amount;
    all[i].glitch = !all[i].special && b < a * 0.5 && c >= a * 0.95;
  }
  // regular payments; a lumped special counts only its regular part
  const reg = all.filter((p) => (!p.special || isNum(p.regular)) && !p.glitch).map((p) => (isNum(p.regular) ? { ...p, amount: p.regular, special: false } : p));
  // each payment's yearly rate, from the typical gap of the schedule it starts (the next few
  // payments), so one payment missing from Yahoo (VZ, Jul 1997) isn't read as a switch to
  // twice a year, while MSFT's move from one $0.16 a year to four of $0.08 (2004) is a raise
  const fq = (days) => (days <= 45 ? 12 : days <= 130 ? 4 : days <= 250 ? 2 : 1);
  reg.forEach((p, i) => {
    const gs = [];
    for (let j = i; j < Math.min(reg.length - 1, i + 3); j++) gs.push((reg[j + 1].t - reg[j].t) / DAY);
    p.f = gs.length ? fq(median(gs)) : reg[i - 1]?.f ?? freq;
    p.yearly = p.amount * p.f;
  });
  all.forEach((p) => { const r = reg.find((x) => x.date === p.date); if (r) p.yearly = r.yearly; });
  const lastReg = reg[reg.length - 1] || last;
  const win = (365 - 182.5 / freq) * DAY; // one year of payments, with slack for dates that drift
  const ttm = (t) => reg.filter((p) => p.t <= t && p.t > t - win).reduce((s, p) => s + p.amount, 0);
  const paidRate = isFund ? ttm(last.t) : lastReg.amount * freq;
  // a raise that's been announced but not paid yet shows up in Yahoo's forward rate
  const fr = dv.forwardRate;
  const announced = !isFund && isNum(fr) && fr > paidRate * 1.005 && fr < paidRate * 1.6 ? { rate: fr, each: fr / freq, from: lastReg.amount, chg: fr / paidRate - 1 } : null;
  const rate = announced ? announced.rate : paidRate;
  const yld = isNum(px) && px > 0 ? rate / px : null;

  // growth of the yearly payout (trailing 12 months), N years back
  const growth = {};
  for (const n of [1, 3, 5, 10]) {
    const t0 = last.t - n * 365.25 * DAY;
    if (reg[0].t > t0 - 300 * DAY) continue; // need a full year of payments before the start
    const a = ttm(t0), b = ttm(last.t);
    if (a > 0 && b > 0) growth[n] = { from: a, to: b, cagr: (b / a) ** (1 / n) - 1 };
  }

  // raises and cuts (companies only; a fund's payout moves with what its holdings pay)
  const raises = [], cuts = [];
  if (!isFund) for (let i = 1; i < reg.length; i++) {
    const a = reg[i - 1], b = reg[i];
    const e = { date: b.date, year: b.year, from: a.amount, to: b.amount, fromYearly: a.yearly, toYearly: b.yearly, freqChange: a.f !== b.f };
    if (b.yearly > a.yearly * 1.005) raises.push(e);
    else if (b.yearly < a.yearly * 0.99) cuts.push(e);
  }
  const thisYear = new Date().getFullYear(), firstYear = all[0].year;
  const rYears = new Set(raises.map((r) => r.year)), cYears = new Set(cuts.map((c) => c.year));
  // Years of raises in a row: a chain of raises at most 18 months apart with no cut, ending
  // within 18 months of today. Calendar years alone break when a raise shifts from one year
  // into the next (Target: Aug 2000, then Feb 2002).
  const GAP = 550 * DAY, tOf = (x) => Date.parse(`${x.date}T12:00:00`);
  const chain = [];
  if (!isFund) {
    const ev = [...raises.map((x) => ({ ...x, up: true })), ...cuts.map((x) => ({ ...x, up: false }))].sort((a, b) => a.date.localeCompare(b.date));
    let prevT = Date.now();
    for (let i = ev.length - 1; i >= 0 && ev[i].up && prevT - tOf(ev[i]) <= GAP; i--) { chain.unshift(ev[i]); prevT = tOf(ev[i]); }
  }
  const streak = chain.length ? (announced ? thisYear : chain[chain.length - 1].year) - chain[0].year + 1 : announced ? 1 : 0;
  if (announced) rYears.add(thisYear);
  // reached the start of our record, and the company was already paying before it
  const sinceYear = +(dv.firstPaid || all[0].date).slice(0, 4);
  const streakAtLeast = chain.length > 0 && tOf(chain[0]) - reg[0].t <= GAP && sinceYear < firstYear;
  const lastCut = cuts[cuts.length - 1] || null, lastRaise = raises[raises.length - 1] || null;
  const cutText = (c) => (c.freqChange ? `${price(c.fromYearly)} → ${price(c.toYearly)} a year` : `${price(c.from)} → ${price(c.to)} a payment`);
  const recordYears = (last.t - all[0].t) / (365.25 * DAY);
  const yearsSinceCut = lastCut ? (Date.now() - Date.parse(`${lastCut.date}T12:00:00`)) / (365.25 * DAY) : null;

  // per calendar year, for the chart (the first year in our record is usually partial)
  const byYear = [];
  for (let y = firstYear + 1; y <= thisYear; y++) {
    const ps = all.filter((p) => p.year === y);
    if (!ps.length && y < thisYear) { byYear.push({ year: y, regular: 0, special: 0, count: 0, partial: false }); continue; }
    byYear.push({ year: y, regular: ps.filter((p) => !p.glitch).reduce((s, p) => s + (p.special ? p.regular || 0 : p.amount), 0), special: ps.filter((p) => p.special).reduce((s, p) => s + (p.extra ?? p.amount), 0),
      count: ps.length, partial: y === thisYear, raised: rYears.has(y), cut: cYears.has(y) });
  }

  // yield today vs its own past (our monthly trailing-12-month yields)
  const yh = dv.yieldHistory || { dates: [], values: [] };
  const ys = yh.values.filter(isNum), ySorted = [...ys].sort((a, b) => a - b);
  const usual = ys.length >= 24 ? { mid: median(ys), lo: quantile(ySorted, 0.1), hi: quantile(ySorted, 0.9), years: Math.round(ys.length / 12) } : null;
  const yNow = ys[ys.length - 1] ?? yld;
  const vsUsual = usual && isNum(yNow) ? (yNow > usual.hi ? "high" : yNow < usual.lo ? "low" : "usual") : null;

  // what dividends added over five years
  const r = dv.returns;
  const ret = r && r.rawStart > 0 && r.adjStart > 0 ? {
    start: r.start, end: r.end, years: (Date.parse(r.end) - Date.parse(r.start)) / (365.25 * DAY),
    priceOnly: r.rawEnd / r.rawStart - 1, total: r.adjEnd / r.adjStart - 1, rawStart: r.rawStart, rawEnd: r.rawEnd,
    yoc: rate / r.rawStart,
  } : null;
  if (ret) ret.added = ret.total - ret.priceOnly;
  const income = isNum(px) && px > 0 ? { invest: 10000, shares: 10000 / px, year: (10000 / px) * rate, each: (10000 / px) * rate / freq } : null;

  // next dates: Yahoo's ex-date can be the one that just passed
  const today = new Date().toISOString().slice(0, 10);
  const exDate = dv.exDate || null, payDate = dv.payDate || null;

  // safety checklist (companies only)
  const checks = [];
  if (!isFund) {
    const q = (d.financials?.quarterly || []).slice(-4);
    const qOk = q.length === 4 && q.every((x) => isNum(x.freeCashflow));
    const div12 = qOk ? -q.reduce((s, x) => s + (isNum(x.dividendsPaid) ? x.dividendsPaid : 0), 0) : null;
    const fcf12 = qOk ? q.reduce((s, x) => s + x.freeCashflow, 0) : null;
    const an = (d.financials?.annual || []).filter((x) => isNum(x.freeCashflow)).slice(-4);
    const divA = -an.reduce((s, x) => s + (isNum(x.dividendsPaid) ? x.dividendsPaid : 0), 0), fcfA = an.reduce((s, x) => s + x.freeCashflow, 0);
    const cp = isNum(fcf12) && fcf12 > 0 && div12 > 0 ? div12 / fcf12 : null;
    const fy = (x) => `FY${x.period.slice(2, 4)}`;
    const cash = { key: "cash", label: "Paid from cash", term: "cashPayout", fcf12, div12, payout: cp,
      multi: an.length >= 2 && fcfA > 0 && divA > 0 ? { payout: divA / fcfA, span: `${fy(an[0])}–${fy(an[an.length - 1])}`, div: divA, fcf: fcfA } : null };
    if (isNum(fcf12) && fcf12 <= 0 && div12 > 0) Object.assign(cash, { status: "bad", word: "No spare cash", value: "Free cash flow negative",
      text: `Over the last 4 quarters ${name} paid ${money(div12)} in dividends while its free cash flow was ${money(fcf12)}, so the dividend came from savings or borrowing.` });
    else if (isNum(cp)) Object.assign(cash, { status: cp < 0.6 ? "good" : cp <= 0.9 ? "ok" : "bad", word: cp < 0.6 ? "Comfortable" : cp <= 0.9 ? "Tight" : "Stretched",
      value: `${pct(cp, { digits: 0 })} of free cash flow`,
      text: `Last 4 quarters: ${money(div12)} of dividends ÷ ${money(fcf12)} of free cash flow = ${pct(cp, { digits: 0 })}. ${cp < 0.6 ? "Plenty left over for the business, debt or buybacks." : cp <= 0.9 ? "Most of the spare cash goes to the dividend, so a bad year leaves little room." : "It pays out nearly all (or more than) the cash it has spare."}` });
    else Object.assign(cash, { status: "na", word: "No data", value: "—", text: "The cash-flow statements needed for this aren't available." });
    checks.push(cash);

    const pj = judge("payoutRatio", d), pr = d.valuation?.payoutRatio;
    checks.push(pj ? { key: "profit", label: "Paid from profit", term: "payoutRatio", status: pj.tone, word: pj.tone === "good" ? "Comfortable" : pj.tone === "ok" ? "Stretched" : "Over 100%", value: `${pct(pr, { digits: 0 })} of profit`,
      text: `Dividends take ${pct(pr, { digits: 0 })} of the last 12 months' profit (Yahoo's payout ratio). ${pj.text}.${pr > 1 && isNum(cp) && cp < 0.9 ? " Cash flow covers it, though: profit can be pulled down by non-cash charges like write-downs." : ""}` }
      : { key: "profit", label: "Paid from profit", term: "payoutRatio", status: "na", word: "No data", value: "—", text: "No payout ratio available (or no profit to compare against)." });

    const lj = judge("netDebtToEbitda", d);
    checks.push(lj ? { key: "debt", label: "Debt load", term: "netDebtToEbitda", status: lj.tone, word: lj.tone === "good" ? "Light" : lj.tone === "ok" ? "Manageable" : "Heavy", value: lj.value === "Net cash" ? "More cash than debt" : `Net debt ${lj.value} EBITDA`,
      text: `${lj.text}. Interest and debt repayments come before dividends, so heavy debt is the most common reason companies cut.${leverageNotes(d) ? ` ${leverageNotes(d).lines.join(" ").replace(/\*\*/g, "")}` : ""}` }
      : { key: "debt", label: "Debt load", term: "netDebtToEbitda", status: "na", word: "No data", value: "—", text: "Not enough balance-sheet data." });

    const tr = { key: "record", label: "Track record", term: "dividendStreak" };
    if (lastCut && yearsSinceCut < 3) Object.assign(tr, { status: "bad", word: "Cut recently", value: `Cut in ${lastCut.year}`, text: `It cut the dividend in ${date(lastCut.date, { month: "short", year: "numeric" })} (${cutText(lastCut)}). Recent cuts tend to signal the business is under pressure.` });
    else if (lastCut && yearsSinceCut < 10) Object.assign(tr, { status: "ok", word: "Cut in the last 10 years", value: `Last cut ${lastCut.year}`, text: `It cut the dividend in ${lastCut.year} (${cutText(lastCut)}) and ${streak ? `has raised it ${streak} year${streak === 1 ? "" : "s"} in a row since` : "hasn't cut since"}.` });
    else if (recordYears < 10 && !lastCut) Object.assign(tr, { status: "na", word: "Too new to judge", value: `Paying since ${sinceYear}`, text: `${name} only started paying in ${sinceYear}, so there's no long record yet.${streak ? ` It has raised it every year so far.` : ""}` });
    else Object.assign(tr, { status: "good", word: streak >= 10 ? "Long record of raises" : "No cuts in 10+ years", value: streak ? `${streak}${streakAtLeast ? "+" : ""} year${streak === 1 && !streakAtLeast ? "" : "s"} of raises` : `No cut since ${lastCut ? lastCut.year : `at least ${firstYear}`}`,
      text: lastCut ? `No cut since ${lastCut.year}${streak ? `, and ${streak} years of raises in a row` : ""}.` : `No cut in the ${Math.floor(recordYears)} years of payments on record${streak ? `, with ${streak}${streakAtLeast ? "+" : ""} years of raises in a row` : ""}.` });
    checks.push(tr);

    const g = growth[5] || growth[3], gn = growth[5] ? 5 : 3;
    checks.push(g ? { key: "growth", label: "Beats inflation", term: "dividendGrowth", status: g.cagr >= 0.05 ? "good" : g.cagr >= 0.02 ? "ok" : "bad",
      word: g.cagr >= 0.05 ? "Growing well" : g.cagr >= 0.02 ? "About inflation" : g.cagr >= 0 ? "Falling behind inflation" : "Shrinking", value: `${pct(g.cagr, { sign: true })} a year over ${gn} years`,
      text: `The yearly payout went from ${price(g.from)} to ${price(g.to)} a share over ${gn} years: ${pct(g.cagr, { sign: true })} a year. Prices have risen roughly 2–3% a year over the long run, so ${g.cagr >= 0.02 ? "the income has kept its buying power" : "the income buys a little less each year"}.` }
      : { key: "growth", label: "Beats inflation", term: "dividendGrowth", status: "na", word: "Too new to judge", value: "Under 3 years of payments", text: "Needs at least 3 years of payments to measure growth." });
  }
  const tally = overall(checks);
  const verdict = tally.score == null ? null : tally.score >= 75 ? { tone: "good", label: "Looks well covered" } : tally.score >= 50 ? { tone: "ok", label: "A few things to watch" } : { tone: "bad", label: "Under strain" };

  // the plain-English summary
  const lines = [];
  if (isFund) lines.push(`${name} paid out **${price(rate)} a share over the last 12 months**, ${PAY_WORD[freq]}. At today's ${price(px)} that's a **${pct(yld, { digits: 2 })} yield**. A fund passes on what its companies pay, so each payment differs a little.`);
  else if (announced) lines.push(`${name} pays ${price(lastReg.amount)} a share ${FREQ_WORD[freq]} and has **announced a raise to ${price(announced.each)}** (${pct(announced.chg, { sign: true })}), about **${price(rate)} a year**. At today's ${price(px)} price that's a **${pct(yld, { digits: 2 })} yield**.`);
  else lines.push(`${name} pays **${price(lastReg.amount)} a share ${FREQ_WORD[freq]}**, about **${price(rate)} a year**. At today's ${price(px)} price that's a **${pct(yld, { digits: 2 })} yield**.`);
  if (!isFund) {
    if (streak >= 1) lines.push(`It has **raised its dividend ${sinceYear >= thisYear - streak ? `every year since it started paying in ${sinceYear}` : `${streak}${streakAtLeast ? "+" : ""} year${streak === 1 ? "" : "s"} in a row`}**${streakAtLeast ? ` (our record starts in ${firstYear})` : ""}${lastRaise ? `; the latest raise was ${pct(lastRaise.toYearly / lastRaise.fromYearly - 1, { digits: 1 })}, in ${date(lastRaise.date, { month: "short", year: "numeric" })}` : ""}.`);
    else if (lastRaise) lines.push(`Its last raise was in ${date(lastRaise.date, { month: "short", year: "numeric" })}${lastCut && lastCut.date > lastRaise.date ? "" : "; it hasn't raised it since"}.`);
    if (lastCut) lines.push(`It last **cut its dividend in ${lastCut.year}** (${cutText(lastCut)}).`);
    else lines.push(`It has paid a dividend since ${sinceYear}, with **no cuts** in the ${Math.max(1, Math.floor(recordYears))} years on record.`);
    const sp = all.filter((p) => p.special && p.year > thisYear - 15), spYears = [...new Set(sp.map((p) => p.year))];
    if (sp.length) lines.push(`It also paid ${sp.length === 1 ? "a one-time special dividend" : "one-time special dividends"} in ${spYears.join(", ")} (${sp.map((p) => price(p.extra ?? p.amount)).join(", ")}), left out of the growth and yield.`);
  }
  const g5 = growth[5] || growth[3];
  if (g5) lines.push(`Over ${growth[5] ? 5 : 3} years the yearly payout grew **${pct(g5.cagr, { sign: true })} a year**${growth[10] ? `, and ${pct(growth[10].cagr, { sign: true })} a year over 10` : ""}.`);
  if (vsUsual) lines.push(vsUsual === "high" && growth[1]?.cagr > 0.25 ? `Today's yield is **higher than usual** for ${name} (its middle over ${usual.years} years: ${pct(usual.mid, { digits: 2 })}), mainly because the dividend itself rose ${pct(growth[1].cagr, { digits: 0 })} in the last year.`
    : vsUsual === "high" ? `Today's yield is **higher than usual** for ${name} (its middle over ${usual.years} years: ${pct(usual.mid, { digits: 2 })}). That happens when the price falls faster than the dividend: either a bargain or a sign the market doubts the dividend.`
    : vsUsual === "low" ? `Today's yield is **lower than usual** for ${name} (its middle over ${usual.years} years: ${pct(usual.mid, { digits: 2 })}), mostly because the price has risen faster than the dividend.`
    : `Today's yield is **in its usual range** (${pct(usual.lo, { digits: 1 })}–${pct(usual.hi, { digits: 1 })} over ${usual.years} years).`);

  return { pays: true, name, isFund, freq, announced, paidRate, freqWord: FREQ_WORD[freq], payWord: PAY_WORD[freq], last, lastReg, rate, yld, growth, raises, cuts, streak, streakAtLeast, lastCut, lastRaise,
    recordYears, sinceYear, firstYear, byYear, yh, usual, yNow, vsUsual, ret, income, exDate, payDate, today, checks, tally, verdict, lines, payments: all };
}

// ------------------------------------------------------------------ what changed since your last look

// The few numbers compared between visits. Stored in this browser only.
export function fingerprint(d, score) {
  const a = d.analysts || {}, e = d.earnings || {};
  const sc = ratingScore((a.summary || []).find((r) => r.period === "0m"));
  const maxDate = (xs) => xs.reduce((m, x) => (x && x > m ? x : m), "");
  return {
    at: d.updated, seen: new Date().toISOString(), price: d.quote?.price ?? null, score: score ?? null,
    eps1y: estRow(e.epsTrend, "+1y").current ?? null, tmed: a.targets?.median ?? a.targets?.mean ?? null,
    net: sc?.net ?? null, lastAction: maxDate((a.actions || []).map((x) => x.date)) || null,
    report: maxDate((e.history || []).map((x) => x.date)) || null, filing: d.filing?.filed || null,
    insider: maxDate((d.insiders?.transactions || []).map((x) => x.date)) || null,
    er: d.fund?.expenseRatio ?? null,
    div: d.type === "EQUITY" && d.dividends?.pays ? dividendStory(d)?.lastReg?.amount ?? null : null,
  };
}

// What moved between the fingerprint `b` and today's data, in plain English.
// Each item: { tone: up|down|good|bad|note, text, tab }.
export function changesSince(d, b, score) {
  if (!b) return [];
  const now = fingerprint(d, score), out = [];
  const rel = (x, y) => (isNum(x) && isNum(y) && y !== 0 ? x / y - 1 : null);
  const pc = rel(now.price, b.price);
  if (isNum(pc) && Math.abs(pc) >= 0.001) out.push({ tone: pc > 0 ? "up" : "down", text: `Price ${pc > 0 ? "up" : "down"} ${pct(Math.abs(pc))}`, sub: `from ${price(b.price)}`, tab: "summary" });
  if (now.report && now.report > (b.report || "")) {
    const x = d.earnings.history.find((r) => r.date === now.report), one = x && oneOffMiss(d, x);
    out.push(x && isNum(x.surprise)
      ? { tone: one ? "note" : x.surprise >= 0 ? "good" : "bad", text: one ? "New report: missed, but because of a one-off charge" : `New report: ${x.surprise >= 0 ? "beat" : "missed"} estimates by ${pct(Math.abs(x.surprise))}`, tab: "earnings" }
      : { tone: "note", text: "New earnings report", tab: "earnings" });
  } else if (now.filing && now.filing !== b.filing) out.push({ tone: "note", text: "New press release from the company", tab: "earnings" });
  if (d.type === "EQUITY") {
    const acts = (d.analysts?.actions || []).filter((x) => x.date > (b.lastAction || "9999"));
    const n = (k) => acts.filter((x) => x.action === k).length;
    const s = (k, w) => `${n(k)} ${w}${n(k) === 1 ? "" : "s"}`;
    if (n("up")) out.push({ tone: "good", text: s("up", "upgrade"), tab: "analysts" });
    if (n("down")) out.push({ tone: "bad", text: s("down", "downgrade"), tab: "analysts" });
    if (n("init")) out.push({ tone: "note", text: `${n("init")} new analyst${n("init") === 1 ? "" : "s"} covering it`, tab: "analysts" });
    const tc = rel(now.tmed, b.tmed);
    if (isNum(tc) && Math.abs(tc) >= 0.015) out.push({ tone: tc > 0 ? "good" : "bad", text: `Middle price target ${tc > 0 ? "raised" : "cut"} ${pct(Math.abs(tc))} to ${price(now.tmed)}`, tab: "analysts" });
    if (isNum(now.net) && isNum(b.net) && now.net !== b.net) out.push({ tone: now.net > b.net ? "good" : "bad", text: `Analyst net score ${b.net > 0 ? "+" : ""}${b.net} → ${now.net > 0 ? "+" : ""}${now.net}`, tab: "analysts" });
    const ec = rel(now.eps1y, b.eps1y);
    if (isNum(ec) && Math.abs(ec) >= 0.005) out.push({ tone: ec > 0 ? "good" : "bad", text: `Next year's profit estimate ${ec > 0 ? "raised" : "cut"} ${pct(Math.abs(ec))}`, tab: "earnings" });
    const ins = (d.insiders?.transactions || []).filter((x) => x.date > (b.insider || "9999"));
    const bought = ins.filter((x) => x.kind === "buy").reduce((t, x) => t + (x.value || 0), 0);
    const sold = ins.filter((x) => x.kind === "sell").reduce((t, x) => t + (x.value || 0), 0);
    if (bought > 0) out.push({ tone: "good", text: `Insiders bought ${moneyShort(bought)}`, tab: "analysts" });
    if (sold > 0) out.push({ tone: "note", text: `Insiders sold ${moneyShort(sold)}`, tab: "analysts" });
    const dc = rel(now.div, b.div);
    if (isNum(dc) && Math.abs(dc) >= 0.005) out.push({ tone: dc > 0 ? "good" : "bad", text: `Dividend ${dc > 0 ? "raised" : "cut"} ${pct(Math.abs(dc))} to ${price(now.div)} a share`, sub: `from ${price(b.div)} a payment`, tab: "dividends" });
  } else if (isNum(now.er) && isNum(b.er) && Math.abs(now.er - b.er) >= 0.00005) {
    out.push({ tone: now.er < b.er ? "good" : "bad", text: `Fee ${now.er < b.er ? "cut" : "raised"} to ${pct(now.er, { digits: 2 })}`, tab: "summary" });
  }
  if (isNum(now.score) && isNum(b.score) && now.score !== b.score) out.push({ tone: now.score > b.score ? "good" : "bad", text: `Checklist score ${b.score} → ${now.score}`, tab: "summary" });
  return out;
}
