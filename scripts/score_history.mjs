// Writes data/scores/<SYM>.json: the checklist score for each day we have data.
//
// Every past day is rescored with TODAY's rules from that day's data file in git history, so the
// line never jumps because the rules changed. Points whose data commit was already scored under
// the current SCORE_VERSION are reused. Runs in Actions after fetch.py (GitHub's runners have Node;
// nothing to install). Needs the full git history (checkout fetch-depth: 0).
// Usage: node scripts/score_history.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 << 20 });

// analysis.js reads the clock (listing age, days to earnings...). Pin it to each file's own update
// time so a past day scores the way it would have that day.
const RealDate = Date;
let now = RealDate.now();
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [now])); }
  static now() { return now; }
};
// a data: URL import, so no package.json is needed to load the browser's ES module
const src = readFileSync("assets/analysis.js", "utf8");
const A = await import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);

const index = JSON.parse(readFileSync("data/index.json", "utf8"));
const watch = index.tickers.map((t) => t.symbol);
mkdirSync("data/scores", { recursive: true });

// tickers no longer on the list lose their score file (their data file is gone too)
for (const f of readdirSync("data/scores")) if (!watch.includes(f.replace(/\.json$/, ""))) unlinkSync(`data/scores/${f}`);

for (const t of index.tickers) {
  const path = `data/${t.symbol}.json`, out = `data/scores/${t.symbol}.json`;
  if (!existsSync(path)) continue;
  const old = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
  if (t.tag === "archived" && old) continue; // paused, like the rest of its data
  const reuse = new Map(old?.version === A.SCORE_VERSION ? old.points.map((p) => [p.sha, p]) : []);

  // the last data commit of each UTC day, newest first, plus this run's not-yet-committed file
  const days = new Map();
  const changed = git("status", "--porcelain", "--", path).trim() !== "";
  if (changed) {
    const d = JSON.parse(readFileSync(path, "utf8"));
    days.set(d.updated.slice(0, 10), { sha: "work", d });
  }
  for (const line of git("log", "--format=%H %ct", "--", path).trim().split("\n").filter(Boolean)) {
    const [sha, ct] = line.split(" ");
    const day = new RealDate(Number(ct) * 1000).toISOString().slice(0, 10);
    if (!days.has(day)) days.set(day, { sha: sha.slice(0, 10) });
  }

  const points = [];
  for (const [day, x] of days) {
    if (reuse.has(x.sha) && x.sha !== "work") { points.push(reuse.get(x.sha)); continue; }
    try {
      const d = x.d || JSON.parse(git("show", `${x.sha}:${path}`));
      now = RealDate.parse(d.updated) || RealDate.now();
      points.push({ ...A.scorePoint(d, watch), date: day, sha: x.sha });
    } catch (e) {
      console.warn(`${t.symbol} ${day}: skipped (${e.message})`);
    }
  }
  now = RealDate.now();
  points.sort((a, b) => (a.date < b.date ? -1 : 1));
  // one point per line, so the daily git diff stays readable
  const kind = points.length && JSON.parse(readFileSync(path, "utf8")).type === "ETF" ? "fund" : "equity";
  const body = `{"symbol":${JSON.stringify(t.symbol)},"kind":"${kind}","version":${A.SCORE_VERSION},"points":[\n${points.map((p) => JSON.stringify(p)).join(",\n")}\n]}\n`;
  writeFileSync(out, body);
  console.log(`${t.symbol}: ${points.length} days, latest ${points.at(-1)?.score ?? "—"}`);
}
