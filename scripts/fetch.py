"""Fetch market data for every ticker on the watchlist and write JSON for the site.

Usage:
  python scripts/fetch.py                          # refresh everything on the watchlist
  python scripts/fetch.py --action add --ticker NVDA --tag researching
  python scripts/fetch.py --action remove --ticker NVDA
  python scripts/fetch.py --action tag --ticker NVDA --tag archived
  python scripts/fetch.py --action edit --order "GOOG:watching,NVDA:researching,TGT:archived,-VZ"
      (the "Edit list" save: new order + tags; "-SYM" deletes a ticker; the UI only offers it on rows set to Archived)

Archived tickers are skipped by the daily refresh but keep their file and snapshot history.

Writes:
  data/<SYMBOL>.json   one file per ticker (all tabs read from this)
  data/_bench.json     SPY (S&P 500) and QQQ (Nasdaq 100) prices with dividends folded in,
                       for the price chart's "vs" comparisons
  data/index.json      list of tickers + tags + last update time
  data/last_request.json  outcome of the most recent add/remove/tag request
  data/_ideas.json     companies worth a look (watchlist peers + a broad screen), refresh only
  data/logos/          <SYM>.png/.jpg company icons + index.json (outcome per symbol; "skip": true hides a wrong one)
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WATCHLIST = ROOT / "watchlist.json"
TAGS = {"watching", "researching", "archived"}
TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-=^]{0,14}$")
HISTORY_KEEP = 1500  # daily snapshots kept per ticker (~6 years of trading days)
PEER_MAX = 8  # industry peers used for the "priced like its peers" valuation
HOLDINGS_MAX = 15
# S&P 500 funds hold the same index, so SPY's free daily holdings file gives the top 15
# for VOO/IVV/SPLG too (Yahoo only returns the top 10).
SPY_HOLDINGS = "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx"
SP500_RE = re.compile(r"S&P\s*500", re.I)
NOT_PLAIN_SP500 = re.compile(r"equal|growth|value|dividend|volatil|momentum|quality|leverag|2x|3x|inverse|short|bear|bull|ESG|buffer|option|covered", re.I)
# Benchmarks for the price chart. Funds, not the ^GSPC/^NDX indexes: price_history() folds
# dividends back into every ticker's prices, and the indexes leave them out.
BENCHES = {"SPY": "S&P 500", "QQQ": "Nasdaq 100"}


# ---------------------------------------------------------------- helpers

def clean(v):
    """Make a value JSON-safe: NaN/inf -> None, numpy/pandas scalars -> python."""
    if v is None:
        return None
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%d")
    if hasattr(v, "item"):
        try:
            v = v.item()
        except Exception:
            pass
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(v, 6)
    if v is pd.NA:
        return None
    return v


def pct(v):
    """Yahoo reports some fields as percents (0.72 = 0.72%). Convert to a decimal."""
    v = clean(v)
    return None if v is None else round(v / 100, 6)


def row(df: pd.DataFrame, *names):
    """First matching row of a financial statement, as {date: value}."""
    if df is None or df.empty:
        return {}
    for n in names:
        if n in df.index:
            return {clean(c): clean(df.loc[n, c]) for c in df.columns}
    return {}


def statement(income: pd.DataFrame, cash: pd.DataFrame, limit: int):
    """Turn income + cashflow statements into a list of periods, oldest first."""
    if income is None or income.empty:
        return []
    fields = {
        "revenue": row(income, "Total Revenue", "Operating Revenue"),
        "grossProfit": row(income, "Gross Profit"),
        "operatingIncome": row(income, "Operating Income", "Total Operating Income As Reported"),
        "netIncome": row(income, "Net Income", "Net Income Common Stockholders"),
        "eps": row(income, "Diluted EPS", "Basic EPS"),
        "ebitda": row(income, "EBITDA", "Normalized EBITDA"),
        "rnd": row(income, "Research And Development"),
        "interestExpense": row(income, "Interest Expense"),
        "unusualItems": row(income, "Total Unusual Items"),
        # what the one-off items were (Yahoo's line items; expenses are positive, gains positive in gain* rows)
        "unusualTax": row(income, "Tax Effect Of Unusual Items"),
        "writeOff": row(income, "Write Off"),
        "impairment": row(income, "Impairment Of Capital Assets"),
        "restructuring": row(income, "Restructuring And Mergern Acquisition"),
        "otherSpecial": row(income, "Other Special Charges"),
        "gainSecurities": row(income, "Gain On Sale Of Security"),
        "gainBusiness": row(income, "Gain On Sale Of Business"),
        "gainPpe": row(income, "Gain On Sale Of Ppe"),
        "dilutedShares": row(income, "Diluted Average Shares"),
        "operatingCashflow": row(cash, "Operating Cash Flow"),
        "capex": row(cash, "Capital Expenditure"),
        "freeCashflow": row(cash, "Free Cash Flow"),
        "buybacks": row(cash, "Repurchase Of Capital Stock"),
        "dividendsPaid": row(cash, "Cash Dividends Paid", "Common Stock Dividend Paid"),
        # where the rest of the cash went ("Where the cash goes" card)
        "netDebtIssued": row(cash, "Net Issuance Payments Of Debt", "Net Long Term Debt Issuance"),
        "acquisitions": row(cash, "Net Business Purchase And Sale", "Purchase Of Business"),
        "stockIssued": row(cash, "Common Stock Issuance", "Issuance Of Capital Stock"),
        "stockComp": row(cash, "Stock Based Compensation"),
    }
    dates = sorted({clean(c) for c in income.columns})
    out = []
    for d in dates:
        p = {"period": d}
        for k, series in fields.items():
            p[k] = series.get(d)
        if p["revenue"] is None:
            continue  # Yahoo sometimes includes an empty stub column
        out.append(p)
    return out[-limit:]


def df_records(df: pd.DataFrame, index_name: str):
    if df is None or df.empty:
        return []
    df = df.reset_index().rename(columns={df.index.name or "index": index_name})
    return [{k: clean(v) for k, v in r.items()} for r in df.to_dict("records")]


def retry(fn, tries=3, wait=4):
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # Yahoo occasionally rate-limits; back off and retry
            if i == tries - 1:
                raise
            print(f"   retrying after error: {e}")
            time.sleep(wait * (i + 1))


def quiet(fn, default=None):
    try:
        v = fn()
        return default if v is None else v
    except Exception:
        return default


# ---------------------------------------------------------------- prices

def price_history(tk: yf.Ticker):
    h = retry(lambda: tk.history(period="5y", interval="1d", auto_adjust=True))
    if h is None or h.empty:
        return {"dates": [], "close": []}
    h = h["Close"].dropna()
    return {
        "dates": [d.strftime("%Y-%m-%d") for d in h.index],
        "close": [round(float(c), 2) for c in h.values],
    }


def earnings_reaction(prices, when: pd.Timestamp):
    """How the stock moved on the first trading session after the report.

    Reports after 12pm local time (usually after the 4pm close) are judged by the
    next day's close vs that day's close; morning reports by that day's close vs
    the prior close.
    """
    dates, close = prices["dates"], prices["close"]
    if not dates:
        return None
    day = when.strftime("%Y-%m-%d")
    # index of the first trading day on/after the report date
    i = next((k for k, d in enumerate(dates) if d >= day), None)
    if i is None:
        return None
    after_close = when.hour >= 12
    if after_close:
        if dates[i] != day or i + 1 >= len(dates):
            # report day wasn't a trading day: treat dates[i] as the reaction day
            if dates[i] == day:
                return None
            before, after = i - 1, i
        else:
            before, after = i, i + 1
    else:
        before, after = i - 1, i
    if before < 0 or after >= len(close):
        return None
    return round(close[after] / close[before] - 1, 6)


# ---------------------------------------------------------------- per ticker

_peer_cache: dict = {}
_info_cache: dict = {}


def raw_info(sym: str) -> dict:
    """Yahoo's info for any symbol, fetched once per run (peers and ideas share it)."""
    if sym not in _info_cache:
        _info_cache[sym] = quiet(lambda: yf.Ticker(sym).info, {}) or {}
    return _info_cache[sym]


def peer_info(sym: str):
    if sym not in _peer_cache:
        i = raw_info(sym)
        _peer_cache[sym] = {
            "symbol": sym,
            "name": i.get("shortName") or i.get("longName") or sym,
            "longName": i.get("longName"),
            "marketCap": clean(i.get("marketCap")),
            "forwardPE": clean(i.get("forwardPE")),
            "trailingPE": clean(i.get("trailingPE")),
            "evToEbitda": clean(i.get("enterpriseToEbitda")),
            # the rest feeds the Peers tab; same fields (and units) as the ticker's own data
            "price": clean(i.get("currentPrice") or i.get("regularMarketPrice")),
            "peg": clean(i.get("trailingPegRatio") or i.get("pegRatio")),
            "priceToSales": clean(i.get("priceToSalesTrailing12Months")),
            "revenueGrowth": clean(i.get("revenueGrowth")),
            "operatingMargin": clean(i.get("operatingMargins")),
            "roe": clean(i.get("returnOnEquity")),
            "debt": clean(i.get("totalDebt")),
            "cash": clean(i.get("totalCash")),
            "ebitda": clean(i.get("ebitda")),
            "dividendYield": pct(i.get("dividendYield")),
            "beta": clean(i.get("beta")),
            "high52": clean(i.get("fiftyTwoWeekHigh")),
            "change52": clean(i.get("52WeekChange")),
            "targetMedian": clean(i.get("targetMedianPrice")),
            "recommendationMean": clean(i.get("recommendationMean")),
            "analystCount": clean(i.get("numberOfAnalystOpinions")),
        }
    return _peer_cache[sym]


def median(vals):
    v = sorted(vals)
    if not v:
        return None
    m = len(v) // 2
    return round(v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2, 4)


def build_peers(symbol: str, info: dict):
    """Biggest companies in the same Yahoo industry, with the multiples investors pay for them."""
    key = info.get("industryKey")
    if not key:
        return None
    top = quiet(lambda: yf.Industry(key).top_companies, None)
    if top is None or top.empty:
        return None
    own = {symbol, info.get("longName"), info.get("shortName")} - {None}
    peers = []
    for sym in top.index:
        if len(peers) >= PEER_MAX:
            break
        if sym in own:
            continue
        p = peer_info(sym)
        if p.get("longName") in own:  # another share class of the same company (GOOG/GOOGL)
            continue
        peers.append({k: v for k, v in p.items() if k != "longName"})
    ok = lambda k, lo, hi: [p[k] for p in peers if isinstance(p.get(k), (int, float)) and lo < p[k] < hi]
    return {
        "industry": info.get("industryDisp") or info.get("industry"),
        "list": peers,
        # extreme values (one-off losses, holding companies) are dropped before taking the median
        "medianForwardPE": median(ok("forwardPE", 0, 80)),
        "medianEvToEbitda": median(ok("evToEbitda", 0, 60)),
    }


def sp500_holdings(yahoo: list):
    raw = pd.read_excel(io.BytesIO(urllib.request.urlopen(
        urllib.request.Request(SPY_HOLDINGS, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read()), header=None)
    hdr = next(i for i in range(min(20, len(raw))) if str(raw.iloc[i, 0]).strip() == "Name")
    df = raw.iloc[hdr + 1:].copy()
    df.columns = [str(c).strip() for c in raw.iloc[hdr]]
    df = df[pd.to_numeric(df["Weight"], errors="coerce").notna()].sort_values("Weight", key=lambda c: pd.to_numeric(c), ascending=False)
    names = {h["symbol"]: h["name"] for h in yahoo}
    out = []
    for _, r in df.head(HOLDINGS_MAX).iterrows():
        sym = str(r["Ticker"]).strip().replace(".", "-")
        out.append({"symbol": sym, "name": names.get(sym) or str(r["Name"]).title(), "weight": round(float(r["Weight"]) / 100, 6)})
    as_of = str(raw.iloc[2, 1]).replace("As of", "").strip() if len(raw) > 2 else None
    return out, as_of


def debt_by_quarter(bs: pd.DataFrame, n: int = 5):
    """Debt and cash at each of the last few quarter ends, to spot a jump (usually an
    acquisition) that the trailing-12-month EBITDA hasn't caught up with yet."""
    debt = row(bs, "Total Debt")
    cash = row(bs, "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments")
    return [{"period": k, "debt": debt.get(k), "cash": cash.get(k)} for k in sorted(debt)[-n:] if debt.get(k) is not None]


def build_equity(tk: yf.Ticker, info: dict, prices: dict):
    q_inc = quiet(lambda: tk.quarterly_income_stmt, pd.DataFrame())
    q_cash = quiet(lambda: tk.quarterly_cashflow, pd.DataFrame())
    a_inc = quiet(lambda: tk.income_stmt, pd.DataFrame())
    a_cash = quiet(lambda: tk.cashflow, pd.DataFrame())
    bs = quiet(lambda: tk.quarterly_balance_sheet, pd.DataFrame())

    # earnings history with the price reaction to each report
    history = []
    ed = quiet(lambda: tk.get_earnings_dates(limit=16), None)
    nxt = None
    if ed is not None and not ed.empty:
        for when, r in ed.sort_index().iterrows():
            est, act = clean(r.get("EPS Estimate")), clean(r.get("Reported EPS"))
            if act is None:
                if when.tz_convert(None) > pd.Timestamp.now("UTC").tz_convert(None) and nxt is None:
                    nxt = {"date": when.strftime("%Y-%m-%d"),
                           "time": "after close" if when.hour >= 12 else "before open",
                           "epsEstimate": est}
                continue
            history.append({
                "date": when.strftime("%Y-%m-%d"),
                "time": "after close" if when.hour >= 12 else "before open",
                "epsEstimate": est,
                "epsActual": act,
                "surprise": pct(r.get("Surprise(%)")),
                "reaction": earnings_reaction(prices, when),
            })
    cal = quiet(lambda: tk.calendar, {}) or {}
    if nxt is None and cal.get("Earnings Date"):
        nxt = {"date": clean(cal["Earnings Date"][0]), "time": None, "epsEstimate": clean(cal.get("Earnings Average"))}
    if nxt is not None:
        # Prefer the analyst-estimates table ("0q" = the quarter reported next) so the
        # Next report card matches the "What analysts expect" table; calendar as fallback.
        ee = quiet(lambda: tk.earnings_estimate, pd.DataFrame())
        re_ = quiet(lambda: tk.revenue_estimate, pd.DataFrame())
        e0 = ee.loc["0q"] if ee is not None and "0q" in getattr(ee, "index", []) else {}
        r0 = re_.loc["0q"] if re_ is not None and "0q" in getattr(re_, "index", []) else {}
        pick = lambda src, k, fb: clean(src.get(k)) if len(src) and clean(src.get(k)) is not None else clean(cal.get(fb))
        nxt.update({
            "isEstimate": bool(info.get("isEarningsDateEstimate")),
            "epsEstimate": pick(e0, "avg", "Earnings Average") or nxt.get("epsEstimate"),
            "epsLow": pick(e0, "low", "Earnings Low"), "epsHigh": pick(e0, "high", "Earnings High"),
            "revenueEstimate": pick(r0, "avg", "Revenue Average"),
            "revenueLow": pick(r0, "low", "Revenue Low"), "revenueHigh": pick(r0, "high", "Revenue High"),
        })

    def bs_latest(*names):
        r = row(bs, *names)
        if not r:
            return None
        return r[max(r)] if r else None

    recs = quiet(lambda: tk.recommendations_summary, pd.DataFrame())
    ud = quiet(lambda: tk.upgrades_downgrades, pd.DataFrame())
    actions = []
    if ud is not None and not ud.empty:
        for when, r in ud.sort_index(ascending=False).head(25).iterrows():
            actions.append({
                "date": when.strftime("%Y-%m-%d"), "firm": r.get("Firm"),
                "to": r.get("ToGrade"), "from": r.get("FromGrade"), "action": r.get("Action"),
                "targetAction": r.get("priceTargetAction"),
                "target": clean(r.get("currentPriceTarget")), "priorTarget": clean(r.get("priorPriceTarget")),
            })

    return {
        "valuation": {
            "trailingPE": clean(info.get("trailingPE")),
            "forwardPE": clean(info.get("forwardPE")),
            "peg": clean(info.get("trailingPegRatio") or info.get("pegRatio")),
            "priceToSales": clean(info.get("priceToSalesTrailing12Months")),
            "priceToBook": clean(info.get("priceToBook")),
            "evToEbitda": clean(info.get("enterpriseToEbitda")),
            "evToRevenue": clean(info.get("enterpriseToRevenue")),
            "enterpriseValue": clean(info.get("enterpriseValue")),
            "dividendYield": pct(info.get("dividendYield")),
            "dividendRate": clean(info.get("dividendRate")),
            "payoutRatio": clean(info.get("payoutRatio")),
            "exDividendDate": clean(pd.to_datetime(info["exDividendDate"], unit="s")) if info.get("exDividendDate") else None,
        },
        "fundamentals": {
            "revenueTTM": clean(info.get("totalRevenue")),
            "revenueGrowth": clean(info.get("revenueGrowth")),
            "earningsGrowth": clean(info.get("earningsGrowth")),
            "grossMargin": clean(info.get("grossMargins")),
            "operatingMargin": clean(info.get("operatingMargins")),
            "netMargin": clean(info.get("profitMargins")),
            "ebitda": clean(info.get("ebitda")),
            "roe": clean(info.get("returnOnEquity")),
            "roa": clean(info.get("returnOnAssets")),
            "freeCashflow": clean(info.get("freeCashflow")),
            "operatingCashflow": clean(info.get("operatingCashflow")),
            "cash": clean(info.get("totalCash")),
            "debt": clean(info.get("totalDebt")),
            "debtToEquity": pct(info.get("debtToEquity")),
            "currentRatio": clean(info.get("currentRatio")),
            "sharesOutstanding": clean(info.get("sharesOutstanding")),
            "epsTTM": clean(info.get("trailingEps")),
            "epsForward": clean(info.get("forwardEps")),
            "shortPercentOfFloat": clean(info.get("shortPercentOfFloat")),
            "insiderOwnership": clean(info.get("heldPercentInsiders")),
            "institutionOwnership": clean(info.get("heldPercentInstitutions")),
            "equity": bs_latest("Stockholders Equity", "Common Stock Equity"),
            "netDebt": bs_latest("Net Debt"),
            "debtByQuarter": debt_by_quarter(bs),
            "goodwill": bs_latest("Goodwill And Other Intangible Assets", "Goodwill"),
        },
        "analysts": {
            "targets": {k: clean(v) for k, v in (quiet(lambda: tk.analyst_price_targets, {}) or {}).items()},
            "recommendationKey": info.get("recommendationKey"),
            "recommendationMean": clean(info.get("recommendationMean")),
            "count": clean(info.get("numberOfAnalystOpinions")),
            "summary": df_records(recs, "row") if recs is not None else [],
            "actions": actions,
        },
        "earnings": {
            "next": nxt,
            "history": history[-12:],
            "epsEstimate": df_records(quiet(lambda: tk.earnings_estimate, pd.DataFrame()), "period"),
            "revenueEstimate": df_records(quiet(lambda: tk.revenue_estimate, pd.DataFrame()), "period"),
            "epsTrend": df_records(quiet(lambda: tk.eps_trend, pd.DataFrame()), "period"),
            "epsRevisions": df_records(quiet(lambda: tk.eps_revisions, pd.DataFrame()), "period"),
            "growth": df_records(quiet(lambda: tk.growth_estimates, pd.DataFrame()), "period"),
        },
        "financials": {
            "quarterly": statement(q_inc, q_cash, 8),
            "annual": statement(a_inc, a_cash, 5),
        },
        "peers": quiet(lambda: build_peers(info.get("symbol") or tk.ticker, info), None),
        "insiders": quiet(lambda: insider_trades(tk), None),
    }


def build_fund(tk: yf.Ticker, info: dict):
    fd = quiet(lambda: tk.funds_data, None)
    holdings, sectors, assets, turnover, cat_expense = [], {}, {}, None, None
    if fd is not None:
        th = quiet(lambda: fd.top_holdings, pd.DataFrame())
        if th is not None and not th.empty:
            holdings = [{"symbol": s, "name": r.get("Name"), "weight": clean(r.get("Holding Percent"))}
                        for s, r in th.iterrows()]
    source = "Yahoo Finance (top 10 only)" if holdings else None
    name = info.get("longName") or info.get("shortName") or ""
    if SP500_RE.search(name) and not NOT_PLAIN_SP500.search(name):
        got = quiet(lambda: sp500_holdings(holdings), None)
        if got and got[0]:
            holdings, as_of = got
            source = f"SPY's daily holdings file{f' (as of {as_of})' if as_of else ''}. SPY tracks the same S&P 500 index, so the weights match"
    if fd is not None:
        sectors = {k: clean(v) for k, v in (quiet(lambda: fd.sector_weightings, {}) or {}).items()}
        assets = {k: clean(v) for k, v in (quiet(lambda: fd.asset_classes, {}) or {}).items()}
        ops = quiet(lambda: fd.fund_operations, pd.DataFrame())
        if ops is not None and not ops.empty:
            col = ops.columns[0]
            if "Annual Holdings Turnover" in ops.index:
                turnover = clean(ops.loc["Annual Holdings Turnover", col])
            if "Annual Report Expense Ratio" in ops.index and "Category Average" in ops.columns:
                cat_expense = clean(ops.loc["Annual Report Expense Ratio", "Category Average"])
    return {
        "fund": {
            "family": info.get("fundFamily"),
            "category": info.get("category"),
            "inception": clean(pd.to_datetime(info["fundInceptionDate"], unit="s")) if info.get("fundInceptionDate") else None,
            "expenseRatio": pct(info.get("netExpenseRatio")),
            "categoryExpenseRatio": cat_expense,
            "netAssets": clean(info.get("netAssets") or info.get("totalAssets")),
            "yield": clean(info.get("yield")) if info.get("yield") is not None else pct(info.get("dividendYield")),
            "trailingPE": clean(info.get("trailingPE")),
            "beta3Year": clean(info.get("beta3Year")),
            "ytdReturn": pct(info.get("ytdReturn")),
            "threeYearReturn": clean(info.get("threeYearAverageReturn")),
            "fiveYearReturn": clean(info.get("fiveYearAverageReturn")),
            "turnover": turnover,
            "holdings": holdings,
            "holdingsSource": source,
            "sectors": sectors,
            "assetClasses": assets,
        }
    }


def news_items(tk: yf.Ticker):
    out = []
    for n in quiet(lambda: tk.news, []) or []:
        c = n.get("content") or n
        url = ((c.get("canonicalUrl") or {}).get("url")) or ((c.get("clickThroughUrl") or {}).get("url")) or c.get("previewUrl")
        if not c.get("title") or not url:
            continue
        out.append({
            "title": c.get("title"),
            "summary": c.get("summary") or c.get("description"),
            "publisher": (c.get("provider") or {}).get("displayName"),
            "date": c.get("pubDate") or c.get("displayTime"),
            "url": url,
        })
    return out[:12]


INSIDER_KIND = [  # Form 4 descriptions Yahoo passes through, most specific first
    (re.compile(r"^purchase", re.I), "buy"),
    (re.compile(r"^sale", re.I), "sell"),
    (re.compile(r"award|grant", re.I), "award"),
    (re.compile(r"gift", re.I), "gift"),
    (re.compile(r"exercise|conversion|derivative", re.I), "exercise"),
]
NAME_SUFFIX = {"JR", "JR.", "SR", "SR.", "II", "III", "IV"}
ENTITY_RE = re.compile(r"\b(INC|LLC|L\.?P|CORP|CO|TRUST|FUND|PARTNERS|HOLDINGS|LTD|GROUP|FOUNDATION)\b", re.I)


def insider_name(raw: str) -> str:
    """SEC filings list people as LAST FIRST MIDDLE; turn that into 'First Middle Last'."""
    raw = " ".join(str(raw or "").split())
    if not raw or ENTITY_RE.search(raw):
        return raw.title()
    parts = raw.split(" ")
    suffix = [parts.pop()] if len(parts) > 2 and parts[-1].upper() in NAME_SUFFIX else []
    if len(parts) < 2:
        return raw.title()
    return " ".join(parts[1:] + parts[:1] + suffix).title()


def insider_trades(tk: yf.Ticker, days: int = 400, limit: int = 60):
    """Recent Form 4 filings: who bought or sold, and how much. Grants and gifts are kept
    but labelled, because only open-market buys and sales say anything about opinion."""
    df = tk.insider_transactions
    if df is None or df.empty:
        return None
    cutoff = pd.Timestamp.now() - pd.Timedelta(days=days)
    out = []
    for _, r in df.iterrows():
        when = pd.to_datetime(r.get("Start Date"), errors="coerce")
        if pd.isna(when) or when < cutoff:
            continue
        text = str(r.get("Text") or "").strip()
        kind = next((k for rx, k in INSIDER_KIND if rx.search(text)), "other")
        shares = clean(r.get("Shares"))
        value = clean(r.get("Value"))
        prices = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text.split("price", 1)[-1])[:2]] if "price" in text else []
        px = sum(prices) / len(prices) if prices else None
        if (not value) and kind in ("buy", "sell") and shares and px:
            value = round(shares * px, 2)
        out.append({
            "date": when.strftime("%Y-%m-%d"),
            "name": insider_name(r.get("Insider")),
            "role": str(r.get("Position") or "").strip().title() or None,
            "kind": kind,
            "shares": shares,
            "value": value or None,
            "price": round(px, 2) if px else None,
            "indirect": "I" in str(r.get("Ownership") or ""),
            "text": text or None,
        })
    out.sort(key=lambda x: x["date"], reverse=True)
    return {"transactions": out[:limit]}


def dividend_info(tk: yf.Ticker, info: dict, kind: str):
    """Dividend payments (split-adjusted, up to 30 years), the trailing-12-month yield at each
    month end over 5 years, and the 5-year return with and without dividends. The yield and the
    price-only return need prices *not* adjusted for dividends, hence the separate history call."""
    dv = quiet(lambda: tk.dividends, None)
    dv = dv[dv > 0] if dv is not None and len(dv) else None
    if dv is None or not len(dv):
        return {"pays": False}
    dv.index = dv.index.tz_localize(None) if dv.index.tz is not None else dv.index
    cutoff = pd.Timestamp.now() - pd.DateOffset(years=30)
    out = {
        "pays": True,
        "firstPaid": dv.index[0].strftime("%Y-%m-%d"),
        "payments": [{"date": t.strftime("%Y-%m-%d"), "amount": round(float(a), 4)} for t, a in dv.items() if t >= cutoff],
        "forwardRate": clean(info.get("dividendRate")),
        "trailingRate": clean(info.get("trailingAnnualDividendRate")),
        "fiveYearAvgYield": pct(info.get("fiveYearAvgDividendYield")),
        "exDate": clean(pd.to_datetime(info["exDividendDate"], unit="s")) if info.get("exDividendDate") else None,
        "payDate": None,
    }
    if kind == "EQUITY":
        cal = quiet(lambda: tk.calendar, {}) or {}
        day = lambda v: str(v)[:10] if v else None  # the calendar gives datetime.date objects
        out["exDate"] = day(cal.get("Ex-Dividend Date")) or out["exDate"]
        out["payDate"] = day(cal.get("Dividend Date"))
    h = quiet(lambda: retry(lambda: tk.history(period="5y", interval="1d", auto_adjust=False)), None)
    if h is not None and not h.empty and "Adj Close" in h:
        h = h[["Close", "Adj Close"]].dropna()
        h.index = h.index.tz_localize(None)
        out["returns"] = {
            "start": h.index[0].strftime("%Y-%m-%d"), "end": h.index[-1].strftime("%Y-%m-%d"),
            "rawStart": round(float(h["Close"].iloc[0]), 4), "rawEnd": round(float(h["Close"].iloc[-1]), 4),
            "adjStart": round(float(h["Adj Close"].iloc[0]), 4), "adjEnd": round(float(h["Adj Close"].iloc[-1]), 4),
        }
        dates, vals = [], []
        for when, close in h["Close"].resample("ME").last().dropna().items():
            if when - pd.Timedelta(days=365) < dv.index[0]:
                continue  # a partial first year would understate the yield
            ttm = float(dv[(dv.index > when - pd.Timedelta(days=365)) & (dv.index <= when)].sum())
            dates.append(min(when, h.index[-1]).strftime("%Y-%m-%d"))
            vals.append(round(ttm / float(close), 5) if close else None)
        out["yieldHistory"] = {"dates": dates, "values": vals}
    return out


def snapshot(d: dict):
    """The handful of numbers worth tracking day by day."""
    s = {"date": d["updated"][:10], "price": d["quote"]["price"]}
    if d["type"] == "EQUITY":
        v, a, e = d["valuation"], d["analysts"], d["earnings"]
        s.update({
            "forwardPE": v["forwardPE"], "trailingPE": v["trailingPE"],
            "targetMean": (a["targets"] or {}).get("mean"),
            "recMean": a["recommendationMean"],
        })
        for r in e["epsTrend"]:
            if r.get("period") == "+1y":
                s["epsNextYear"] = r.get("current")
        s["targetMedian"] = (a["targets"] or {}).get("median")
    else:
        s["trailingPE"] = d["fund"]["trailingPE"]
    return s


def fix_ttm(d):
    """Yahoo's info-level free cash flow is unreliable (e.g. $3B for Microsoft vs ~$60B in its
    filings), and sharesOutstanding can cover only one share class (GOOG). Rebuild both from
    the statements / market cap so per-share math is consistent."""
    f, q = d["fundamentals"], d["financials"]["quarterly"][-4:]
    f["freeCashflowYahoo"] = f.get("freeCashflow")
    if len(q) == 4 and all(x.get("freeCashflow") is not None for x in q):
        f["freeCashflow"] = sum(x["freeCashflow"] for x in q)
        f["freeCashflowSource"] = "last 4 quarterly cash flow statements"
    if len(q) == 4 and all(x.get("netIncome") is not None for x in q):
        f["netIncomeTTM"] = sum(x["netIncome"] for x in q)
    if len(q) == 4 and all(x.get("capex") is not None for x in q):
        f["capexTTM"] = sum(x["capex"] for x in q)
    mc, px = d["quote"].get("marketCap"), d["quote"].get("price")
    if mc and px:
        f["sharesImplied"] = round(mc / px)


# ---------------------------------------------------------------- SEC earnings press release (8-K)
# The SEC asks automated tools to identify themselves with a contact address, so this only runs
# when SEC_USER_AGENT is set (e.g. "Tickerbook your@email.com"; a repo variable in Actions).
SEC_UA = os.environ.get("SEC_USER_AGENT", "").strip()
_cik_map = None
SKIP_RE = re.compile(r"forward-looking|safe harbor|risks and uncertainties|undue reliance|non-gaap financial measures? (are|is) not|reconciliation|today announced|form 10-[kq]|\((nasdaq|nyse)", re.I)
GUIDE_RE = re.compile(r"\b(outlook|guidance|expects?|expected to|anticipates?|forecasts?|now sees|reaffirm\w*|rais\w+ (its|the) (full|annual))\b", re.I)
AMOUNT_RE = re.compile(r"\$\s?\d|\d\s?%|\d (million|billion)\b", re.I)
ONEOFF_RE = re.compile(r"\b(impairment|write-?downs?|write-?offs?|restructuring|severance|merger[- ]related|transaction[- ](related )?costs|integration costs|non-cash charge|one-time|litigation|settlement|gain on (the )?sale|(net )?(gains?|losses?) (from|on) (\w+ )?investments?)\b", re.I)
# The company's own leverage figure, e.g. "net debt to last twelve months Adjusted EBITDA was
# 3.9 times" or "net leverage ratio of 2.9x". A dot is allowed only inside a number.
_NE = r"(?:[^.;]|\.(?=\d))"
LEV_RE = re.compile(
    rf"\b(?:leverage|net debt|debt)\b{_NE}{{0,200}}?\bEBITDA\b{_NE}{{0,120}}?(\d{{1,2}}\.\d{{1,2}})\s?(?:x|×|times)(?![a-z])"
    rf"|\b(?:net )?leverage(?: ratio)?\s+(?:of|was|at|to|is)\s+(?:approximately\s+|about\s+)?(\d{{1,2}}\.\d{{1,2}})\s?(?:x|×|times)(?![a-z])", re.I)


PRINCIPAL_RE = re.compile(r"total principal amount of (?:debt|indebtedness) (?:was|of|totaled) (?:approximately )?\$\s?(\d+(?:\.\d+)?) billion", re.I)
QTR_EBITDA_RE = re.compile(r"\b(first|second|third|fourth) quarter (pro forma )?Adjusted EBITDA (?:of|was|totaled) (?:approximately )?\$\s?(\d+(?:\.\d+)?) (billion|million)", re.I)


def leverage_parts(t: str):
    """When a release gives no ratio (Charter), the pieces it does give: debt at the amount owed
    and the quarter's Adjusted EBITDA, preferring the pro forma figure after a deal."""
    p = PRINCIPAL_RE.search(t)
    qs = list(QTR_EBITDA_RE.finditer(t))
    q = next((m for m in qs if m.group(2)), qs[0] if qs else None)
    if not p or not q:
        return None
    return {"principalDebt": float(p.group(1)) * 1e9,
            "quarterEbitda": float(q.group(3)) * (1e9 if q.group(4).lower() == "billion" else 1e6),
            "quarter": q.group(1).lower(), "proForma": bool(q.group(2))}


def company_leverage(text: str):
    t = re.sub(r"\s+", " ", text)
    found = company_ratio(t)
    if found:
        return found
    parts = leverage_parts(t)
    return {"ratio": None, **parts} if parts else None


def company_ratio(t: str):
    for m in LEV_RE.finditer(t):
        v = float(m.group(1) or m.group(2))
        if not 0.3 <= v <= 15 or re.search(r"target|range|goal|covenant|maximum|no more than", m.group(0), re.I):
            continue
        dot = t.rfind(". ", 0, m.start())
        a = max(dot + 2 if dot >= 0 else 0, m.start() - 250)
        b = t.find(". ", m.end())
        snip = t[a:(b + 1 if 0 <= b < m.end() + 200 else m.end())].strip()
        return {"ratio": v, "text": snip, "proForma": bool(re.search(r"pro forma", snip, re.I)),
                "adjusted": bool(re.search(r"adjusted ebitda", snip, re.I))}
    return None


ADJ_EPS_RE = re.compile(r"(adjusted|non-gaap)[^.;]{0,40}?(diluted )?(eps|earnings per (diluted )?share|net income per (diluted )?share)[^.;$]{0,60}?\$\s?(\d{1,4}\.\d{2})", re.I)


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.out = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"): self.skip += 1
        if tag in ("p", "div", "br", "tr", "li", "td", "h1", "h2", "h3", "table"): self.out.append("\n")
    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip: self.skip -= 1
    def handle_data(self, data):
        if not self.skip: self.out.append(data)


def sec_get(url: str, as_json=True):
    req = urllib.request.Request(url, headers={"User-Agent": SEC_UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
    time.sleep(0.15)  # stay well under the SEC's 10 requests/second limit
    if as_json:
        return json.loads(raw)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252", "replace")  # many filings are Windows-1252, not UTF-8


def sentences(text: str):
    text = re.sub(r"[ \t\r\f\v ]+", " ", text)
    for block in re.split(r"\n\s*\n|\n", text):
        block = block.strip()
        if len(block) < 40:
            continue
        for snt in re.split(r"(?<=[.!?])\s+(?=[A-Z(“\"])", block):
            # drop leading bullets and footnote markers like "(1)"
            snt = re.sub(r"^(?:[\s•·▪●*\-]|\(\d+\))+", "", snt).strip()
            if not snt.endswith((".", "!", "?", ".”", '."')):
                continue  # headings, table labels, datelines
            if 40 <= len(snt) <= 420 and not SKIP_RE.search(snt):
                yield snt


def sec_earnings_release(symbol: str):
    """Latest 8-K with Item 2.02 (results of operations): the company's own press release."""
    global _cik_map
    if not SEC_UA:
        return None
    if _cik_map is None:
        raw = sec_get("https://www.sec.gov/files/company_tickers.json")
        _cik_map = {v["ticker"].upper(): int(v["cik_str"]) for v in raw.values()}
    cik = _cik_map.get(symbol.upper()) or _cik_map.get(symbol.upper().replace(".", "-"))
    if not cik:
        return None
    sub = sec_get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")["filings"]["recent"]
    pick = None
    for i, form in enumerate(sub["form"]):
        if form in ("8-K", "8-K/A") and "2.02" in (sub["items"][i] or ""):
            pick = i
            break
    if pick is None:
        return None
    acc = sub["accessionNumber"][pick]
    folder = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}"
    files = [f["name"] for f in sec_get(f"{folder}/index.json")["directory"]["item"]]
    htm = [f for f in files if f.lower().endswith((".htm", ".html"))]
    ex = [f for f in htm if re.search(r"ex-?99", f, re.I)] or [f for f in htm if f != sub["primaryDocument"][pick]]
    if not ex:
        return None
    doc = sorted(ex, key=lambda f: (not re.search(r"99[-_.]?1|991", f), f))[0]
    parser = _Text()
    parser.feed(sec_get(f"{folder}/{doc}", as_json=False))
    raw = "".join(parser.out)
    sents = list(dict.fromkeys(sentences(raw)))
    adj = None
    for snt in sents:
        m = ADJ_EPS_RE.search(snt)
        if m:
            adj = float(m.group(6))
            break
    # keep only sentences with an actual amount: drops boilerplate and table captions
    guidance = [x for x in sents if GUIDE_RE.search(x) and AMOUNT_RE.search(x)][:4]
    oneoffs = [x for x in sents if ONEOFF_RE.search(x) and AMOUNT_RE.search(x)][:4]
    highlights = [x for x in sents if AMOUNT_RE.search(x) and x not in guidance and x not in oneoffs][:3]
    return {
        "form": sub["form"][pick],
        "filed": sub["filingDate"][pick],
        "period": sub["reportDate"][pick] or None,
        "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{doc}",
        "adjustedEps": adj,
        "leverage": quiet(lambda: company_leverage(raw), None),
        "highlights": highlights,
        "guidance": guidance,
        "oneOffs": oneoffs,
    }


def build(symbol: str, tag: str):
    tk = yf.Ticker(symbol)
    info = retry(lambda: tk.info) or {}
    prices = price_history(tk)
    if not prices["close"]:
        raise LookupError(f"Yahoo Finance has no price data for {symbol}. Check the ticker spelling.")
    qtype = info.get("quoteType") or "EQUITY"
    kind = "ETF" if qtype in ("ETF", "MUTUALFUND") else "EQUITY"
    last, prev = prices["close"][-1], (prices["close"][-2] if len(prices["close"]) > 1 else None)
    price = clean(info.get("regularMarketPrice") or info.get("currentPrice")) or last
    prev_close = clean(info.get("regularMarketPreviousClose") or info.get("previousClose")) or prev

    d = {
        "symbol": symbol,
        "type": kind,
        "tag": tag,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "name": info.get("longName") or info.get("shortName") or symbol,
        "profile": {
            "sector": info.get("sectorDisp") or info.get("sector"),
            "industry": info.get("industryDisp") or info.get("industry"),
            "summary": info.get("longBusinessSummary"),
            "website": info.get("website"),
            "employees": clean(info.get("fullTimeEmployees")),
            "country": info.get("country"),
        },
        "quote": {
            "price": price,
            "previousClose": prev_close,
            "change": round(price - prev_close, 4) if price and prev_close else None,
            "changePct": round(price / prev_close - 1, 6) if price and prev_close else None,
            "currency": info.get("currency") or "USD",
            "marketCap": clean(info.get("marketCap")),
            "high52": clean(info.get("fiftyTwoWeekHigh")),
            "low52": clean(info.get("fiftyTwoWeekLow")),
            "allTimeHigh": clean(info.get("allTimeHigh")),
            "ma50": clean(info.get("fiftyDayAverage")),
            "ma200": clean(info.get("twoHundredDayAverage")),
            "beta": clean(info.get("beta") or info.get("beta3Year")),
            "volume": clean(info.get("regularMarketVolume")),
            "avgVolume": clean(info.get("averageVolume")),
            "marketTime": clean(pd.to_datetime(info["regularMarketTime"], unit="s", utc=True).strftime("%Y-%m-%dT%H:%M:%SZ")) if info.get("regularMarketTime") else None,
        },
        "prices": prices,
        "news": news_items(tk),
    }
    d.update(build_equity(tk, info, prices) if kind == "EQUITY" else build_fund(tk, info))
    if kind == "EQUITY":
        fix_ttm(d)
    d["dividends"] = quiet(lambda: dividend_info(tk, info, kind), None)

    # carry forward our own daily snapshot history (Yahoo doesn't keep this for us)
    old = DATA / f"{symbol}.json"
    hist, old_d = [], {}
    if old.exists():
        try:
            old_d = json.loads(old.read_text(encoding="utf-8"))
            hist = old_d.get("history", [])
        except Exception:
            hist = []
    if d.get("dividends") is None:
        d["dividends"] = old_d.get("dividends")  # a failed fetch keeps the last good copy
    if kind == "EQUITY":
        # the press release changes once a quarter, so keep the last good copy if the SEC is unreachable
        d["filing"] = quiet(lambda: sec_earnings_release(symbol), None) or old_d.get("filing")
    snap = snapshot(d)
    hist = [h for h in hist if h.get("date") != snap["date"]] + [snap]
    d["history"] = hist[-HISTORY_KEEP:]
    return d


# ---------------------------------------------------------------- ideas

# The broad screen's rules, shown word for word on the Ideas page. Ticker-neutral on purpose:
# every company is held to the same numbers, and nothing is added or left out by name.
SCREEN_RULES = [
    ("Listed on a major US exchange (NYSE, Nasdaq or NYSE American)", "is-in", ["exchange", "NMS", "NYQ", "NGM", "NCM", "ASE"]),
    ("Company worth $10B to $500B", "btwn", ["intradaymarketcap", 10e9, 500e9]),
    ("Sales up more than 8% over the last year", "gt", ["totalrevenues1yrgrowth.lasttwelvemonths", 8]),
    ("Keeps more than 12¢ of profit from every $1 of sales", "gt", ["netincomemargin.lasttwelvemonths", 12]),
    ("Total debt under 3 years of EBITDA", "lt", ["totaldebtebitda.lasttwelvemonths", 3]),
]
SCREEN_MAX = 40  # the largest companies that pass, by market value
SUMMARY_CHARS = 420


def idea_info(sym: str):
    """The numbers the Ideas page scores a company on: the same fields (and units) as a
    watchlist ticker's own data, so the browser runs the same checks on them."""
    i = raw_info(sym)
    if not i or (i.get("quoteType") or "EQUITY") != "EQUITY":
        return None
    about = (i.get("longBusinessSummary") or "").strip()
    if len(about) > SUMMARY_CHARS:
        cut = about[:SUMMARY_CHARS]
        about = cut[: cut.rfind(". ") + 1] if ". " in cut else cut.rsplit(" ", 1)[0] + "…"
    return {
        "symbol": sym,
        "name": i.get("shortName") or i.get("longName") or sym,
        "longName": i.get("longName"),
        "industry": i.get("industryDisp") or i.get("industry"),
        "sector": i.get("sectorDisp") or i.get("sector"),
        "about": about or None,
        "website": i.get("website"),
        "price": clean(i.get("currentPrice") or i.get("regularMarketPrice")),
        "ma200": clean(i.get("twoHundredDayAverage")),
        "marketCap": clean(i.get("marketCap")),
        "forwardPE": clean(i.get("forwardPE")),
        "trailingPE": clean(i.get("trailingPE")),
        "peg": clean(i.get("trailingPegRatio") or i.get("pegRatio")),
        "revenueGrowth": clean(i.get("revenueGrowth")),
        "operatingMargin": clean(i.get("operatingMargins")),
        "freeCashflow": clean(i.get("freeCashflow")),
        "debt": clean(i.get("totalDebt")),
        "cash": clean(i.get("totalCash")),
        "ebitda": clean(i.get("ebitda")),
        "dividendYield": pct(i.get("dividendYield")),
        "targetMedian": clean(i.get("targetMedianPrice")),
        "targetMean": clean(i.get("targetMeanPrice")),
        "analystCount": clean(i.get("numberOfAnalystOpinions")),
        "recommendationKey": i.get("recommendationKey"),
    }


def run_screen():
    from yfinance import EquityQuery as Q
    q = Q("and", [Q(op, args) for _, op, args in SCREEN_RULES])
    got = retry(lambda: yf.screen(q, sortField="intradaymarketcap", sortAsc=False, size=min(100, SCREEN_MAX * 2)))
    return [x["symbol"] for x in (got or {}).get("quotes", []) if x.get("symbol")], (got or {}).get("total")


def build_ideas(wl):
    """Companies worth a look, from two places: the industry peers already fetched for each
    watchlist ticker ("neighbors"), and a broad screen with rules anyone can read. The browser
    scores them with the same checks as the watchlist. Writes data/_ideas.json."""
    path = DATA / "_ideas.json"
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        old = {}
    first = {x["symbol"]: x.get("firstSeen") for x in old.get("list", [])}
    on_list = {t["symbol"] for t in wl["tickers"]}
    # another share class of a company already on the watchlist isn't a new idea (GOOG/GOOGL)
    own_names = set()
    for s in on_list:
        try:
            j = json.loads((DATA / f"{s}.json").read_text(encoding="utf-8"))
            own_names |= {j.get("name"), j.get("longName")} - {None}
        except Exception:
            pass
    ideas: dict = {}

    def add(sym, source, via=None):
        if sym in on_list:
            return
        if sym not in ideas:
            x = idea_info(sym)
            if not x or not isinstance(x.get("price"), (int, float)):
                return
            if x.get("longName") in own_names or any(y.get("longName") and y["longName"] == x.get("longName") for y in ideas.values()):
                return
            ideas[sym] = {**x, "sources": [], "via": []}
        if source not in ideas[sym]["sources"]:
            ideas[sym]["sources"].append(source)
        if via and via not in ideas[sym]["via"]:
            ideas[sym]["via"].append(via)

    for t in wl["tickers"]:
        if t["tag"] == "archived":
            continue
        try:
            j = json.loads((DATA / f"{t['symbol']}.json").read_text(encoding="utf-8"))
        except Exception:
            continue
        for p in ((j.get("peers") or {}).get("list") or []):
            add(p["symbol"], "neighbor", t["symbol"])

    screen = {"rules": [r for r, _, _ in SCREEN_RULES], "max": SCREEN_MAX}
    try:
        syms, total = run_screen()
        screen.update(ok=True, total=total)
        n = 0
        for s in syms:
            if n >= SCREEN_MAX:
                break
            before = s in ideas and "screen" in ideas[s]["sources"]
            add(s, "screen")
            if s in ideas and not before:
                n += 1
    except Exception as e:
        print(f"   screen FAILED: {e}")
        screen["ok"] = False
        # keep the last good screen results so the page isn't half empty for a day
        for x in old.get("list", []):
            if "screen" in x.get("sources", []) and x["symbol"] not in on_list and x["symbol"] not in ideas:
                ideas[x["symbol"]] = {**x, "sources": ["screen"], "via": []}

    day = today()
    out = []
    for x in ideas.values():
        x.pop("longName", None)
        x["firstSeen"] = first.get(x["symbol"]) or day
        out.append(x)
    write_json(path, {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "screen": screen, "list": out})
    print(f"   {len(out)} ideas ({sum('neighbor' in x['sources'] for x in out)} neighbors, {sum('screen' in x['sources'] for x in out)} from the screen)")


# ---------------------------------------------------------------- logos

# Logos are saved into the repo (data/logos/<SYM>.png or .jpg) by the update, so the site only ever loads
# its own files: no logo service ever sees which tickers you look at. The source is the square
# "apple-touch-icon" most company websites publish for phone home screens (usually 180px).
LOGOS = DATA / "logos"
LOGO_MIN_PX = 48          # smaller icons look blurry at card size; the card shows a letter tile instead
LOGO_MAX_BYTES = 200_000
LOGO_RECHECK_OK = 180     # days before a saved logo is fetched again
LOGO_RECHECK_MISS = 30    # days before a company without one is tried again
LOGO_UA = "Mozilla/5.0 (compatible; TickerbookLogoFetch/1.0)"


class _IconLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = []  # (priority, size, href)

    def handle_starttag(self, tag, attrs):
        if tag != "link":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        rel, href = a.get("rel", "").lower(), a.get("href", "").strip()
        if not href or "icon" not in rel or "mask" in rel:
            return
        m = re.search(r"(\d+)x\d+", a.get("sizes", ""))
        size = int(m.group(1)) if m else 0
        self.found.append((0 if "apple-touch-icon" in rel else 1, -size, href))


def _get(url, limit):
    req = urllib.request.Request(url, headers={"User-Agent": LOGO_UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.geturl(), r.headers.get("Content-Type", ""), r.read(limit + 1)


def png_size(b: bytes):
    """Width and height from a PNG header, or None if it isn't a PNG."""
    if len(b) < 24 or b[:8] != b"\x89PNG\r\n\x1a\n" or b[12:16] != b"IHDR":
        return None
    return int.from_bytes(b[16:20], "big"), int.from_bytes(b[20:24], "big")


def jpeg_size(b: bytes):
    """Width and height from a JPEG's frame header, or None if it isn't a JPEG."""
    if b[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(b):
        if b[i] != 0xFF:
            return None
        marker, seg = b[i + 1], int.from_bytes(b[i + 2:i + 4], "big")
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return int.from_bytes(b[i + 7:i + 9], "big"), int.from_bytes(b[i + 5:i + 7], "big")
        i += 2 + seg
    return None


def image_kind(b: bytes):
    """("png" | "jpg", width, height), or None."""
    d = png_size(b)
    if d:
        return ("png", *d)
    d = jpeg_size(b)
    return ("jpg", *d) if d else None


def as_image(b: bytes):
    """A PNG or JPEG as is, or the largest PNG inside a .ico (modern favicons embed them).
    Anything else returns None; SVG in particular is never saved, since it can carry scripts."""
    if image_kind(b):
        return b
    if len(b) < 6 or b[:4] != b"\x00\x00\x01\x00":
        return None
    best = None
    for k in range(int.from_bytes(b[4:6], "little")):
        e = b[6 + 16 * k: 22 + 16 * k]
        if len(e) < 16:
            break
        size, off = int.from_bytes(e[8:12], "little"), int.from_bytes(e[12:16], "little")
        part = b[off: off + size]
        if png_size(part) and (best is None or png_size(part)[0] > png_size(best)[0]):
            best = part
    return best


def find_logo(website: str):
    """The company's square icon as PNG bytes, or (None, reason)."""
    if not website or not website.startswith(("http://", "https://")):
        return None, "no website"
    urljoin = urllib.parse.urljoin
    cands = []
    try:
        base, _, html = _get(website, 600_000)
        p = _IconLinks()
        p.feed(html.decode("utf-8", "replace"))
        cands = [urljoin(base, href) for _, _, href in sorted(p.found)]
    except Exception:
        base = website  # many big companies' sites block automated requests
    cands += [urljoin(base, "/apple-touch-icon.png"), urljoin(base, "/apple-touch-icon-precomposed.png")]
    # Fallback: Google's public favicon service often has the icon of a site that blocks us. It's
    # called only from the update job, never from the browser.
    host = urllib.parse.urlparse(website).hostname
    if host:
        cands.append(f"https://www.google.com/s2/favicons?domain={host}&sz=128")
    why = "no square icon found"
    for url in dict.fromkeys(cands):
        if not url.startswith("https://"):
            continue
        try:
            _, ctype, b = _get(url, LOGO_MAX_BYTES)
        except Exception:
            continue
        if len(b) > LOGO_MAX_BYTES:
            why = "icon too large"
            continue
        b = as_image(b)
        if not b:
            why = "icon isn't a PNG or JPEG"
            continue
        _, w, h = image_kind(b)
        if min(w, h) < LOGO_MIN_PX or max(w, h) > 2 * min(w, h):
            why = f"icon too small or not square ({w}×{h})"
            continue
        return b, url
    return None, why


def update_logos(symbols_sites: dict):
    """symbols_sites: {SYM: website}. Fetches logos that are missing or due for a recheck and
    records the outcome in data/logos/index.json. An entry with "skip": true (set by hand when a
    logo is wrong) is never fetched and shows the letter tile."""
    LOGOS.mkdir(exist_ok=True)
    path = LOGOS / "index.json"
    try:
        idx = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        idx = {}
    now = datetime.now(timezone.utc)

    def due(sym, site):
        e = idx.get(sym) or {}
        if e.get("skip"):
            return False
        try:
            age = (now - datetime.fromisoformat(e["checked"])).days
        except Exception:
            return True
        return age >= (LOGO_RECHECK_OK if e.get("ok") else LOGO_RECHECK_MISS) or e.get("site") != site

    todo = [(s, w) for s, w in symbols_sites.items() if due(s, w)]
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as ex:  # each worker hits a different company's site
        found = list(ex.map(lambda sw: quiet(lambda: find_logo(sw[1]), (None, "error")), todo))
    fetched = len(todo)
    for (sym, site), (b, src) in zip(todo, found):
        e = idx.get(sym) or {}
        if b:
            ext = image_kind(b)[0]
            for old in LOGOS.glob(f"{sym}.*"):
                if old.suffix in (".png", ".jpg"):
                    old.unlink()
            (LOGOS / f"{sym}.{ext}").write_bytes(b)
            idx[sym] = {"ok": True, "file": f"{sym}.{ext}", "site": site, "src": src, "checked": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
        else:
            # keep an older good logo if this attempt failed
            idx[sym] = {**e, "ok": bool(e.get("ok")) and (LOGOS / str(e.get("file"))).exists(), "site": site, "why": src,
                        "checked": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
    write_json(path, dict(sorted(idx.items())))
    have = sum(1 for s in symbols_sites if idx.get(s, {}).get("ok"))
    print(f"   logos: {have} of {len(symbols_sites)} (checked {fetched} this run)")


def logo_sites(wl, extra=None):
    """Website for every active watchlist ticker and every idea."""
    out = {}
    for t in wl["tickers"]:
        if t["tag"] == "archived":
            continue
        try:
            j = json.loads((DATA / f"{t['symbol']}.json").read_text(encoding="utf-8"))
        except Exception:
            continue
        if j.get("type") != "ETF":
            out[t["symbol"]] = (j.get("profile") or {}).get("website")
    try:
        for x in json.loads((DATA / "_ideas.json").read_text(encoding="utf-8")).get("list", []):
            out.setdefault(x["symbol"], x.get("website"))
    except Exception:
        pass
    out.update(extra or {})
    return out


# ---------------------------------------------------------------- main

def write_json(path: Path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def load_watchlist():
    wl = json.loads(WATCHLIST.read_text(encoding="utf-8"))
    for t in wl["tickers"]:  # "owned" was retired; anything unknown becomes researching
        if t.get("tag") not in TAGS:
            t["tag"] = "watching" if t.get("tag") == "owned" else "researching"
    return wl


def save_watchlist(wl):
    WATCHLIST.write_text(json.dumps(wl, indent=2) + "\n", encoding="utf-8")


def today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


ARCH_KEYS = ("archivedOn", "archivedPrice", "archivedPriceDate")


def set_tag(entry, tag):
    """Change a watchlist entry's tag, stamping or clearing the archive date and the price it
    was archived at (the last close we have). Returns True when the ticker comes back out of
    the archive (so it needs a refresh)."""
    was = entry["tag"] == "archived"
    entry["tag"] = tag
    if tag == "archived" and not was:
        entry["archivedOn"] = today()
        try:
            q = json.loads((DATA / f"{entry['symbol']}.json").read_text(encoding="utf-8"))["quote"]
            entry["archivedPrice"] = q["price"]
            entry["archivedPriceDate"] = (q.get("marketTime") or today())[:10]
        except Exception:
            pass
    elif tag != "archived":
        for k in ARCH_KEYS:
            entry.pop(k, None)
    return was and tag != "archived"


def archived_moves(wl):
    """A light daily price check for archived tickers (no full fetch, no snapshot): the latest
    close and the move since the archive-day close. The move uses split/dividend-adjusted
    closes, so a split while archived doesn't look like a crash."""
    out = {}
    for t in wl["tickers"]:
        if t["tag"] != "archived" or not t.get("archivedPriceDate"):
            continue
        print(f"-> {t['symbol']} (archived: price check only)")
        try:
            h = retry(lambda: yf.Ticker(t["symbol"]).history(start=t["archivedPriceDate"], interval="1d", auto_adjust=True))["Close"].dropna()
            if len(h):
                out[t["symbol"]] = {"price": round(float(h.iloc[-1]), 2), "date": h.index[-1].strftime("%Y-%m-%d"),
                                    "move": round(float(h.iloc[-1] / h.iloc[0] - 1), 4)}
        except Exception as e:
            print(f"   FAILED: {e}")
    return out


def sync_data_file(entry):
    """Copy the tag and archive date into data/<SYM>.json without refetching anything."""
    path = DATA / f"{entry['symbol']}.json"
    if not path.exists():
        return
    j = json.loads(path.read_text(encoding="utf-8"))
    j["tag"] = entry["tag"]
    if entry.get("archivedOn"):
        j["archivedOn"] = entry["archivedOn"]
    else:
        j.pop("archivedOn", None)
    write_json(path, j)


def build_entry(entry):
    d = build(entry["symbol"], entry["tag"])
    if entry.get("archivedOn"):
        d["archivedOn"] = entry["archivedOn"]
    return d


def write_index(wl, touch=True, moves=None):
    """touch=False keeps the old "updated" time (editing the list doesn't refresh prices).
    moves: archived_moves() from a daily refresh; otherwise the last ones are carried over."""
    updated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        old = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
    except Exception:
        old = {}
    if not touch:
        updated = old.get("updated") or updated
    # keep the last price check unless the ticker was re-archived since (new base price)
    old_since = {t["symbol"]: t["sinceArchived"] for t in old.get("tickers", []) if t.get("sinceArchived")}
    old_on = {t["symbol"]: t.get("archivedOn") for t in old.get("tickers", [])}
    def since(t):
        if t["tag"] != "archived":
            return {}
        m = moves.get(t["symbol"]) if moves is not None else (old_since.get(t["symbol"]) if old_on.get(t["symbol"]) == t.get("archivedOn") else None)
        return {"sinceArchived": m} if m else {}
    names = {}
    for t in wl["tickers"]:
        p = DATA / f"{t['symbol']}.json"
        if p.exists():
            j = json.loads(p.read_text(encoding="utf-8"))
            names[t["symbol"]] = {"name": j.get("name"), "type": j.get("type")}
    write_json(DATA / "index.json", {
        "updated": updated,
        "tickers": [{"symbol": t["symbol"], "tag": t["tag"], **{k: t[k] for k in ARCH_KEYS if t.get(k) is not None},
                     **since(t), **names.get(t["symbol"], {})} for t in wl["tickers"]],
    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="refresh", choices=["refresh", "add", "remove", "tag", "edit"])
    ap.add_argument("--ticker", default="")
    ap.add_argument("--tag", default="researching")
    ap.add_argument("--order", default="", help='edit: "SYM:tag,SYM:tag,-SYM" in the new order; -SYM deletes')
    ap.add_argument("--request-id", default="")
    args = ap.parse_args()

    DATA.mkdir(exist_ok=True)
    wl = load_watchlist()
    symbol = args.ticker.strip().upper()
    tag = args.tag.strip().lower() if args.tag.strip().lower() in TAGS else "researching"

    def report(ok, message):
        write_json(DATA / "last_request.json", {
            "requestId": args.request_id, "action": args.action, "ticker": symbol,
            "ok": ok, "message": message,
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
        print(("OK: " if ok else "PROBLEM: ") + message)

    def refresh_from_archive(entries):
        failed = []
        for e in entries:
            print(f"-> {e['symbol']} (back from the archive)")
            try:
                write_json(DATA / f"{e['symbol']}.json", build_entry(e))
            except Exception as ex:
                print(f"   FAILED: {ex}")
                failed.append(e["symbol"])
        return failed

    if args.action == "edit":
        keep, drop = [], []
        for part in (x.strip() for x in args.order.split(",")):
            if part.startswith("-"):
                drop.append(part[1:].upper())
            elif part:
                sym, _, tg = part.partition(":")
                keep.append((sym.upper(), tg.lower()))
        if not (keep or drop) or not all(TICKER_RE.match(x) for x in [s for s, _ in keep] + drop) or any(tg not in TAGS for _, tg in keep):
            report(False, "That list of changes didn't look right.")
            return
        by = {t["symbol"]: t for t in wl["tickers"]}
        # The Edit list only offers delete on rows set to Archived, which may happen in this same
        # save, so the safeguard lives there; a ticker still active here was archived in the request.
        deleted = []
        for x in drop:
            if x in by:
                wl["tickers"].remove(by[x])
                (DATA / f"{x}.json").unlink(missing_ok=True)
                deleted.append(x)
        back = [by[x] for x, tg in keep if x in by and set_tag(by[x], tg)]
        pos = {x: n for n, (x, _) in enumerate(keep)}
        # anything not in the request (say, added meanwhile) keeps its relative place at the end
        wl["tickers"].sort(key=lambda t: pos.get(t["symbol"], len(pos)))
        save_watchlist(wl)
        for t in wl["tickers"]:
            sync_data_file(t)
        failed = refresh_from_archive(back)
        write_index(wl, touch=False)
        msg = ["Saved your list."]
        if deleted:
            msg.append(f"Deleted {', '.join(deleted)}.")
        if back and len(failed) < len(back):
            msg.append(f"Refreshed {', '.join(e['symbol'] for e in back if e['symbol'] not in failed)}.")
        if failed:
            msg.append(f"Couldn't refresh {', '.join(failed)} yet (Yahoo may be busy). It catches up on the next daily update.")
        report(True, " ".join(msg))
        return

    if args.action != "refresh":
        if not TICKER_RE.match(symbol):
            report(False, f"'{args.ticker}' doesn't look like a ticker symbol.")
            return
        existing = next((t for t in wl["tickers"] if t["symbol"] == symbol), None)
        if args.action == "remove":
            wl["tickers"] = [t for t in wl["tickers"] if t["symbol"] != symbol]
            save_watchlist(wl)
            (DATA / f"{symbol}.json").unlink(missing_ok=True)
            write_index(wl)
            report(True, f"Removed {symbol} from the watchlist.")
            return
        if args.action == "tag":
            if not existing:
                report(False, f"{symbol} isn't on the watchlist.")
                return
            back = set_tag(existing, tag)
            save_watchlist(wl)
            sync_data_file(existing)
            failed = refresh_from_archive([existing] if back else [])
            write_index(wl, touch=False)
            report(True, f"{symbol} is now {'archived' if tag == 'archived' else f'tagged {tag}'}."
                   + (" Couldn't refresh it yet; it catches up on the next daily update." if failed else ""))
            return
        # add: fetch first so a typo never lands on the watchlist
        print(f"-> {symbol} (new)")
        entry = existing or {"symbol": symbol, "tag": tag}
        try:
            d = build_entry(entry)
        except Exception as e:
            report(False, f"Couldn't load {symbol}: {e}")
            return
        write_json(DATA / f"{symbol}.json", d)
        if d.get("type") != "ETF":
            quiet(lambda: update_logos({symbol: (d.get("profile") or {}).get("website")}))
        if not existing:
            wl["tickers"].append(entry)
            save_watchlist(wl)
        targets = [symbol]
    else:
        # archived tickers are paused: their files and snapshot history stay, but they aren't refetched
        targets = [t["symbol"] for t in wl["tickers"] if t["tag"] != "archived"]

    by = {t["symbol"]: t for t in wl["tickers"]}
    failures = []
    for s in targets:
        if args.action == "add" and s == symbol:
            continue  # already built above
        print(f"-> {s}")
        try:
            write_json(DATA / f"{s}.json", build_entry(by[s]))
        except Exception as e:
            print(f"   FAILED: {e}")
            failures.append(s)

    print("-> benchmarks")
    try:
        prev = json.loads((DATA / "_bench.json").read_text(encoding="utf-8")).get("benches", {})
    except Exception:
        prev = {}
    benches = {}
    for sym, name in BENCHES.items():
        try:
            ph = price_history(yf.Ticker(sym))
            if not ph["close"]:
                raise LookupError("no prices")
            benches[sym] = {"symbol": sym, "name": name, **ph}
        except Exception as e:
            print(f"   {sym} FAILED: {e}")
            if sym in prev:
                benches[sym] = prev[sym]  # keep the last good copy
    if benches:
        write_json(DATA / "_bench.json", {"benches": benches})

    if args.action == "refresh":
        print("-> ideas")
        try:
            build_ideas(wl)
        except Exception as e:
            print(f"   FAILED: {e}")
        print("-> logos")
        try:
            update_logos(logo_sites(wl))
        except Exception as e:
            print(f"   FAILED: {e}")

    write_index(wl, moves=archived_moves(wl) if args.action == "refresh" else None)

    if args.action == "add":
        report(True, f"Added {symbol} to the watchlist.")
    if failures and len(failures) == len(targets):
        sys.exit("Every ticker failed to load. Yahoo may be rate-limiting; try again in a few minutes.")


if __name__ == "__main__":
    main()
