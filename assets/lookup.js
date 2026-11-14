// Find a ticker by company or fund name, for the Research box.
// data/_names.json (built by fetch.py from SEC EDGAR) has every SEC-listed company, biggest first,
// plus ETFs. ALIASES covers everyday names the official list doesn't contain ("Facebook" → Meta).
// Everything runs in the browser on our own file; nothing typed here leaves the page.

// Brands and everyday names → the listed company that owns them. Facts only: no picks, no
// private companies. A ticker missing from the SEC list is skipped, so a stale entry just vanishes.
const ALIASES = [
  [["facebook", "instagram", "whatsapp", "threads"], ["META"], "Owns Facebook, Instagram and WhatsApp"],
  [["google", "youtube", "gmail", "android", "waymo"], ["GOOG", "GOOGL"], "Alphabet owns Google and YouTube"],
  [["iphone", "ipad", "macbook"], ["AAPL"], "Makes the iPhone"],
  [["xbox", "linkedin", "windows", "github", "office"], ["MSFT"], "Owns Xbox, LinkedIn, Windows and GitHub"],
  [["aws", "whole foods", "prime video"], ["AMZN"], "Owns AWS and Whole Foods"],
  [["coke", "sprite"], ["KO"], "Coca-Cola"],
  [["pepsi", "gatorade", "frito lay", "doritos", "quaker"], ["PEP"], "PepsiCo owns Pepsi, Gatorade and Frito-Lay"],
  [["tide", "gillette", "pampers", "crest"], ["PG"], "Procter & Gamble's brands"],
  [["kleenex", "huggies"], ["KMB"], "Kimberly-Clark's brands"],
  [["oreo", "cadbury"], ["MDLZ"], "Mondelez owns Oreo and Cadbury"],
  [["kfc", "taco bell", "pizza hut"], ["YUM"], "Yum! Brands owns KFC, Taco Bell and Pizza Hut"],
  [["espn", "marvel", "pixar", "hulu", "abc"], ["DIS"], "Disney owns ESPN, Marvel and Pixar"],
  [["chase", "jp morgan"], ["JPM"], "JPMorgan Chase"],
  [["bofa"], ["BAC"], "Bank of America"],
  [["amex"], ["AXP"], "American Express"],
  [["berkshire", "buffett", "geico"], ["BRK-B", "BRK-A"], "Warren Buffett's Berkshire Hathaway"],
  [["j&j", "jnj", "tylenol"], ["JNJ"], "Johnson & Johnson"],
  [["tj maxx", "marshalls", "homegoods"], ["TJX"], "TJX owns TJ Maxx and Marshalls"],
  [["spectrum"], ["CHTR"], "Charter runs the Spectrum brand"],
  [["xfinity", "nbc", "universal"], ["CMCSA"], "Comcast owns Xfinity and NBCUniversal"],
  [["tsmc", "taiwan semi"], ["TSM"], "Taiwan Semiconductor (US-listed shares)"],
  [["alibaba"], ["BABA"], "Alibaba (US-listed shares)"],
  [["toyota"], ["TM"], "Toyota (US-listed shares)"],
  [["nintendo"], ["NTDOY"], "Nintendo (US over-the-counter shares)"],
  [["s&p 500", "sp500", "s&p", "s and p"], ["VOO", "SPY", "IVV"], "Funds that track the S&P 500"],
  [["nasdaq 100", "nasdaq"], ["QQQ"], "Fund that tracks the Nasdaq 100"],
  [["total stock market", "total market", "whole market"], ["VTI"], "Fund that holds the whole US market"],
  [["dow jones", "dow 30"], ["DIA"], "Fund that tracks the Dow Jones"],
  [["international", "world ex us"], ["VXUS"], "Fund of stocks outside the US"],
  [["total bond", "bonds"], ["BND", "AGG"], "Funds that hold US bonds"],
  [["gold"], ["GLD", "IAU"], "Funds that hold gold"],
];

// Big, well-known funds rank above the thousands of niche ETFs with similar names.
const POPULAR_FUNDS = new Set(["VOO", "SPY", "IVV", "VTI", "QQQ", "VXUS", "VT", "BND", "AGG", "SCHD", "VYM", "VIG", "VUG", "VTV", "IWM", "DIA", "GLD", "VEA", "VWO", "IAU"]);

// Well-known companies with two classes of common stock. The SEC list also repeats a company's name
// for its bonds and notes (AT&T's TBB), and nothing in it tells the two apart, so only these
// count as share classes; any other repeat is labeled as another listing.
const SHARE_CLASSES = [["GOOG", "GOOGL"], ["BRK-A", "BRK-B"], ["FOX", "FOXA"], ["NWS", "NWSA"], ["UA", "UAA"], ["BF-A", "BF-B"],
  ["LEN", "LEN-B"], ["HEI", "HEI-A"], ["Z", "ZG"], ["LBRDA", "LBRDK"], ["LSXMA", "LSXMK"], ["MOG-A", "MOG-B"], ["CMCSA", "CMCSK"], ["BIO", "BIO-B"]];
const CLASS_OF = new Map(SHARE_CLASSES.flatMap((g) => g.map((s) => [s, g])));

// Words that don't help tell companies apart ("Walt Disney Company" should still find "Walt Disney Co").
const NOISE = new Set(["the", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "llc", "lp", "sa", "nv", "ag", "se", "and", "class", "of"]);
export const norm = (s) => String(s).toLowerCase().replace(/[’'`.]/g, "").replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const words = (s) => norm(s).split(" ").filter((w) => w && !NOISE.has(w));

let loading = null, ENTRIES = null, BY_SYM = null, ALIAS_ROWS = null;

/** Loads the list once (about 190 KB compressed). Resolves to true, or false if it's missing. */
export function loadNames() {
  loading ||= fetch("data/_names.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((d) => {
      ENTRIES = [];
      const n = d.stocks.length;
      d.stocks.forEach(([s, name, x], i) => ENTRIES.push({ s, name, x, fund: false, size: 1 - i / n }));
      d.funds.forEach(([s, name]) => ENTRIES.push({ s, name, x: "", fund: true, size: POPULAR_FUNDS.has(s) ? 1 : 0.1 }));
      for (const e of ENTRIES) { e.w = words(e.name); e.c = e.w.join(""); }
      BY_SYM = new Map(ENTRIES.map((e) => [e.s, e]));
      // the SEC list puts a company's second class far down; rank it next to the first
      for (const g of SHARE_CLASSES) {
        const top = Math.max(...g.map((s) => BY_SYM.get(s)?.size ?? 0));
        g.forEach((s) => { if (BY_SYM.has(s)) BY_SYM.get(s).size = top; });
      }
      // a repeated company name that isn't a known class: usually a bond or note (AT&T's TBB)
      const first = new Map();
      for (const e of ENTRIES) {
        if (e.fund) continue;
        if (!first.has(e.name)) first.set(e.name, e.s);
        else if (!CLASS_OF.has(e.s)) e.other = first.get(e.name);
      }
      ALIAS_ROWS = ALIASES.flatMap(([keys, syms, why]) => keys.map((k) => ({ k: norm(k), c: norm(k).replace(/ /g, ""), syms: syms.filter((s) => BY_SYM.has(s)), why })))
        .filter((a) => a.syms.length);
      return true;
    })
    .catch((e) => { console.warn("Name list unavailable:", e.message); loading = null; return false; });
  return loading;
}

export const known = (sym) => BY_SYM?.get(sym.toUpperCase()) || null;
/** Other tickers for the same company, e.g. GOOG → ["GOOGL"]. */
export const otherClasses = (e) => (CLASS_OF.get(e?.s) || []).filter((s) => s !== e.s && BY_SYM.has(s));

/**
 * Best matches for what was typed: [{ s, name, x, fund, why }], best first.
 * Order: exact ticker, everyday names, ticker prefix, name prefix, every word matched, then name contains.
 * Ties go to bigger companies (the SEC list is sorted by size) and well-known funds.
 */
export function searchNames(q, limit = 6) {
  if (!ENTRIES) return [];
  const qn = norm(q), qw = words(q), qc = qw.join(""), up = q.trim().toUpperCase();
  if (!qn) return [];
  const best = new Map();
  const add = (e, score, why) => {
    const pen = e.x === "OTC" ? 60 : !e.fund && !e.x ? 30 : 0; // over-the-counter and unlisted: thinner data
    const s = score + 99 * e.size - pen;
    if (!best.has(e.s) || best.get(e.s).score < s) best.set(e.s, { e, score: s, why: why || best.get(e.s)?.why });
  };
  const exact = BY_SYM.get(up);
  if (exact) add(exact, 1000);
  const qa = qn.replace(/ /g, "");
  for (const a of ALIAS_ROWS) {
    // an everyday name of 4+ letters beats a ticker spelled the same ("coke" means KO, not COKE)
    const hit = a.c === qa ? (qa.length >= 4 ? 1010 : 900) : qa.length >= 3 && a.c.startsWith(qa) ? 650 : 0;
    if (hit) a.syms.forEach((s, i) => add(BY_SYM.get(s), hit - i, a.why));
  }
  const tickerish = /^[A-Za-z0-9.\-]{1,6}$/.test(q.trim());
  for (const e of ENTRIES) {
    let score = 0;
    if (tickerish && e.s.startsWith(up) && e.s !== up) score = 520 - 10 * (e.s.length - up.length);
    if (qc && e.c.startsWith(qc)) score = Math.max(score, qc === e.c ? 560 : 420);
    else if (qw.length && qw.every((w) => e.w.some((x) => x.startsWith(w)))) score = Math.max(score, 300);
    else if (qc.length >= 4 && e.c.includes(qc)) score = Math.max(score, 150);
    if (score) add(e, score);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ e, why }) => ({ s: e.s, name: e.name, x: e.x, fund: e.fund, also: otherClasses(e),
      why: why || (e.other ? `Another ${e.other} listing, often a bond or note` : null), other: e.other || null }));
}
