"""
Holdings review service — 1-year performance vs SPY + 200 EMA analysis.
"""
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Dict, Any


# Auto-assign proxy ETF from fund name keywords
PROXY_RULES = [
    (["large cap", "equity index", "s&p 500", "s&p500", "500 index", "lrg cp", "inst 500", "vang inst 500", "vang 500"], "SPY"),
    (["small cap", "small/mid", "smid", "sm mid", "midcap", "mid cap", "sm midcap", "ext mkt", "extended market", "vg is ext"], "VXF"),
    (["international", "intl", "foreign", "global", "world", "emerging", "intl div"], "VXUS"),
    (["bond", "fixed income", "income fund", "blended sv", "putn/met"], "AGG"),
    (["puritan", "balanced", "blended"], "VBIAX"),
    (["contra", "contrafund", "contra pool"], "SPY"),  # Fidelity Contrafund is large cap growth
    (["growth"], "VUG"),
    (["value"], "VTV"),
    (["real estate", "reit"], "VNQ"),
    (["target", "pmp", "retire", "lifecycle", "trp retire", "vanguard target"], "VTHRX"),
]

def auto_proxy(name: str) -> str | None:
    """Auto-assign proxy ETF from fund name keywords."""
    n = name.lower()
    for keywords, proxy in PROXY_RULES:
        if any(kw in n for kw in keywords):
            return proxy
    return None


def get_spy_return_1y() -> float | None:
    """Fetch SPY 1-year return."""
    try:
        spy = yf.Ticker("SPY")
        hist = spy.history(period="1y")
        if hist.empty or len(hist) < 2:
            return None
        start = float(hist["Close"].iloc[0])
        end   = float(hist["Close"].iloc[-1])
        return round((end - start) / start * 100, 2)
    except Exception:
        return None


def get_ticker_data(ticker: str) -> Dict[str, Any]:
    """Fetch 1-year return + 200 EMA for a single ticker."""
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="1y", auto_adjust=False)
        if hist.empty or len(hist) < 2:
            return {"error": "no_data"}

        # Use raw Close (unadjusted) to avoid nan from dividend adjustments
        closes = hist["Close"]
        import math
        # Filter out nan values
        valid = closes.dropna()
        if len(valid) < 2:
            return {"error": "insufficient_data"}
        start  = float(valid.iloc[0])
        end    = float(valid.iloc[-1])
        if math.isnan(start) or math.isnan(end) or start == 0:
            return {"error": "invalid_prices"}
        return_1y = round((end - start) / start * 100, 2)

        # 200 EMA
        ema200 = None
        above_ema200 = None
        if len(closes) >= 50:  # need enough data
            ema200 = float(closes.ewm(span=200, adjust=False).mean().iloc[-1])
            above_ema200 = end > ema200

        import math
        def safe(v):
            if v is None: return None
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)): return None
            return v
        return {
            "return_1y":    safe(return_1y),
            "ema200":       safe(round(ema200, 2)) if ema200 else None,
            "above_ema200": above_ema200,
            "current_price": safe(round(end, 2)),
            "error": None,
        }
    except Exception as e:
        return {"error": str(e)}


def compute_status(return_1y: float, spy_return: float, above_ema200: bool | None) -> dict:
    """Compute review status and recommendation."""
    vs_spy = round(return_1y - spy_return, 2)

    # Watch takes priority — below 200 EMA is a technical warning
    sign = "+" if vs_spy >= 0 else ""
    if above_ema200 is False:
        status = "Watch"
        recommendation = f"{sign}{vs_spy:.1f}% vs SPY · Below 200 EMA"
    elif vs_spy > 5:
        status = "Outperform"
        recommendation = f"+{vs_spy:.1f}% vs SPY"
    elif vs_spy >= -5:
        status = "In-line"
        recommendation = f"{sign}{vs_spy:.1f}% vs SPY"
    else:
        status = "Underperform"
        recommendation = f"{vs_spy:.1f}% vs SPY"

    return {
        "status":         status,
        "vs_spy":         vs_spy,
        "recommendation": recommendation,
    }


def review_holdings(tickers: List[str]) -> Dict[str, Any]:
    """
    Main entry point. Returns review data for all tickers.
    tickers: list of yfinance tickers (skip None/fund_nontickered)
    """
    # Fetch SPY first
    spy_return = get_spy_return_1y()

    results = {}
    for ticker in set(tickers):
        if not ticker:
            continue
        data = get_ticker_data(ticker)
        if data.get("error") or data.get("return_1y") is None:
            results[ticker] = {"status": "N/A", "error": data.get("error")}
            continue

        if spy_return is not None:
            status_data = compute_status(data["return_1y"], spy_return, data.get("above_ema200"))
        else:
            status_data = {"status": "N/A", "vs_spy": None, "recommendation": "SPY data unavailable"}

        results[ticker] = {**data, **status_data, "spy_return_1y": spy_return}

    return results
