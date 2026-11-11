"""Fetch market data for every ticker on the watchlist and write JSON for the site.

Usage:
  python scripts/fetch.py                          # refresh everything on the watchlist
  python scripts/fetch.py --action add --ticker NVDA --tag researching
  python scripts/fetch.py --action remove --ticker NVDA
  python scripts/fetch.py --action tag --ticker NVDA --tag owned

Writes:
  data/<SYMBOL>.json   one file per ticker (all tabs read from this)
  data/_bench.json     S&P 500 price history, for "vs the market" comparisons
  data/index.json      list of tickers + tags + last update time
  data/last_request.json  outcome of the most recent add/remove/tag request
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
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WATCHLIST = ROOT / "watchlist.json"
TAGS = {"owned", "watching", "researching"}
TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-=^]{0,14}$")
HISTORY_KEEP = 1500  # daily snapshots kept per ticker (~6 years of trading days)
PEER_MAX = 8  # industry peers used for the "priced like its peers" valuation
HOLDINGS_MAX = 15
# S&P 500 funds hold the same index, so SPY's free daily holdings file gives the top 15
# for VOO/IVV/SPLG too (Yahoo only returns the top 10).
SPY_HOLDINGS = "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx"
SP500_RE = re.compile(r"S&P\s*500", re.I)
NOT_PLAIN_SP500 = re.compile(r"equal|growth|value|dividend|volatil|momentum|quality|leverag|2x|3x|inverse|short|bear|bull|ESG|buffer|option|covered", re.I)


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


def peer_info(sym: str):
    if sym not in _peer_cache:
        i = quiet(lambda: yf.Ticker(sym).info, {}) or {}
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
    sents = list(dict.fromkeys(sentences("".join(parser.out))))
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

    # carry forward our own daily snapshot history (Yahoo doesn't keep this for us)
    old = DATA / f"{symbol}.json"
    hist, old_d = [], {}
    if old.exists():
        try:
            old_d = json.loads(old.read_text(encoding="utf-8"))
            hist = old_d.get("history", [])
        except Exception:
            hist = []
    if kind == "EQUITY":
        # the press release changes once a quarter, so keep the last good copy if the SEC is unreachable
        d["filing"] = quiet(lambda: sec_earnings_release(symbol), None) or old_d.get("filing")
    snap = snapshot(d)
    hist = [h for h in hist if h.get("date") != snap["date"]] + [snap]
    d["history"] = hist[-HISTORY_KEEP:]
    return d


# ---------------------------------------------------------------- main

def write_json(path: Path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def load_watchlist():
    return json.loads(WATCHLIST.read_text(encoding="utf-8"))


def save_watchlist(wl):
    WATCHLIST.write_text(json.dumps(wl, indent=2) + "\n", encoding="utf-8")


def write_index(wl):
    names = {}
    for t in wl["tickers"]:
        p = DATA / f"{t['symbol']}.json"
        if p.exists():
            j = json.loads(p.read_text(encoding="utf-8"))
            names[t["symbol"]] = {"name": j.get("name"), "type": j.get("type")}
    write_json(DATA / "index.json", {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tickers": [{"symbol": t["symbol"], "tag": t["tag"], **names.get(t["symbol"], {})} for t in wl["tickers"]],
    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="refresh", choices=["refresh", "add", "remove", "tag"])
    ap.add_argument("--ticker", default="")
    ap.add_argument("--tag", default="researching")
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
            existing["tag"] = tag
            save_watchlist(wl)
            p = DATA / f"{symbol}.json"
            if p.exists():
                j = json.loads(p.read_text(encoding="utf-8")); j["tag"] = tag; write_json(p, j)
            write_index(wl)
            report(True, f"{symbol} is now tagged '{tag}'.")
            return
        # add: fetch first so a typo never lands on the watchlist
        print(f"-> {symbol} (new)")
        try:
            d = build(symbol, existing["tag"] if existing else tag)
        except Exception as e:
            report(False, f"Couldn't load {symbol}: {e}")
            return
        write_json(DATA / f"{symbol}.json", d)
        if not existing:
            wl["tickers"].append({"symbol": symbol, "tag": tag})
            save_watchlist(wl)
        targets = [symbol]
    else:
        targets = [t["symbol"] for t in wl["tickers"]]

    tags = {t["symbol"]: t["tag"] for t in wl["tickers"]}
    failures = []
    for s in targets:
        if args.action == "add" and s == symbol:
            continue  # already built above
        print(f"-> {s}")
        try:
            write_json(DATA / f"{s}.json", build(s, tags[s]))
        except Exception as e:
            print(f"   FAILED: {e}")
            failures.append(s)

    print("-> S&P 500 benchmark")
    try:
        write_json(DATA / "_bench.json", {"symbol": "^GSPC", "name": "S&P 500", **price_history(yf.Ticker("^GSPC"))})
    except Exception as e:
        print(f"   FAILED: {e}")

    write_index(wl)

    if args.action == "add":
        report(True, f"Added {symbol} to the watchlist.")
    if failures and len(failures) == len(targets):
        sys.exit("Every ticker failed to load. Yahoo may be rate-limiting; try again in a few minutes.")


if __name__ == "__main__":
    main()
