// Analysts tab.
import * as A from "./analysis.js";
import { legend } from "./charts.js";
import { card, grid, h, isNum, pill, rich, showMore, signClass, tile } from "./core.js";
import { RATING_COLORS, RATING_GROUP, RATING_NAMES, firmTargets, ratingChip, targetStrip } from "./summary.js";

// ---------------------------------------------------------------- analysts
export function tabAnalysts(d, body) {
  const a = d.analysts, q = d.quote, tg = a.targets || {};
  const g = grid("analysts");
  body.append(g);

  const cur = (a.summary || []).find((r) => r.period === "0m");
  if (cur) {
    const parts = [["strongBuy", "Strong buy", "#1c5cab"], ["buy", "Buy", "#5598e7"], ["hold", "Hold", "#a3a29b"], ["sell", "Sell", "#e66767"], ["strongSell", "Strong sell", "#b42323"]];
    const total = parts.reduce((s, [k]) => s + (cur[k] || 0), 0) || 1;
    const bar = h("div", { class: "segbar", role: "img", "aria-label": parts.map(([k, l]) => `${l} ${cur[k] || 0}`).join(", ") },
      parts.filter(([k]) => cur[k]).map(([k, l, c]) => h("div", { style: `flex:${cur[k]};background:${c};${k === "hold" ? "color:#0b0b0b" : ""}`, "data-tip": `${cur[k]} analyst${cur[k] === 1 ? "" : "s"}`, "data-tip-title": l }, cur[k] / total > 0.08 ? String(cur[k]) : "")));
    const prev = (a.summary || []).find((r) => r.period === "-3m");
    const scPrev = prev ? A.ratingScore(prev) : null;
    const sgn = (x, dg = 0) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${A.num(Math.abs(x), dg)}`;
    // how the mix moved over the last few months
    const months = ["0m", "-1m", "-2m", "-3m"].map((k) => (a.summary || []).find((r) => r.period === k)).filter(Boolean);
    const MON = { "0m": "Now", "-1m": "1 month ago", "-2m": "2 months ago", "-3m": "3 months ago" };
    const miniBar = (r) => h("div", { class: "segbar mini", role: "img", "aria-label": parts.map(([k, l]) => `${l} ${r[k] || 0}`).join(", ") },
      parts.filter(([k]) => r[k]).map(([k, l, c]) => h("div", { style: `flex:${r[k]};background:${c}`, "data-tip": `${r[k]} analyst${r[k] === 1 ? "" : "s"}`, "data-tip-title": `${l} · ${MON[r.period]}` })));
    const recent = (a.actions || []).filter((x) => (Date.now() - new Date(x.date)) / 864e5 <= 90);
    const cnt = (k) => recent.filter((x) => x.action === k).length;
    const sc = A.ratingScore(cur);
    g.append(card("What analysts recommend", { area: "rec", term: "analystRating", sub: `${total} analysts this month${sc ? ` · overall: ${sc.label.toLowerCase()}` : ""}` },
      bar, legend(parts.map(([, l, c]) => ({ name: l, color: c }))),
      sc && scPrev ? h("p", { class: "small ink2", style: "margin:6px 0 0" }, rich(`**Net score ${sgn(sc.net)}**, ${Math.abs(sc.avg - scPrev.avg) < 0.05 ? "about the same as" : sc.avg > scPrev.avg ? "**more positive** than" : "**more negative** than"} three months ago (${sgn(scPrev.net)}).`)) : null,
      sc ? h("div", { class: "rec-score" },
        h("div", { class: "rec-score-head" }, h("span", { class: "has-tip", "data-tip": "Strong buy counts +2, buy +1, hold 0, sell −1, strong sell −2. Add them up, then divide by the number of analysts for the average.", "data-tip-title": "Net score" }, "Net score"),
          h("b", { class: "tnum" }, ` ${sc.net > 0 ? "+" : ""}${sc.net}`), h("span", { class: "muted small" }, ` from ${sc.n} analysts · average ${sc.avg > 0 ? "+" : ""}${A.num(sc.avg, 2)} each`), " ", pill(sc.tone, sc.label)),
        h("div", { class: "rec-math" }, parts.map(([k, l, c], i) => cur[k] ? h("span", { class: "rec-term" }, h("span", { class: "rdot", style: `background:${c}` }), `${cur[k]} ${l.toLowerCase()} × ${["+2", "+1", "0", "−1", "−2"][i]}`) : null)),
        h("div", { class: "rec-scale" }, h("div", { class: "rec-dot", style: `left:${10 + (80 * (2 - sc.avg)) / 4}%` }), ["Strong buy", "Buy", "Hold", "Sell", "Strong sell"].map((t) => h("span", {}, t))),
        h("p", { class: "small ink2", style: "margin:6px 0 0" }, rich(sc.avg < -0.1 ? "**More analysts say sell than buy.** That's unusual: analysts rarely say sell, so even a few sells is a meaningful warning." : sc.avg > 0.1 ? "More analysts say buy than sell." : "Buys and sells roughly cancel out."))) : null,
      months.length > 1 ? h("div", { class: "rec-months" }, h("div", { class: "muted small" }, "How the mix has changed (net score: buy +, sell −)"),
        h("div", { class: "rec-month rec-head muted small" }, h("span"), h("span"), h("span", {}, "Net"), h("span", {}, "Each"), h("span", { class: "has-tip", "data-tip": "Change in the net score from the month before." }, "Change")),
        months.map((r, i) => {
          const s1 = A.ratingScore(r), s0 = months[i + 1] ? A.ratingScore(months[i + 1]) : null;
          const dv = s1 && s0 ? s1.net - s0.net : null;
          const tip = s1 ? `Net score ${sgn(s1.net)} from ${s1.n} analysts, ${sgn(s1.avg, 2)} each on average.${dv != null ? ` ${dv === 0 ? "No change from" : dv > 0 ? `Up ${dv} from` : `Down ${-dv} from`} the month before.` : ""}` : "";
          return h("div", { class: "rec-month", "data-tip": tip, "data-tip-title": MON[r.period] }, h("span", { class: "small ink2" }, MON[r.period]), miniBar(r),
            h("b", { class: "small tnum" }, s1 ? sgn(s1.net) : "–"),
            h("span", { class: "small tnum muted" }, s1 ? sgn(s1.avg, 2) : ""),
            h("span", { class: `small tnum rec-chg ${dv > 0 ? "up" : dv < 0 ? "down" : ""}` }, dv == null ? "" : dv > 0 ? `▲ ${dv}` : dv < 0 ? `▼ ${-dv}` : "same"));
        })) : null,
      recent.length ? h("div", { class: "rec-tally" },
        h("div", { class: "muted small" }, "Last 90 days"),
        h("div", { class: "tally" },
          h("span", { class: "pill good" }, h("span", { class: "ic", "aria-hidden": "true" }, "▲"), `${cnt("up")} upgrade${cnt("up") === 1 ? "" : "s"}`),
          h("span", { class: "pill bad" }, h("span", { class: "ic", "aria-hidden": "true" }, "▼"), `${cnt("down")} downgrade${cnt("down") === 1 ? "" : "s"}`),
          cnt("init") ? h("span", { class: "pill na" }, h("span", { class: "ic", "aria-hidden": "true" }, "•"), `${cnt("init")} new`) : null,
          h("span", { class: "small muted" }, `${recent.length - cnt("up") - cnt("down") - cnt("init")} kept their rating`))) : null));
  }

  if (isNum(tg.mean)) {
    const vs = (x) => A.pct(x / q.price - 1, { sign: true });
    const ft = firmTargets(d).map((x) => x.target).sort((x, y) => x - y);
    const trimmed = ft.length >= 5 ? ft.slice(1, -1).reduce((s2, x) => s2 + x, 0) / (ft.length - 2) : null;
    const skew = isNum(tg.median) ? tg.mean / tg.median - 1 : 0;
    g.append(card("12-month price targets", { area: "targets", term: "priceTarget" },
      h("div", { class: "tiles four", style: "margin-bottom:10px" },
        tile("Lowest", A.price(tg.low), vs(tg.low)),
        isNum(tg.median) ? tile("Middle", A.price(tg.median), vs(tg.median)) : null,
        tile("Average", A.price(tg.mean), vs(tg.mean)),
        tile("Highest", A.price(tg.high), vs(tg.high))),
      isNum(tg.median) ? h("p", { class: "small ink2", style: "margin:0 0 4px" }, rich(
        `**Half the analysts are above ${A.price(tg.median)} and half below.** ` +
        (Math.abs(skew) > 0.05 ? `The average (${A.price(tg.mean)}) is ${skew > 0 ? "higher" : "lower"} because a few targets are far ${skew > 0 ? "above" : "below"} the rest, so **the middle is the better guide**. ` : "The average is close to the middle, so no single target is skewing it. ") +
        (isNum(trimmed) ? `Dropping the highest and lowest of the ${ft.length} firms with recent targets gives **${A.price(trimmed)}**.` : ""))) : null,
      targetStrip(d),
      h("p", { class: "small muted", style: "margin:6px 0 0" }, "Targets tend to chase the price. They get raised after rallies and cut after drops.")));
  }

  if ((a.actions || []).length) {
    const list = h("div", { class: "actions-grid" });
    const ACT = { up: ["good", "▲", "Upgrade", "Raised its rating"], down: ["bad", "▼", "Downgrade", "Lowered its rating"], init: ["na", "•", "New coverage", "Started covering the stock"],
      main: ["na", "=", "Kept", "Kept its rating (and often updated its target)"], reit: ["na", "=", "Kept", "Repeated its rating"] };
    list.append(...a.actions.slice(0, 25).map((x) => {
        const [tone, ic, word, tip] = ACT[x.action] || ACT.main;
        const tchg = isNum(x.priorTarget) && x.priorTarget > 0 && isNum(x.target) && x.priorTarget !== x.target ? x.target - x.priorTarget : null;
        return h("div", { class: "list-row arow", style: x.to ? `border-left-color:${RATING_COLORS[RATING_GROUP(x.to)]}` : null },
          h("div", { class: "grow" },
            h("div", {}, h("b", {}, x.firm || "—"), h("span", { class: "muted small" }, ` · ${A.date(x.date, { month: "short", day: "numeric", year: "numeric" })}`)),
            h("div", { class: "small ink2", style: "margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap" },
              h("span", { class: `pill ${tone}`, "data-tip": tip }, h("span", { class: "ic", "aria-hidden": "true" }, ic), word),
              ratingChip(x.to),
              x.from && x.from !== x.to && (x.action === "up" || x.action === "down") ? h("span", { class: "muted" }, "from ", ratingChip(x.from)) : null)),
          isNum(x.target) ? h("div", { class: "small tnum", style: "text-align:right" },
            h("b", {}, A.price(x.target)),
            tchg != null ? [h("div", { class: signClass(tchg), style: "font-weight:600" }, `${tchg > 0 ? "▲" : "▼"} ${A.price(Math.abs(tchg))} (${A.pct(tchg / x.priorTarget, { sign: true })})`), h("div", { class: "muted" }, `from ${A.price(x.priorTarget)}`)]
              : h("div", { class: "muted" }, x.targetAction === "Maintains" ? "target unchanged" : "target")) : null);
      }));
    g.append(card("Recent rating changes", { area: "actions", class: "span",
      sub: "Each firm's latest move. The colored edge is the firm's rating now. Firms use different words for the same three ratings; hover a rating for its meaning." },
      legend(RATING_NAMES.map((n, i) => ({ name: `${n} (e.g. ${["Overweight, Outperform", "Neutral, Equal-Weight, Sector Perform", "Underweight, Underperform"][i]})`, color: RATING_COLORS[i] }))), list, showMore(list, 15)));
  }

  const ins = A.insiderSummary(d);
  if (ins) {
    const trades = ins.recent.filter((x) => x.kind === "buy" || x.kind === "sell");
    const list = h("div", { class: "ins-list" }, trades.map((x) => h("div", { class: "list-row" },
      h("div", { class: "grow" },
        h("div", {}, h("b", {}, x.name), x.role ? h("span", { class: "muted small" }, ` · ${x.role}`) : null),
        h("div", { class: "small muted" }, `${A.date(x.date)} · ${A.num(x.shares, 0)} shares${isNum(x.price) ? ` at ~${A.price(x.price)}` : ""}${x.indirect ? " · includes shares held indirectly (trust, family)" : ""}`)),
      h("div", { style: "text-align:right" },
        x.kind === "buy" ? h("span", { class: "pill good" }, h("span", { class: "ic", "aria-hidden": "true" }, "▲"), "Bought") : h("span", { class: "pill na" }, h("span", { class: "ic", "aria-hidden": "true" }, "▼"), "Sold"),
        h("div", { class: "small tnum", style: "margin-top:3px;font-weight:600" }, A.moneyShort(x.value))))));
    const more = showMore(list, 8);
    g.append(card("What insiders are doing", { area: "insiders", class: "span", term: "insiders", right: pill(ins.tone, ins.label),
      sub: "Trades by the company's own executives and directors in the last 12 months, from their SEC filings (Form 4)" },
      h("div", { class: "ins" },
        h("div", {},
          h("div", { class: "tiles" },
            tile("Bought", ins.bought ? A.moneyShort(ins.bought) : "None", `${ins.buyers} ${ins.buyers === 1 ? "person" : "people"}`),
            tile("Sold", ins.sold ? A.moneyShort(ins.sold) : "None", `${ins.sellers} ${ins.sellers === 1 ? "person" : "people"}`)),
          h("div", { class: "ins-story" }, ins.lines.map((t) => h("p", { class: "small ink2" }, rich(t))))),
        trades.length ? h("div", {}, list, more) : h("p", { class: "muted" }, "No open-market buys or sales in the last 12 months."))));
  }
}
