# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tickerbook: a personal, mobile-first stock watchlist dashboard for a long-term investor learning the jargon, so plain-English explanations are a core feature. It's a static site (plain HTML/CSS/ES modules, **no build step, no npm, no framework**) on GitHub Pages. Data is pre-fetched by `scripts/fetch.py` (yfinance) in GitHub Actions, not fetched live.

**Detailed notes per area (pipeline, valuation methods, features, layout, workflow) are in [`docs/architecture.md`](docs/architecture.md).** Read the relevant section before changing that area.

## Commands

```powershell
python -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python scripts\fetch.py                                   # refresh every ticker in watchlist.json
.venv\Scripts\python scripts\fetch.py --action add --ticker NVDA --tag researching   # also: remove, tag, edit --order "A:watching,B:archived,-C"
.venv\Scripts\python -m http.server 8765                                # serve; open http://127.0.0.1:8765
gh workflow run update.yml -f action=refresh                            # refresh the live data (a push only deploys)
```

There are no tests or linters. Verify UI changes in a browser at both ~1440px and 390px (see Gotchas). VOO prints `HTTP Error 404 ... No fundamentals data` during fetch; that's expected. A local fetch rewrites `data/`. Reset it (`git checkout -- data/`) before committing code, and let Actions refresh it.

## Map

- `watchlist.json` → `scripts/fetch.py` → `data/<SYM>.json`, `_bench.json`, `index.json`, `last_request.json` → browser.
- `assets/app.js`: router, every page and tab, sheets, popovers, research task.
- `assets/analysis.js`: pure functions (signals, valuation, plain-English text, feature helpers).
- `assets/charts.js`: hand-rolled SVG charts.
- `assets/glossary.js`: jargon entries; adding a metric usually means adding an entry.
- `assets/github.js`: Research client.
- `.github/workflows/update.yml`: fetch + deploy.

## Things that must stay in sync

- `update.yml` step names ↔ `STAGES` in `github.js`; also the `run-name` format and the job name `fetch`.
- `judge()` thresholds ↔ the glossary `rule` text.
- `debtPicture()` names valuation methods by number.
- Dark mode is defined twice in `styles.css` (`prefers-color-scheme` block guarded by `:not([data-theme="light"])`, and `[data-theme="dark"]`). Change both.
- Laptop grid placement goes through `card(title, { area })` → `--area`, never `grid-area` directly. Per-tab areas are in `styles.css`.
- `data/<SYM>.json` carries our own daily `history`. Never delete or regenerate a data file casually.

## Constraints to preserve

- **Privacy / CSP:** strict CSP in `index.html` (`script-src 'self'`, `connect-src 'self' https://api.github.com`), `noindex`/`no-referrer`, `robots.txt`. No CDN scripts, web fonts, analytics or inline `<script>`. External links use `rel="noopener noreferrer"`. Browser storage stays local. The user asked for no tracking.
- **Untrusted text** (names, headlines, firm names, filings) goes in as text nodes, never `html:`. Generated `**bold**` sentences go through `rich()`.
- **Mobile first:** base CSS ~390px wide; `640px` and `960px` breakpoints; inputs ≥ 16px.
- **Charts:** the validated palette (`--series-1..3`), status colors (`--good/--warn/--bad`) only with an icon + word, one y-axis, a legend for ≥ 2 series, text in ink tokens.
- **Every computed number shows its math or an explanation;** sanity-check valuation output against the market price.
- **Framing:** the score is a checklist tally, not a buy/sell call. Keep "not financial advice" disclaimers.

## Gotchas

- Headless Chrome on Windows won't lay out narrower than ~500px. Test phone width with the app in a 390px `<iframe>` served over HTTP. Use a fresh `--user-data-dir` per run, or Chrome serves stale CSS.
- On Windows, read JSON with `encoding="utf-8"`. Python's `write_text` writes CRLF; write with `newline="\n"`.
- `Element.append()` stringifies arrays; spread them (only `h()` flattens).
- `html.dash-on .dash > .card` is very specific; dash-mode overrides need equally specific selectors.
- Yahoo data is unofficial and inconsistent across endpoints. Next-earnings estimates come from `earnings_estimate`'s `0q` row to match the "What analysts expect" table.
- Node isn't installed; test JS in the browser.
