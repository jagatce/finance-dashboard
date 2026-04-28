"""
Price enrichment service using yfinance.
- Checks price_cache first (TTL = 24h)
- Batch fetches stale/missing tickers
- Skips fund_nontickered and fund_cusip asset types
- Skips non-ticker strings (fund display names, CUSIPs, proxy labels)
- Returns dict of ticker -> price data
"""
import re
import math
import yfinance as yf
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from app.models.models import PriceCache

TTL_HOURS = 24

SKIP_ASSET_TYPES = {"fund_nontickered", "fund_cusip"}

CUSIP_RE       = re.compile(r'^[A-Z0-9]{9}$')
VALID_TICKER_RE = re.compile(r'^[A-Z]{1,5}(-[A-Z]{1,2})?$|^[A-Z]{5}X$')

def is_valid_ticker(t: str) -> bool:
    if not t or ' ' in t:
        return False
    if CUSIP_RE.match(t):
        return False
    if len(t) > 6:
        return False
    return bool(VALID_TICKER_RE.match(t))


def _is_stale(updated_at: datetime | None) -> bool:
    if updated_at is None:
        return True
    now = datetime.now(timezone.utc)
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    return (now - updated_at) > timedelta(hours=TTL_HOURS)


def get_prices(tickers: list[str], db: Session,
               asset_types: dict[str, str] | None = None,
               force_refresh: bool = False) -> dict[str, dict]:
    """
    Return price data for a list of tickers.
    asset_types: optional dict of ticker -> asset_type to skip non-lookupable funds.
    Returns: { ticker: { price, prev_close, day_change_pct, sector, asset_type, name } }
    """
    if not tickers:
        return {}

    # Filter out non-lookupable tickers
    lookupable = []
    for t in tickers:
        at = (asset_types or {}).get(t, "etf")
        if at in SKIP_ASSET_TYPES:
            continue
        if not is_valid_ticker(t):
            continue
        lookupable.append(t)

    if not lookupable:
        return {}

    # Check cache
    stale  = []
    cached = {}

    existing   = db.query(PriceCache).filter(PriceCache.ticker.in_(lookupable)).all()
    cached_map = {p.ticker: p for p in existing}

    for ticker in lookupable:
        entry = cached_map.get(ticker)
        if force_refresh or not entry or _is_stale(entry.updated_at):
            stale.append(ticker)
        else:
            cached[ticker] = _to_dict(entry)

    # Batch fetch stale tickers
    if stale:
        fetched = _fetch_yfinance(stale)
        for ticker, data in fetched.items():
            _upsert_cache(db, ticker, data)
            cached[ticker] = data
        db.commit()

    return cached


def _fetch_yfinance(tickers: list[str]) -> dict[str, dict]:
    """Batch fetch from yfinance. Returns dict of ticker -> data."""
    results = {}
    if not tickers:
        return results

    try:
        data = yf.download(
            tickers,
            period="2d",
            auto_adjust=True,
            progress=False,
            threads=False,  # threads=True can crash uvicorn on macOS
        )

        for ticker in tickers:
            try:
                info       = yf.Ticker(ticker).info
                price_data = _extract_price(data, ticker, len(tickers) > 1)
                results[ticker] = {
                    "price":          price_data.get("price"),
                    "prev_close":     price_data.get("prev_close"),
                    "day_change_pct": price_data.get("day_change_pct"),
                    "sector":         info.get("sector") or info.get("fundFamily"),
                    "asset_type":     _classify(info),
                    "name":           info.get("longName") or info.get("shortName"),
                    "currency":       info.get("currency", "USD"),
                }
            except Exception:
                results[ticker] = {
                    "price": None, "prev_close": None,
                    "day_change_pct": None, "sector": None,
                    "asset_type": "unknown", "name": ticker, "currency": "USD",
                }
    except Exception:
        pass

    return results


def _extract_price(data, ticker: str, multi: bool) -> dict:
    """Extract current and previous close from yfinance download data."""
    try:
        if multi:
            close = data["Close"][ticker].dropna()
        else:
            close = data["Close"].dropna()

        if len(close) >= 2:
            price      = float(close.iloc[-1])
            prev_close = float(close.iloc[-2])
            # Guard against NaN
            if math.isnan(price):
                return {"price": None, "prev_close": None, "day_change_pct": None}
            change_pct = ((price - prev_close) / prev_close * 100) if prev_close and not math.isnan(prev_close) else None
            return {"price": price, "prev_close": prev_close, "day_change_pct": change_pct}
        elif len(close) == 1:
            price = float(close.iloc[-1])
            if math.isnan(price):
                return {"price": None, "prev_close": None, "day_change_pct": None}
            return {"price": price, "prev_close": None, "day_change_pct": None}
    except Exception:
        pass
    return {"price": None, "prev_close": None, "day_change_pct": None}


def _classify(info: dict) -> str:
    """Classify asset type from yfinance info dict."""
    qt = (info.get("quoteType") or "").upper()
    if qt == "ETF":        return "etf"
    if qt == "MUTUALFUND": return "fund"
    if qt == "EQUITY":     return "stock"
    if qt == "CRYPTOCURRENCY": return "crypto"
    if qt == "FUTURE":     return "futures"
    return "other"


def _upsert_cache(db: Session, ticker: str, data: dict):
    entry = db.query(PriceCache).filter(PriceCache.ticker == ticker).first()
    now   = datetime.now(timezone.utc).replace(tzinfo=None)
    if entry:
        entry.price          = data.get("price")
        entry.prev_close     = data.get("prev_close")
        entry.day_change_pct = data.get("day_change_pct")
        entry.sector         = data.get("sector")
        entry.asset_type     = data.get("asset_type")
        entry.name           = data.get("name")
        entry.currency       = data.get("currency", "USD")
        entry.updated_at     = now
    else:
        db.add(PriceCache(
            ticker         = ticker,
            name           = data.get("name"),
            price          = data.get("price"),
            prev_close     = data.get("prev_close"),
            day_change_pct = data.get("day_change_pct"),
            sector         = data.get("sector"),
            asset_type     = data.get("asset_type"),
            currency       = data.get("currency", "USD"),
            updated_at     = now,
        ))


def _to_dict(entry: PriceCache) -> dict:
    return {
        "price":          entry.price,
        "prev_close":     entry.prev_close,
        "day_change_pct": entry.day_change_pct,
        "sector":         entry.sector,
        "asset_type":     entry.asset_type,
        "name":           entry.name,
        "currency":       entry.currency,
    }
