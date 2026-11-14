// Holdings tab (funds).
import * as A from "./analysis.js";
import { hbars } from "./charts.js";
import { card, grid, h, tickers } from "./core.js";

// ---------------------------------------------------------------- holdings (ETF)
export function tabHoldings(d, body) {
  const f = d.fund;
  const watch = new Set(tickers().map((t) => t.symbol.replace("GOOGL", "GOOG")));
  const g = grid("holdings");
  body.append(g);
  const hold = f.holdings || [];
  const topSum = hold.reduce((s, x) => s + (x.weight || 0), 0);
  g.append(card(`Top ${hold.length} holdings`, { area: "top", term: "concentration", sub: `${A.pct(topSum, { digits: 0 })} of the fund. Orange = also on your watchlist.${f.holdingsSource ? ` Source: ${f.holdingsSource}.` : ""}` },
    hbars(hold.map((x) => ({ label: `${x.symbol} · ${x.name}`, value: x.weight, highlight: watch.has(x.symbol.replace("GOOGL", "GOOG")) })), (v) => A.pct(v, { digits: 1 }))));
  const S = { technology: "Technology", financial_services: "Financials", communication_services: "Communication", consumer_cyclical: "Consumer (discretionary)", healthcare: "Healthcare", industrials: "Industrials",
    consumer_defensive: "Consumer (staples)", energy: "Energy", utilities: "Utilities", realestate: "Real estate", basic_materials: "Materials" };
  const sectors = Object.entries(f.sectors || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (sectors.length) {
    g.append(card("Sector mix", { area: "sectors", sub: "Share of the fund in each part of the economy" },
      hbars(sectors.map(([k, v]) => ({ label: S[k] || k, value: v })), (v) => A.pct(v, { digits: 1 }))));
  }
  const ov = hold.filter((x) => watch.has(x.symbol.replace("GOOGL", "GOOG")));
  if (ov.length) {
    const byS = {};
    ov.forEach((x) => { const s = x.symbol.replace("GOOGL", "GOOG"); byS[s] = (byS[s] || 0) + x.weight; });
    g.append(card("Overlap with your watchlist", { area: "overlap", class: "span" },
      h("p", { class: "ink2", style: "margin:0" }, `For every $1,000 in ${d.symbol}, about ${Object.entries(byS).map(([s, w]) => `$${Math.round(w * 1000)} goes to ${s}`).join(" and ")}. If you also buy those stocks directly, you're adding to positions you already hold through the fund.`)));
  }
}
