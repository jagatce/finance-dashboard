"""
Technicals service — computes RSI, MACD, Bollinger Bands, EMA200, ATH
from yfinance OHLCV data. No external dependencies beyond yfinance + pandas.
"""
import json
import yfinance as yf
import pandas as pd
from datetime import datetime, timezone


def fetch_technicals(ticker: str) -> dict:
    """
    Fetch OHLCV history and compute technicals for a ticker.
    Returns a dict ready to store in ticker_analysis.technicals_json.
    """
    try:
        t    = yf.Ticker(ticker)
        hist = t.history(period="2y", auto_adjust=True)
        info = t.info
    except Exception as e:
        return {"error": str(e)}

    if hist.empty or len(hist) < 50:
        return {"error": f"Insufficient history for {ticker}"}

    close = hist["Close"]

    # ── EMA 200 ───────────────────────────────────────────────────────────────
    ema200     = float(close.ewm(span=200, adjust=False).mean().iloc[-1])
    current    = float(close.iloc[-1])
    delta_ema  = round((current - ema200) / ema200 * 100, 2)

    # ── ATH ───────────────────────────────────────────────────────────────────
    ath             = float(close.max())
    delta_ath       = round((current - ath) / ath * 100, 2)

    # ── RSI (14) ──────────────────────────────────────────────────────────────
    delta_close = close.diff()
    gain  = delta_close.clip(lower=0)
    loss  = -delta_close.clip(upper=0)
    avg_gain = gain.ewm(com=13, adjust=False).mean()
    avg_loss = loss.ewm(com=13, adjust=False).mean()
    rs  = avg_gain / avg_loss.replace(0, float("nan"))
    rsi_raw = float((100 - (100 / (1 + rs))).iloc[-1])
    rsi = rsi_raw if not (rsi_raw != rsi_raw) else 50.0  # NaN check; default to neutral 50

    def rsi_label(r: float) -> str:
        if r >= 70: return "overbought"
        if r <= 30: return "oversold"
        return "neutral"

    # ── MACD (12/26/9) ────────────────────────────────────────────────────────
    ema12      = close.ewm(span=12, adjust=False).mean()
    ema26      = close.ewm(span=26, adjust=False).mean()
    macd_line  = ema12 - ema26
    signal_line= macd_line.ewm(span=9, adjust=False).mean()
    histogram  = macd_line - signal_line
    macd_val   = float(macd_line.iloc[-1])
    signal_val = float(signal_line.iloc[-1])
    hist_val   = float(histogram.iloc[-1])

    def macd_label(h: float) -> str:
        if h > 0: return "bullish"
        if h < 0: return "bearish"
        return "neutral"

    # ── Bollinger Bands (20, 2σ) ──────────────────────────────────────────────
    sma20  = close.rolling(20).mean()
    std20  = close.rolling(20).std()
    bb_upper = float((sma20 + 2 * std20).iloc[-1])
    bb_mid   = float(sma20.iloc[-1])
    bb_lower = float((sma20 - 2 * std20).iloc[-1])
    bb_width = round((bb_upper - bb_lower) / bb_mid * 100, 2)

    def bb_position(price: float, upper: float, mid: float, lower: float) -> str:
        if price >= upper: return "above upper band"
        if price >= mid:   return "above midband"
        if price >= lower: return "below midband"
        return "below lower band"

    # ── Fundamentals from yfinance info ───────────────────────────────────────
    fundamentals = {
        "name":            info.get("longName") or info.get("shortName"),
        "sector":          info.get("sector") or info.get("fundFamily"),
        "market_cap":      info.get("marketCap"),
        "pe_ratio":        info.get("trailingPE"),
        "forward_pe":      info.get("forwardPE"),
        "dividend_yield":  info.get("dividendYield"),
        "revenue_growth":  info.get("revenueGrowth"),
        "week_52_high":    info.get("fiftyTwoWeekHigh"),
        "week_52_low":     info.get("fiftyTwoWeekLow"),
        "currency":        info.get("currency", "USD"),
        "quote_type":      info.get("quoteType"),
    }

    return {
        "ticker":    ticker,
        "price":     round(current, 2),
        "ema200":    round(ema200, 2),
        "delta_ema": delta_ema,          # % above/below EMA200
        "ath":       round(ath, 2),
        "delta_ath": delta_ath,          # % below ATH (negative)
        "rsi":       round(rsi, 2),
        "rsi_label": rsi_label(rsi),
        "macd":      round(macd_val, 4),
        "macd_signal": round(signal_val, 4),
        "macd_hist": round(hist_val, 4),
        "macd_label": macd_label(hist_val),
        "bb_upper":  round(bb_upper, 2),
        "bb_mid":    round(bb_mid, 2),
        "bb_lower":  round(bb_lower, 2),
        "bb_width":  bb_width,
        "bb_position": bb_position(current, bb_upper, bb_mid, bb_lower),
        "fundamentals": fundamentals,
        "computed_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
    }
