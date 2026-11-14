# Tickerbook architecture notes

Detailed reference, split out of `CLAUDE.md` to keep that file lean. Read the section for the area you're changing.

- [Data pipeline (`fetch.py`)](#data-pipeline-fetchpy)
- [Analysis (`analysis.js`)](#analysis-analysisjs)
- [Pages and features](#pages-and-features)
- [Laptop one-screen layout](#laptop-one-screen-layout)
- [Research flow and workflow](#research-flow-and-workflow)

## Data pipeline (`fetch.py`)

**Files written:** `data/<SYM>.json` (everything every tab needs), `data/_bench.json` (`benches.SPY` / `benches.QQQ`: S&P 500 and Nasdaq 100 fund prices), `data/_ideas.json` (see Ideas), `data/logos/` (see Logos), `data/scores/<SYM>.json` (see Score history), `data/index.json` (tickers, tags, names), `data/last_request.json` (outcome of the last add/remove/tag).

**Next-earnings estimates** come from `earnings_estimate`'s `0q` row, to match the "What analysts expect" table (Yahoo's endpoints disagree).

**Units.** Some Yahoo `info` fields are percents (`dividendYield` 0.72 = 0.72%, `netExpenseRatio`, `ytdReturn`, `debtToEquity`) and go through `pct()`. Everything in the JSON is a decimal. `type: "EQUITY"` has `valuation/fundamentals/analysts/earnings/financials`; `type: "ETF"` has `fund`.

**`fix_ttm()`** replaces Yahoo's `freeCashflow` with the sum of the last 4 quarterly statements (Yahoo's value is unreliable, e.g. $3B for MSFT vs ~$60B). It also stores `sharesImplied = marketCap / price`, because `sharesOutstanding` can cover only one share class (GOOG).

**History snapshots.** Yahoo has no historical P/E or estimates, so each run reads the previous `data/<SYM>.json` and appends today's `snapshot()`. Deleting or regenerating a data file loses that history.

**Tags and archive.** Tags are `watching`, `researching`, `archived` ("owned" was retired; `load_watchlist()` maps it to watching). Archived tickers get `archivedOn` (in `watchlist.json`, `index.json` and the data file) and are skipped by the daily refresh, so their files and history are kept but paused. `set_tag()` stamps/clears `archivedOn`, `archivedPrice` and `archivedPriceDate` (from the data file's last quote) and reports when a ticker leaves the archive, which triggers an immediate rebuild. The daily refresh runs `archived_moves()` (one adjusted-price history call per archived ticker, no snapshot) into `index.json` `sinceArchived {price, date, move}`; other runs carry it over unless the ticker was re-archived. Home's Archived panel and the ticker page show the move. Only archived tickers can be deleted from the UI. `A.snapshotGaps()` finds stretches over a week with no snapshot (archive cycles, failed runs); the ticker page lists them and the Forward P/E chart breaks its line there.

**Peers.** `build_peers()` stores up to 8 of the largest companies in the same Yahoo industry (`yf.Industry(key).top_companies`, skipping other share classes) as `d.peers.list`. `peer_info()` (cached per run) keeps the same `info` fields for each peer as the ticker's own data, so the Peers tab compares like with like.

**Ideas.** On `refresh` only, `build_ideas()` writes `data/_ideas.json`: every active ticker's peers ("neighbors", `via` = the watchlist tickers) plus `run_screen()`, a `yf.screen` `EquityQuery` built from `SCREEN_RULES` (each rule's plain-English text is shown on the page, so change both together), keeping the `SCREEN_MAX` largest. `raw_info()` caches Yahoo `info` per run, so neighbors cost no extra calls; the screen adds ~40 (~20 s). Watchlist symbols and other share classes of them are skipped. `firstSeen` carries over between runs. If the screen fails, the last screen results are kept (`screen.ok: false`). The rules are ticker-neutral on purpose; nothing is added or left out by name.

**Logos.** `update_logos()` (refresh: watchlist + ideas; add: the new ticker) saves `data/logos/<SYM>.png|.jpg` plus `index.json` (`ok`, `file`, `src`, `checked`, `why`). Sources in order: the site's `<link rel=apple-touch-icon|icon>`, `/apple-touch-icon.png`, then Google's s2 favicon service (many big sites block bots). Only PNG/JPEG (and PNGs inside .ico) of 48px+ and roughly square are kept; SVG is never saved (it can carry scripts and would run on the site's origin if opened). Rechecks a saved logo after 180 days and a miss after 30. A hand-set `"skip": true` keeps a wrong logo off (letter tile). `LOGO_SOURCES` in `fetch.py` names a better page or a direct PNG/JPEG for companies whose own site has no usable icon (GOOG → about.google, VZ → Verizon's 2024 symbol on Wikimedia Commons); a failed listed source is retried every run. The browser only loads these saved files, so CSP stays `img-src 'self'`. About 70% of companies get one; the rest show a letter tile.

**Benchmarks.** `BENCHES` (SPY, QQQ) are fetched with `price_history()` like any ticker, so dividends are folded in on both sides. Don't switch to `^GSPC`/`^NDX`: the indexes leave dividends out, which flattered every stock by ~1.3%/yr. A failed fetch keeps the previous copy.

**Fund holdings.** Yahoo returns only a fund's top 10. Plain S&P 500 funds (name matches "S&P 500", none of growth/equal/leveraged…) take their top 15 from SPY's daily holdings xlsx (needs `openpyxl`) and record `fund.holdingsSource`. Falls back quietly to Yahoo.

**SEC press release.** `sec_earnings_release()` reads the latest 8-K with Item 2.02 (EDGAR submissions → filing index → EX-99), strips HTML, and keyword-picks guidance, one-off and headline sentences plus adjusted EPS into `d.filing`. Runs only when `SEC_USER_AGENT` is set (a repo **variable** in Actions); otherwise, or on failure, the previous `filing` is kept. Only sentences ending in a period and containing an amount are kept. Some filings are Windows-1252. Many companies (CHTR, MSFT, GOOG) print no adjusted EPS.

**SEC sources.** `sec_submissions()` fetches each company's EDGAR filing list once per run (shared with the press-release reader). `sec_sources()` stores `d.sources` (`cik`, `edgar` browse link, and `filings`: the latest of each `SOURCE_FORMS` kind plus the last 4 8-Ks with their item numbers, each linking its primary document). Equities only; a failure keeps the previous copy. `A.filingSources()` adds plain-English names and 8-K item meanings (`EIGHT_K_ITEMS`; `SERIOUS_ITEMS` like 4.02 get a "Worth a look" pill) for the Earnings tab's "Read the originals" card.

**Leverage caveats.** `fundamentals.debtByQuarter` (last 5 quarter-end debt/cash) and `filing.leverage` (`company_leverage()`: the company's own net debt/EBITDA from the press release, skipping target/range sentences; needs `SEC_USER_AGENT`. When the release states no ratio, as Charter's doesn't, `leverage_parts()` keeps the principal debt and the quarter's (pro forma) Adjusted EBITDA, and the app shows (debt − cash) ÷ (quarter × 4) as an estimate with its math) feed `A.leverageNotes()`. It explains a ≥ 10% debt jump in the last 3 quarters (an acquisition the trailing EBITDA hasn't caught up with: CHTR/Cox, Q3 2026) and the company's figure. It's shown in the Summary debt signal, `judge("netDebtToEbitda")`, the Balance sheet card, the Dividends debt check and the Valuation heavy-debt warning.

**Insiders.** `insider_trades()` stores ~400 days of Form 4 trades as `d.insiders.transactions`, with `kind` (buy/sell/award/gift/exercise/other) classified from Yahoo's `Text` and names reordered from SEC's LAST FIRST form by `insider_name()`. Yahoo's `insider_purchases` summary counts grants as purchases, so it isn't used.

**Dividends.** `dividend_info()` stores `d.dividends` for stocks and funds: up to 30 years of split-adjusted `payments` (by ex-date), `forwardRate` (includes an announced raise), `exDate`/`payDate` (calendar), a monthly trailing-12-month `yieldHistory` and 5-year `returns` (price-only vs dividend-adjusted). Those two need an extra `auto_adjust=False` history call. `{pays: false}` for non-payers; a failed fetch keeps the previous copy.

**Score history.** `scripts/score_history.mjs` (Node, preinstalled on GitHub's runners; workflow step "Record score history", `continue-on-error` so it never blocks the data save) writes `data/scores/<SYM>.json`: one point per UTC day (`A.scorePoint()`: score, part scores, each check's `[pts, status]`). It rescores the last data commit of each day from git history with today's `analysis.js` (checkout `fetch-depth: 0`), pinning `Date` to each file's `updated` time, so the line never jumps on a rule change. Points are reused by commit sha while `SCORE_VERSION` is unchanged. Archived tickers keep their file; removed tickers lose it. Node isn't installed locally: test `scorePoint`/`scoreMoves` in the browser.

**Cash uses.** `statement()` also keeps `netDebtIssued`, `acquisitions`, `stockIssued`, `stockComp`. Cash-flow rows keep the statement's signs (money out is negative).

## Analysis (`analysis.js`)

Pure functions: formatters, the signal checklist (`equitySignals`, `fundSignals`, thresholds inline), `overall()`, the earnings story, valuation, and the newer feature helpers. Generated sentences may mark phrases with `**bold**`, rendered via `rich()`.

**The score.** Weighted and sliding, not a pass/fail tally. Bump `SCORE_VERSION` on any formula change, so "since you last looked" doesn't report it as news. The glossary `rule` texts state the numbers below; change both.
- **Points.** Each check's pill keeps its three-step status, but the score uses `pts` (0–1 along a `ramp()` between two anchors, shown under the row) × a `SCORE_WEIGHTS` weight (equity weights sum to 10: business 1.5–2, estimates/earnings record 1, analyst view/price trend 0.75). `overall()` = Σ pts×weight ÷ Σ judged weight; `na` drops out. Checks without `pts` (dividend safety) score 1 / ½ / 0 at weight 1.
- **Valuation check** (`priceCheck`): the average of PEG (forward P/E alone for wild growth) and `fairValueGap()`, which is price vs the average of `valuationMethods()` minus analyst targets and the floor (2+ methods; −30% → 0, +30% → 1; counts a third when methods spread ≥ 1.6×). Opposite readings = "Mixed signals"; debt > 3.5× caps it at ½.
- **Acquisitions:** `acquisitionStep()` spots a big deal in the last 4 quarters (a quarter's revenue 8+ pts above last year's per-quarter pace while `debtByQuarter` jumps 10%+). Growth is then scored on the year before it. Organic growth (NVDA) and serial small acquirers don't trigger it.
- **Unsure estimates:** `estimateDoubt()` (next-year EPS range ÷ mean ≥ 0.75, or forward P/E < 6) caps the estimate trend and the PEG reading at ½.
- **Peer-adjusted profitability** is the only industry-relative check: half its `pts` is `om ÷ peer median` (0.5× → 0, 1.5× → 1; 3+ peers, positive median). The pill stays absolute. Debt, growth and valuation stay absolute on purpose.
- **Parts:** `SCORE_PARTS` = business / price / mood (funds: fund / price / mood). `overall().parts` are sub-totals that add to the total. Summary groups the rows under `partHead()` bars, `splitRead()` adds one sentence, and the home ring tooltip lists them.
- **Big drop:** `sharpDrop()` (≤ −15% over ~30 days) adds a page notice, a "⚠ −26%" home-card badge in the footer (the user found it crowded the symbol line) and a walkthrough line, and caps the analyst view at ½ ("Upside, but stale"). Otherwise the score is unchanged on purpose: it reads reported numbers, and the notice says it lags news.

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
- `judge(key, d)`: places the company against a glossary rule of thumb. It follows the score's exceptions: growth after a big acquisition is judged on the year before, and rising estimates count as in between while `estimateDoubt()` holds.
- `example(key, d)`: one ticker's reading for the glossary's "On your watchlist" list: `judge()` for terms with a rule, or a raw value (`RAW_EXAMPLES`, tone null, `x` to sort highest first) for numbers with no good or bad level (size, margins, 52-week range, drawdown, fair value).
- `earningsQuality()`: "Are the profits real?" on Financials: share count (reuses `judge("shareCount")`), stock pay ÷ sales (annual), operating cash flow ÷ net income (summed over up to 4 years), and receivables and inventory growth vs sales (same quarter a year apart from `debtByQuarter`, skipped when small; a red flag drops to watch during an `acquisitionStep()`). **Not scored**, by the user's choice (noisy, industry-dependent). Thresholds match the glossary `rule`s; `judge()` reads them for the thumbs.
- `scorePoint()` / `scoreMoves()`: score history (see the pipeline section). Moves are each check's Δpts × weight ÷ the day's judged weight × 100; a check entering or leaving `na` is listed as such.
- `quarterScore()`: 5-check report grade.
- `oneOffs()` / `oneOffMiss()` / `reportQuarter()`: one-off charges that explain a miss.
- `translateRelease()`: pattern rules turning press-release sentences into plain English.
- `newsMood()`: a labelled keyword heuristic.
- `insiderSummary()`: 12-month open-market buys/sells. Grants ignored.
- `cashUses()`: free cash flow vs buybacks, dividends, debt, acquisitions, plus share count.
- `drawdowns()` / `dropStory()`: % below previous high over the price history, and the worst-drop sentences.
- `fingerprint()` / `changesSince()`: "Since you last looked".
- `newListing()`: a stock whose price history starts within the last 2 years (our history covers 5, so a later start is its listing date). The same rules apply to every ticker: under 4 reported quarters makes the earnings record "too new to judge", under 200 trading days does the same for the price trend, the estimate trend is never judged while it's a new listing, and expected EPS growth over `WILD_GROWTH` (100%/yr) skips the PEG and judges the forward P/E alone. These are `na`, so they drop out of the score. The ticker page shows a "Recently listed" notice, and `modelWarnings()` flags both cases.
- `dividendStory()`: everything on the Dividends tab. It flags specials (well above the payments around them; one lumped with a regular payment is split) and Yahoo glitches (a lone tiny payment), and reads each payment's yearly rate from the next few gaps (a missing payment or a yearly→quarterly switch isn't a cut). Raise streak = a chain of raises ≤ 18 months apart (calendar years break when a raise shifts years). 5 safety checks; thresholds match the glossary `cashPayout`/`dividendGrowth`/`dividendStreak` rules and reuse `judge("payoutRatio"/"netDebtToEbitda")`.
- `moneyShort()`: amounts like $175K / $1.4M.

## Pages and features

One ES module per page and per tab (see CLAUDE.md's map); imports between them are circular, which is fine because top-level code only runs function declarations and local constants. Keep it that way: a top-level `const` that reads another module's `const` can hit it before it's initialized.

Hash router: `#/`, `#/t/SYM/<tab>`, `#/ideas`, `#/learn`, `#/settings`. Equity tabs: Summary, Walkthrough, Earnings, Financials, Dividends, Valuation, Peers, Analysts, News. ETF tabs: Summary, Walkthrough, Holdings, Dividends, News. Tiny `h()` DOM builder.

**Home cards.** Each card shows the checklist score as a small `scoreRing()` (the same ring as Summary's, top right) and `overall().short` (Strong / Mixed / Caution) in the footer, so the earnings date stays on one line. Summary keeps the full `lean` wording. `toneClass(ov)` gives home and Ideas cards a border in the ring's color (none without a score). `scoreRing()` sets its box to the drawn size so the number stays centered at any size.

**Score over time.** Under the Summary score, `scoreTrend()` lazy-loads `data/scores/<SYM>.json` and shows a sparkline, "Up N since …" and "How it moved ›" (a wide sheet: a 0–100 line chart via `lineChart({ yRange })` and the moves list). `scoreSeries()` drops the file's point for today's date and appends one computed in the browser, so the line ends on the ring's score even before the next update rescores the past.

**Previous / next ticker.** `tickerPager()` sits beside "‹ Watchlist" on the ticker page: home order, the home tag filter if the ticker is in it (else every active ticker; archived tickers step through the archived ones), wraps around, and keeps the current tab.

**Rule-of-thumb badges.** `renderTicker` sets module-level `CUR` (cleared in `route()`); `termBtn(key)` appends a thumb from `A.judge(key, CUR)`. The popover and glossary sheet show the same verdict (`judgeBox`). The sheet and each Learn-page entry (built on first open) also list every active ticker via `examplesBox()`: grouped passes / in between / fails, the current ticker highlighted.

**Hover popovers.** On `(hover: hover) and (pointer: fine)`, elements with `data-term` or `data-tip`/`data-tip-title` show a popover (delegated listeners in `sheets.js`). Click still opens the bottom sheet.

**Looks off.** `A.dataChecks(d)` flags numbers too far out to be real: no price, price outside the 52-week range, yield > 15%, Yahoo P/E ≠ price ÷ EPS by > 30%, net margin > 100%, no sales on a $1B+ company, middle analyst target > 3× off, any included valuation method > 5× off, the blended fair value > 3× off, or a fund with no holdings. Thresholds are in `A.ODD`, and the texts read them. `checksNote()` in `ticker.js` shows each check in full on its own tab; Summary shows one line per check with a link. Display only: the score never changes. All 8 tickers were clean when it shipped (2026-11-14), so a new warning is worth a look.

**Since you last looked.** Opening a ticker stores `A.fingerprint()` in localStorage (`stockdash.seen.<SYM>`). When the data's `updated` differs, `changesSince()` lists what moved. The banner above the tabs keeps showing it (from `prev`) until "Got it". Home cards show "N new" for data not yet opened. Browser-only.

**Ideas page** (`#/ideas`, lightbulb in the top bar; home shows one link line under the cards). `A.ideaData()` shapes an idea like a watchlist file (`lite: true`) so `equitySignals()` runs the same checks. What ideas can't see counts as neutral via `unknownSig()` (½ pts): the earnings record, the estimate trend, and the fair-value half of the valuation check (`lite` skips `fairValueGap`). The user found dropping them made scores too high. The neighbor's profitability compares with the `via` ticker's peers. `A.ideaWhy()` compares a neighbor with its `via` ticker on growth, margin, debt and forward P/E, listing better and worse. The preview sheet also shows the `via` ticker's `A.quickSignals()` score, because quick scores run higher than full ones. The sheet opens with `openSheet(..., { cls: "wide" })`: on laptops, story and score on the left, checks on the right. Hide (`stockdash.ideasHidden`), seen (`ideasSeen`, for the "new" badges) and the source filter are in localStorage. Research uses the normal `startTask` add.

**Logos and tag icons.** `logo(sym, name, size)` renders a white tile (both themes, since many logos are dark on transparent) or `letterTile()`. Tags show as `tagIcon()` (eye watching, magnifier researching, box archived) beside the symbol, with a hover tip and aria-label; the home filter chips carry the same icons with words, as the key. The user picked icons over W/R letters.

**Peers tab.** `PEER_GROUPS` rows have `self(d)` / `peer(p)` getters reading the same field, an `ok` filter for meaningless values, and `better` (`null` = not ranked, e.g. beta). "Beats/lags most peers" = better/worse than ≥ 2/3 of peers with a usable value. Labels use `termPlain()` (no thumb, since this tab ranks against peers). This replaced a watchlist-wide compare page at the user's request.

**Price chart "vs" picker and Drops.** One `<select>`: No comparison / vs S&P 500 / vs Nasdaq 100 / vs both (pref `vs`). `A.BENCHES` in `analysis.js` holds names, fixed colors (SPY `--series-2`, QQQ `--series-3`) and the hover text. `A.tracksBench()` hides a benchmark on a fund that tracks the same index (VOO gets only Nasdaq 100). Drops plots `drawdowns().under` for the stock and each picked benchmark (`yMax: 0` caps the axis); `dropStory()` always uses SPY. The range chips, picker and Drops checkbox share a fixed row and the summary text sits below, so the controls never move (the user asked for this). In the % views each series' `tip(i, v)` adds the $ price to the hover.

**Analyst rating changes.** First 15 shown in 3 columns, then "Show all". The left edge is colored by the firm's current Buy/Hold/Sell. Firm words (Overweight, Sector Perform…) map via `RATING_GROUP`, with hover meanings in `RATING_WORDS`.

**Walkthrough tab.** `A.walkSteps()` lists the slides (business first, then price): each names a real card by `tab` + `area`, a general "what this is", and "what it says" (mostly the scorecard text). `tabWalk()` renders each needed tab off-screen once via `TAB_FN` and moves the card with that `--area` into the slide, so a renamed area silently drops the panel (the slide still shows its text). Slide index is kept per ticker in `localStorage`; ←/→ keys work while it's on screen. The wrap-up slide lists every slide's pill.

## Laptop one-screen layout

`core.js` toggles `html.dash-on` at `(min-width:1100px) and (min-height:600px)`. Each tab builds cards inside `grid(name, flow)` (`.cols.dash.dash-<name>`), and `card(title, { area })` sets a `--area` CSS variable that becomes `grid-area` only under `html.dash-on`. Setting `grid-area` directly breaks the phone layout. Per-tab `grid-template-areas` live in `styles.css`.

`fitDash()` gives each non-flow `.dash` a **min-height** of the window (and `--dash-h`), so cards grow instead of scrolling internally. The user dislikes "windowed scrolling". Only long lists opt in, with `scroll-full`; others use a first batch plus "Show all" (`showMore()` in `core.js`).

Card content sits in `.card-body`, so sticky table headers stay flush. Earnings and Peers use flowing grids. Earnings and Financials charts use fixed heights (the user found filled charts too big). `fill: true` charts take their container's height, with the SVG absolutely positioned. `dash-hide` cards are hidden on laptop. Valuation keeps the Bear/Base/Bull buttons on top and the sliders collapsed at the bottom.

## Research flow and workflow

**Research.** With a fine-grained token in localStorage, `github.js` POSTs a `workflow_dispatch` to `update.yml` with a random `request_id`. It finds the run by `[request_id]` in `run-name`, polls the `fetch` job's steps, and maps step names to progress stages (`STAGES[].match`). Then it reads `data/last_request.json` and the new data via the Contents API, skipping the Pages delay. With a token, `fetchJSON` reads all data via the Contents API.

**Name search.** The Research box takes a company name or a ticker. `assets/lookup.js` lazy-loads `data/_names.json` (built on refresh runs by `build_names()` in `fetch.py`: SEC `company_tickers_exchange.json`, biggest first, plus ETFs from the SEC fund series/class CSV; mutual fund classes, preferreds, warrants, units and rights are dropped). `ALIASES` maps everyday names and brands to the listed parent (Facebook → META, "s&p 500" → VOO/SPY/IVV); facts only, no private companies, and an alias whose ticker is missing just vanishes. `SHARE_CLASSES` is hand-listed because the SEC list also repeats a company's name for bonds/notes (AT&T's TBB); other repeats are labeled "another listing". A typed name that isn't a ticker must be picked from the suggestions (so a guess never researches the wrong company); a ticker not on the list (foreign, e.g. `SHOP.TO`) still goes through. Picking a ticker already on the watchlist opens it instead.

**Edit list.** Home's "Edit list" button (shown with a token) swaps the view for `renderEdit()`: ↑/↓ and HTML5 drag (mouse only) to reorder, a tag picker per row, and delete/undo on archived rows. Nothing happens until Save, which updates `state.index` at once and runs action `edit` with input `order` = `"SYM:tag,…,-SYM"` (new order, `-` = delete). `fetch.py` applies it in one run (unlisted tickers keep their place at the end), rebuilds only tickers leaving the archive, and keeps `index.json`'s `updated`. A failed run reloads, so the list snaps back. Home shows archived tickers only in a collapsed "Archived" panel, outside chips, earnings and Side by side.

**Workflow.** One workflow handles schedule (weekdays 21:30 UTC), `workflow_dispatch` and push.
- **Push:** only deploys. The `fetch` job is skipped, so new data fields appear only after the next refresh. Trigger one with `gh workflow run update.yml -f action=refresh`.
- **Saving data:** the `fetch` job commits with `GITHUB_TOKEN`. Those pushes don't trigger workflows, so `deploy` is a job in the same workflow (Pages source: "GitHub Actions").
- **Queuing:** runs queue in one concurrency group. `fetch` checks out `ref: main`, because a queued run would otherwise start from its trigger commit and clash on save. On a save clash it rebases with `-X theirs`.
- **Inputs:** passed via `env`, never interpolated into `run:`.
- **Asset stamping:** the deploy job stamps `?v=<sha>` onto CSS/JS. New module imports must use the `from "./x.js"` form to get stamped.

**When Actions runs are stuck in the queue** (GitHub-side; they can refuse to cancel): refresh locally with `SEC_USER_AGENT` set from `gh variable get SEC_USER_AGENT`, then commit and push `data/`. A data-only push doesn't deploy (`paths-ignore`), so the site only picks it up on the next non-data push or a workflow run that gets through.
