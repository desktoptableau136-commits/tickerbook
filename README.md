# Tickerbook

A personal stock watchlist that explains the numbers in plain English. It's a static site on GitHub Pages, and GitHub Actions refreshes the data from Yahoo Finance every weekday after the market closes.

## What's where

| Path | What it does |
|---|---|
| `index.html`, `assets/` | The dashboard (plain HTML/CSS/JS, no build step) |
| `assets/analysis.js` | Signal thresholds, the plain-English summaries, the fair-value model |
| `assets/glossary.js` | Every jargon explanation and the "how to read an earnings report" guide |
| `scripts/fetch.py` | Pulls data from Yahoo Finance and writes `data/*.json` |
| `watchlist.json` | Your tickers and tags (owned / watching / researching) |
| `.github/workflows/update.yml` | Scheduled refresh + "Research" runs + deploy to Pages |

## Run it locally

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python scripts\fetch.py          # refresh data
.venv\Scripts\python -m http.server 8765       # then open http://127.0.0.1:8765
```

Add a ticker locally: `.venv\Scripts\python scripts\fetch.py --action add --ticker NVDA --tag researching`

## Put it on GitHub Pages

1. Create a new GitHub repo (it can be private if your plan supports private Pages; otherwise public) and push this folder to the `main` branch.
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Go to **Actions → Update data and deploy → Run workflow** once. After it finishes, the site is live at `https://<you>.github.io/<repo>/`.

## Turn on "Research a ticker" from the dashboard

1. On GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Repository access: **Only select repositories**, then pick this repo.
3. Permissions: **Actions: Read and write**, **Contents: Read-only**. Nothing else.
4. On the dashboard, open **Settings** (gear icon), paste the token, and tap **Save & test**. Repeat on each device.

The token is stored only in that browser's local storage.

## Optional: the company's own press release (SEC)

The Earnings tab can show each company's latest earnings press release (from its SEC 8-K filing): its own adjusted EPS, its outlook (guidance) and the one-time items it mentions. The SEC asks automated tools to identify themselves with a contact email, so this is off until you set one:

- **On GitHub:** Settings → Secrets and variables → Actions → **Variables** → New variable `SEC_USER_AGENT` with a value like `Tickerbook you@example.com`.
- **Locally:** `$env:SEC_USER_AGENT = "Tickerbook you@example.com"` before running `fetch.py`.

The address is sent only to sec.gov, in the request header.

## Privacy

- **No tracking.** No analytics, cookies, ads, web fonts or third-party scripts.
- **Content Security Policy** (in `index.html`): the page can only load its own files and talk to `api.github.com`. Anything else is blocked by the browser.
- **No referrer**: when you open a news link, the other site isn't told where you came from.
- **No indexing**: `noindex` / `noarchive` / `noai` meta tags plus `robots.txt` with `Disallow: /`.
- **Local only**: settings and your GitHub token live in your browser's local storage on each device.

## Notes

- Data is from Yahoo Finance via `yfinance`, which is unofficial and occasionally breaks or gets rate-limited. Re-running usually fixes it.
- Yahoo doesn't keep history of P/E or analyst estimates, so `fetch.py` saves a daily snapshot into each ticker's file. Those charts fill in over time.
- For learning and research only. Not financial advice.
