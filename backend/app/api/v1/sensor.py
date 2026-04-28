"""
Claude Sensor API routes.
Per-ticker technical + fundamental + Claude analysis.
Watchlist management (Research tab).
Portfolio tickers come from holdings table (no separate storage).
"""
import re
import json
import math
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.core.database import get_db
from app.core.auth import require_auth
from app.models.models import Holding, Watchlist, TickerAnalysis, PriceCache
from app.services.sensor_service import analyze_ticker, get_ticker_analysis
from app.services.technicals_service import fetch_technicals

router = APIRouter(prefix="/api/v1/sensor", tags=["sensor"])

CUSIP_RE = re.compile(r'^[A-Z0-9]{9}$')
VALID_TICKER_RE = re.compile(r'^[A-Z]{1,5}(-[A-Z]{1,2})?$|^[A-Z]{5}X$')

def clean(v):
    """Return None if v is NaN or Infinity, otherwise return v."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def is_valid_ticker(t: str) -> bool:
    if not t:
        return False
    if ' ' in t:
        return False
    if CUSIP_RE.match(t):
        return False
    if len(t) > 6:
        return False
    return bool(VALID_TICKER_RE.match(t))

def get_all_valid_tickers(db: Session) -> list[str]:
    """All valid tickers from holdings + watchlist, deduplicated."""
    tickers: set[str] = set()
    for h in db.query(Holding).all():
        t = h.yfinance_ticker
        if t and is_valid_ticker(t):
            tickers.add(t)
    for w in db.query(Watchlist).all():
        if is_valid_ticker(w.ticker):
            tickers.add(w.ticker)
    return sorted(tickers)


# ── Watchlist (Research tab) ──────────────────────────────────────────────────

class WatchlistAdd(BaseModel):
    ticker: str
    notes: str = ""


@router.get("/watchlist")
def list_watchlist(
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    rows = db.query(Watchlist).order_by(Watchlist.added_at).all()
    return [{"ticker": r.ticker, "notes": r.notes, "added_at": r.added_at} for r in rows]


@router.post("/watchlist")
def add_to_watchlist(
    body: WatchlistAdd,
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    ticker = body.ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker is required")
    if not is_valid_ticker(ticker):
        raise HTTPException(status_code=400, detail=f"{ticker} is not a valid ticker symbol")
    existing = db.query(Watchlist).filter(Watchlist.ticker == ticker).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"{ticker} already in watchlist")
    db.add(Watchlist(ticker=ticker, notes=body.notes))
    db.commit()
    return {"ticker": ticker, "added": True}


@router.delete("/watchlist/{ticker}")
def remove_from_watchlist(
    ticker: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    ticker = ticker.upper()
    deleted = db.query(Watchlist).filter(Watchlist.ticker == ticker).delete()
    db.commit()
    return {"ticker": ticker, "deleted": deleted > 0}


# ── Portfolio tickers (from holdings) ────────────────────────────────────────

@router.get("/portfolio/tickers")
def portfolio_tickers(
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    """Return unique yfinance-lookupable tickers from holdings, with account tags."""
    holdings = db.query(Holding).all()
    seen: dict[str, list[str]] = {}
    for h in holdings:
        t = h.yfinance_ticker
        if not t or not is_valid_ticker(t):
            continue
        if t not in seen:
            seen[t] = []
        if h.account_id not in seen[t]:
            seen[t].append(h.account_id)
    return [{"ticker": t, "accounts": accs} for t, accs in sorted(seen.items())]


# ── Per-ticker data ───────────────────────────────────────────────────────────

@router.get("/tickers")
def list_all_sensor_tickers(
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    """
    Return all tickers with stored analysis + price cache data.
    Price comes from price_cache (live) with technicals_json as fallback.
    """
    rows = db.query(TickerAnalysis).all()
    price_map = {}
    if rows:
        tickers = [r.ticker for r in rows]
        prices  = db.query(PriceCache).filter(PriceCache.ticker.in_(tickers)).all()
        price_map = {p.ticker: p for p in prices}

    result = []
    for r in rows:
        pr   = price_map.get(r.ticker)
        tech = json.loads(r.technicals_json) if r.technicals_json else {}
        result.append({
            "ticker":       r.ticker,
            "signal":       r.signal,
            "health_score": r.health_score,
            "price":        clean((pr.price if pr else None) or tech.get("price")),
            "ema200":       clean(tech.get("ema200")),
            "delta_ema":    clean(tech.get("delta_ema")),
            "rsi":          clean(tech.get("rsi")),
            "rsi_label":    tech.get("rsi_label"),
            "macd_label":   tech.get("macd_label"),
            "name":         tech.get("fundamentals", {}).get("name") or (pr.name if pr else r.ticker),
            "refreshed_at": r.refreshed_at.isoformat() if r.refreshed_at else None,
        })

    return result


@router.get("/{ticker}")
def get_ticker(
    ticker: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    """Return stored analysis for a ticker. 404 if not yet analyzed."""
    ticker = ticker.upper()
    data   = get_ticker_analysis(ticker, db)
    if not data:
        raise HTTPException(status_code=404, detail=f"No analysis for {ticker}. POST /{ticker}/refresh first.")
    return data


# ── /refresh/all MUST be above /{ticker}/refresh ─────────────────────────────

@router.post("/refresh/all")
def refresh_all(
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    """Analyze every valid ticker from holdings + watchlist."""
    tickers = get_all_valid_tickers(db)
    results = {"refreshed": [], "failed": [], "total": len(tickers)}
    for t in tickers:
        try:
            analyze_ticker(t, db)
            results["refreshed"].append(t)
        except Exception as e:
            results["failed"].append({"ticker": t, "error": str(e)})
    return results


@router.post("/{ticker}/refresh")
def refresh_ticker(
    ticker: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    """Trigger fresh technicals fetch + Claude analysis for a ticker."""
    ticker = ticker.upper()
    if not is_valid_ticker(ticker):
        raise HTTPException(status_code=400, detail=f"{ticker} is not a valid ticker symbol")
    try:
        result = analyze_ticker(ticker, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return result
