# Tickerbook architecture notes

Detailed reference, split out of `CLAUDE.md` to keep that file lean. Read the section for the area you're changing.

- [Data pipeline (`fetch.py`)](#data-pipeline-fetchpy)
- [Analysis (`analysis.js`)](#analysis-analysisjs)
- [Pages and features (`app.js`)](#pages-and-features-appjs)
- [Laptop one-screen layout](#laptop-one-screen-layout)
- [Research flow and workflow](#research-flow-and-workflow)

## Data pipeline (`fetch.py`)

**Files written:** `data/<SYM>.json` (everything every tab needs), `data/_bench.json` (`benches.SPY` / `benches.QQQ`: S&P 500 and Nasdaq 100 fund prices), `data/index.json` (tickers, tags, names), `data/last_request.json` (outcome of the last add/remove/tag).

**Units.** Some Yahoo `info` fields are percents (`dividendYield` 0.72 = 0.72%, `netExpenseRatio`, `ytdReturn`, `debtToEquity`) and go through `pct()`. Everything in the JSON is a decimal. `type: "EQUITY"` has `valuation/fundamentals/analysts/earnings/financials`; `type: "ETF"` has `fund`.

**`fix_ttm()`** replaces Yahoo's `freeCashflow` with the sum of the last 4 quarterly statements (Yahoo's value is unreliable, e.g. $3B for MSFT vs ~$60B). It also stores `sharesImplied = marketCap / price`, because `sharesOutstanding` can cover only one share class (GOOG).

**History snapshots.** Yahoo has no historical P/E or estimates, so each run reads the previous `data/<SYM>.json` and appends today's `snapshot()`. Deleting or regenerating a data file loses that history.

**Tags and archive.** Tags are `watching`, `researching`, `archived` ("owned" was retired; `load_watchlist()` maps it to watching). Archived tickers get `archivedOn` (in `watchlist.json`, `index.json` and the data file) and are skipped by the daily refresh, so their files and history are kept but paused. `set_tag()` stamps/clears `archivedOn`, `archivedPrice` and `archivedPriceDate` (from the data file's last quote) and reports when a ticker leaves the archive, which triggers an immediate rebuild. The daily refresh runs `archived_moves()` (one adjusted-price history call per archived ticker, no snapshot) into `index.json` `sinceArchived {price, date, move}`; other runs carry it over unless the ticker was re-archived. Home's Archived panel and the ticker page show the move. Only archived tickers can be deleted from the UI. `A.snapshotGaps()` finds stretches over a week with no snapshot (archive cycles, failed runs); the ticker page lists them and the Forward P/E chart breaks its line there.

**Peers.** `build_peers()` stores up to 8 of the largest companies in the same Yahoo industry (`yf.Industry(key).top_companies`, skipping other share classes) as `d.peers.list`. `peer_info()` (cached per run) keeps the same `info` fields for each peer as the ticker's own data, so the Peers tab compares like with like.

**Benchmarks.** `BENCHES` (SPY, QQQ) are fetched with `price_history()` like any ticker, so dividends are folded in on both sides. Don't switch to `^GSPC`/`^NDX`: the indexes leave dividends out, which flattered every stock by ~1.3%/yr. A failed fetch keeps the previous copy.

**Fund holdings.** Yahoo returns only a fund's top 10. Plain S&P 500 funds (name matches "S&P 500", none of growth/equal/leveraged…) take their top 15 from SPY's daily holdings xlsx (needs `openpyxl`) and record `fund.holdingsSource`. Falls back quietly to Yahoo.

**SEC press release.** `sec_earnings_release()` reads the latest 8-K with Item 2.02 (EDGAR submissions → filing index → EX-99), strips HTML, and keyword-picks guidance, one-off and headline sentences plus adjusted EPS into `d.filing`. Runs only when `SEC_USER_AGENT` is set (a repo **variable** in Actions); otherwise, or on failure, the previous `filing` is kept. Only sentences ending in a period and containing an amount are kept. Some filings are Windows-1252. Many companies (CHTR, MSFT, GOOG) print no adjusted EPS.

**Leverage caveats.** `fundamentals.debtByQuarter` (last 5 quarter-end debt/cash) and `filing.leverage` (`company_leverage()`: the company's own net debt/EBITDA from the press release, skipping target/range sentences; needs `SEC_USER_AGENT`. When the release states no ratio, as Charter's doesn't, `leverage_parts()` keeps the principal debt and the quarter's (pro forma) Adjusted EBITDA, and the app shows (debt − cash) ÷ (quarter × 4) as an estimate with its math) feed `A.leverageNotes()`. It explains a ≥ 10% debt jump in the last 3 quarters (an acquisition the trailing EBITDA hasn't caught up with: CHTR/Cox, Q3 2026) and the company's figure. It's shown in the Summary debt signal, `judge("netDebtToEbitda")`, the Balance sheet card, the Dividends debt check and the Valuation heavy-debt warning.

**Insiders.** `insider_trades()` stores ~400 days of Form 4 trades as `d.insiders.transactions`, with `kind` (buy/sell/award/gift/exercise/other) classified from Yahoo's `Text` and names reordered from SEC's LAST FIRST form by `insider_name()`. Yahoo's `insider_purchases` summary counts grants as purchases, so it isn't used.

**Dividends.** `dividend_info()` stores `d.dividends` for stocks and funds: up to 30 years of split-adjusted `payments` (by ex-date), `forwardRate` (includes an announced raise), `exDate`/`payDate` (calendar), a monthly trailing-12-month `yieldHistory` and 5-year `returns` (price-only vs dividend-adjusted). Those two need an extra `auto_adjust=False` history call. `{pays: false}` for non-payers; a failed fetch keeps the previous copy.

**Cash uses.** `statement()` also keeps `netDebtIssued`, `acquisitions`, `stockIssued`, `stockComp`. Cash-flow rows keep the statement's signs (money out is negative).

## Analysis (`analysis.js`)

Pure functions: formatters, the signal checklist (`equitySignals`, `fundSignals`, thresholds inline), `overall()`, the earnings story, valuation, and the newer feature helpers. Generated sentences may mark phrases with `**bold**`, rendered via `rich()`.

**Valuation: `valuationMethods()` returns 7 methods.**
1. "Future profits" (P/E).
2. "Cash it generates" (DCF). Left out by default when FCF < 50% of net income.
3. "What Wall Street expects": the **median** target, discounted a year.
4. "Priced like its peers": peers' median EV/EBITDA × EBITDA − net claims (`netClaims()` = Yahoo EV − market cap), ÷ shares.
5. "Peers' price-to-profit": peers' median forward P/E × EPS. Also left out when debt > 50% of EV.
6. "Back to its usual price-to-profit": median of fiscal-year-end P/Es (`pastPEs()`). Left out when they swing > 2×.
7. "If it never grows": a no-growth floor. **Never** in the average.

Peer methods are left out with < 4 usable peers or when the middle-half multiples differ by > 1.6×. Each method has `plain`, `steps` (math with numbers), `reason` when excluded, and reverse-solved `implied` growth. Defaults (`valuationInputs`/`modelDefaults`): today's P/E as exit multiple, analysts' 2-year growth capped at 15%, 12% required return when net debt/EBITDA > 3.5. `confidence()`/`explainSpread()` explain disagreement. `debtPicture()` names methods by number, so renumbering means updating it. Scale dots never stack (z-index layering), per the user.

**Other helpers.**
- `ratingScore()`: net analyst score (+2 … −2) and labels like "Hold, leaning sell". It replaces Yahoo's `recommendationMean`, which uses a different set of analysts. The Peers tab is the exception: peers only have `recommendationMean`.
- `judge(key, d)`: places the company against a glossary rule of thumb.
- `quarterScore()`: 5-check report grade.
- `oneOffs()` / `oneOffMiss()` / `reportQuarter()`: one-off charges that explain a miss.
- `translateRelease()`: pattern rules turning press-release sentences into plain English.
- `newsMood()`: a labelled keyword heuristic.
- `insiderSummary()`: 12-month open-market buys/sells. Grants ignored.
- `cashUses()`: free cash flow vs buybacks, dividends, debt, acquisitions, plus share count.
- `drawdowns()` / `dropStory()`: % below previous high over the price history, and the worst-drop sentences.
- `fingerprint()` / `changesSince()`: "Since you last looked".
- `dividendStory()`: everything on the Dividends tab. It flags specials (well above the payments around them; one lumped with a regular payment is split) and Yahoo glitches (a lone tiny payment), and reads each payment's yearly rate from the next few gaps (a missing payment or a yearly→quarterly switch isn't a cut). Raise streak = a chain of raises ≤ 18 months apart (calendar years break when a raise shifts years). 5 safety checks; thresholds match the glossary `cashPayout`/`dividendGrowth`/`dividendStreak` rules and reuse `judge("payoutRatio"/"netDebtToEbitda")`.
- `moneyShort()`: amounts like $175K / $1.4M.

## Pages and features (`app.js`)

Hash router: `#/`, `#/t/SYM/<tab>`, `#/learn`, `#/settings`. Equity tabs: Summary, Walkthrough, Earnings, Financials, Dividends, Valuation, Peers, Analysts, News. ETF tabs: Summary, Walkthrough, Holdings, Dividends, News. Tiny `h()` DOM builder.

**Rule-of-thumb badges.** `renderTicker` sets module-level `CUR` (cleared in `route()`); `termBtn(key)` appends a thumb from `A.judge(key, CUR)`. The popover and glossary sheet show the same verdict (`judgeBox`).

**Hover popovers.** On `(hover: hover) and (pointer: fine)`, elements with `data-term` or `data-tip`/`data-tip-title` show a popover (delegated listeners near the end of `app.js`). Click still opens the bottom sheet.

**Since you last looked.** Opening a ticker stores `A.fingerprint()` in localStorage (`stockdash.seen.<SYM>`). When the data's `updated` differs, `changesSince()` lists what moved. The banner above the tabs keeps showing it (from `prev`) until "Got it". Home cards show "N new" for data not yet opened. Browser-only.

**Peers tab.** `PEER_GROUPS` rows have `self(d)` / `peer(p)` getters reading the same field, an `ok` filter for meaningless values, and `better` (`null` = not ranked, e.g. beta). "Beats/lags most peers" = better/worse than ≥ 2/3 of peers with a usable value. Labels use `termPlain()` (no thumb, since this tab ranks against peers). This replaced a watchlist-wide compare page at the user's request.

**Price chart "vs" picker and Drops.** One `<select>`: No comparison / vs S&P 500 / vs Nasdaq 100 / vs both (pref `vs`). `A.BENCHES` in `analysis.js` holds names, fixed colors (SPY `--series-2`, QQQ `--series-3`) and the hover text. `A.tracksBench()` hides a benchmark on a fund that tracks the same index (VOO gets only Nasdaq 100). Drops plots `drawdowns().under` for the stock and each picked benchmark (`yMax: 0` caps the axis); `dropStory()` always uses SPY. The range chips, picker and Drops checkbox share a fixed row and the summary text sits below, so the controls never move (the user asked for this). In the % views each series' `tip(i, v)` adds the $ price to the hover.

**Analyst rating changes.** First 15 shown in 3 columns, then "Show all". The left edge is colored by the firm's current Buy/Hold/Sell. Firm words (Overweight, Sector Perform…) map via `RATING_GROUP`, with hover meanings in `RATING_WORDS`.

**Walkthrough tab.** `A.walkSteps()` lists the slides (business first, then price): each names a real card by `tab` + `area`, a general "what this is", and "what it says" (mostly the scorecard text). `tabWalk()` renders each needed tab off-screen once via `TAB_FN` and moves the card with that `--area` into the slide, so a renamed area silently drops the panel (the slide still shows its text). Slide index is kept per ticker in `localStorage`; ←/→ keys work while it's on screen. The wrap-up slide lists every slide's pill.

## Laptop one-screen layout

`app.js` toggles `html.dash-on` at `(min-width:1100px) and (min-height:600px)`. Each tab builds cards inside `grid(name, flow)` (`.cols.dash.dash-<name>`), and `card(title, { area })` sets a `--area` CSS variable that becomes `grid-area` only under `html.dash-on`. Setting `grid-area` directly breaks the phone layout. Per-tab `grid-template-areas` live in `styles.css`.

`fitDash()` gives each non-flow `.dash` a **min-height** of the window (and `--dash-h`), so cards grow instead of scrolling internally. The user dislikes "windowed scrolling". Only long lists opt in, with `scroll-full` / `scroll-half`; others use a first batch plus "Show all".

Card content sits in `.card-body`, so sticky table headers stay flush. Earnings and Peers use flowing grids. Earnings and Financials charts use fixed heights (the user found filled charts too big). `fill: true` charts take their container's height, with the SVG absolutely positioned. `dash-hide` cards are hidden on laptop. Valuation keeps the Bear/Base/Bull buttons on top and the sliders collapsed at the bottom.

## Research flow and workflow

**Research.** With a fine-grained token in localStorage, `github.js` POSTs a `workflow_dispatch` to `update.yml` with a random `request_id`. It finds the run by `[request_id]` in `run-name`, polls the `fetch` job's steps, and maps step names to progress stages (`STAGES[].match`). Then it reads `data/last_request.json` and the new data via the Contents API, skipping the Pages delay. With a token, `fetchJSON` reads all data via the Contents API.

**Edit list.** Home's "Edit list" button (shown with a token) swaps the view for `renderEdit()`: ↑/↓ and HTML5 drag (mouse only) to reorder, a tag picker per row, and delete/undo on archived rows. Nothing happens until Save, which updates `state.index` at once and runs action `edit` with input `order` = `"SYM:tag,…,-SYM"` (new order, `-` = delete). `fetch.py` applies it in one run (unlisted tickers keep their place at the end), rebuilds only tickers leaving the archive, and keeps `index.json`'s `updated`. A failed run reloads, so the list snaps back. Home shows archived tickers only in a collapsed "Archived" panel, outside chips, earnings and Side by side.

**Workflow.** One workflow handles schedule (weekdays 21:30 UTC), `workflow_dispatch` and push.
- **Push:** only deploys. The `fetch` job is skipped, so new data fields appear only after the next refresh. Trigger one with `gh workflow run update.yml -f action=refresh`.
- **Saving data:** the `fetch` job commits with `GITHUB_TOKEN`. Those pushes don't trigger workflows, so `deploy` is a job in the same workflow (Pages source: "GitHub Actions").
- **Queuing:** runs queue in one concurrency group. `fetch` checks out `ref: main`, because a queued run would otherwise start from its trigger commit and clash on save. On a save clash it rebases with `-X theirs`.
- **Inputs:** passed via `env`, never interpolated into `run:`.
- **Asset stamping:** the deploy job stamps `?v=<sha>` onto CSS/JS. New module imports must use the `from "./x.js"` form to get stamped.
