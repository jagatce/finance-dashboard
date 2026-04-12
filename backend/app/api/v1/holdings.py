"""
Holdings API routes.
All routes require auth via require_auth dependency.
Holdings island — zero coupling to accounts/balances/networth.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import require_auth
from app.models.models import Holding, PriceCache, HoldingsAnalysis
from app.services.holdings_import import parse_holdings
from app.services.price_service import get_prices
from app.services.analysis_service import refresh_analysis, get_latest_analysis

router = APIRouter(prefix="/api/v1/holdings", tags=["holdings"])


# ── Import ────────────────────────────────────────────────────────────────────

@router.post("/import")
def import_holdings(
    file: UploadFile = File(...),
    account_id: str = Form(...),
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    raw = file.file.read()
    try:
        records = parse_holdings(file.filename, raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Parse error: {e}")

    if not records:
        raise HTTPException(status_code=400, detail="No holdings parsed from file.")

    target_account = account_id.strip()
    if not target_account:
        raise HTTPException(status_code=422, detail="account_id is required. Tag this file with an account name.")

    db.query(Holding).filter(Holding.account_id == target_account).delete()

    inserted = 0
    for r in records:
        h = Holding(
            account_id           = target_account or r.get("account_id", "unknown"),
            broker               = r.get("broker"),
            ticker               = r.get("ticker") or r.get("name") or "UNKNOWN",
            name                 = r.get("name"),
            asset_type           = r.get("asset_type", "etf"),
            shares               = r.get("shares"),
            cost_basis_per_share = r.get("cost_basis_per_share"),
            total_cost_basis     = r.get("total_cost_basis"),
            yfinance_ticker      = r.get("yfinance_ticker"),
            last_price           = r.get("last_price"),
            current_value        = r.get("current_value"),
            as_of_date           = r.get("as_of_date"),
        )
        db.add(h)
        inserted += 1

    db.commit()

    tickers     = [r["yfinance_ticker"] for r in records if r.get("yfinance_ticker")]
    asset_types = {r["yfinance_ticker"]: r.get("asset_type", "etf") for r in records if r.get("yfinance_ticker")}
    if tickers:
        try:
            get_prices(tickers, db, asset_types=asset_types)
        except Exception:
            pass

    return {"imported": inserted, "account_id": target_account}


# ── List positions ─────────────────────────────────────────────────────────────

@router.get("/")
def list_holdings(
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    holdings  = db.query(Holding).all()
    tickers   = list({h.yfinance_ticker for h in holdings if h.yfinance_ticker})
    price_map = {}
    if tickers:
        rows = db.query(PriceCache).filter(PriceCache.ticker.in_(tickers)).all()
        price_map = {r.ticker: r for r in rows}

    result = []
    for h in holdings:
        pr    = price_map.get(h.yfinance_ticker) if h.yfinance_ticker else None
        price = pr.price if pr else None
        value = float(h.shares) * price if (h.shares and price) else None
        cost  = float(h.total_cost_basis) if h.total_cost_basis else (
                float(h.shares) * float(h.cost_basis_per_share)
                if (h.shares and h.cost_basis_per_share) else None)
        # fallback: use CSV last_price/current_value for nontickered funds
        display_price = price if price else (float(h.last_price) if h.last_price else None)
        display_value = value if value else (
            float(h.current_value) if h.current_value else
            (float(h.total_cost_basis) if h.total_cost_basis else None)
        )
        gain_pct = ((value - cost) / cost * 100) if (value and cost and cost > 0) else None

        result.append({
            "id":             h.id,
            "account_id":     h.account_id,
            "broker":         h.broker,
            "ticker":         h.ticker,
            "name":           pr.name if pr else h.name,
            "asset_type":     h.asset_type,
            "quantity":       float(h.shares) if h.shares else None,
            "price":          display_price,
            "value":          round(display_value, 2) if display_value else None,
            "cost_basis":     round(cost, 2) if cost else None,
            "gain_pct":       round(gain_pct, 2) if gain_pct else None,
            "day_change_pct": pr.day_change_pct if pr else None,
            "as_of_date":     h.as_of_date.isoformat() if h.as_of_date else None,
        })

    result.sort(key=lambda x: x.get("value") or 0, reverse=True)
    return result


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get("/summary")
def holdings_summary(
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    holdings  = db.query(Holding).all()
    tickers   = list({h.yfinance_ticker for h in holdings if h.yfinance_ticker})
    price_map = {}
    if tickers:
        rows = db.query(PriceCache).filter(PriceCache.ticker.in_(tickers)).all()
        price_map = {r.ticker: r for r in rows}

    total_value = 0.0
    total_cost  = 0.0
    by_type: dict[str, float] = {}

    for h in holdings:
        pr    = price_map.get(h.yfinance_ticker) if h.yfinance_ticker else None
        price = pr.price if pr else None
        value = float(h.shares) * price if (h.shares and price) else None
        cost  = float(h.total_cost_basis) if h.total_cost_basis else (
                float(h.shares) * float(h.cost_basis_per_share)
                if (h.shares and h.cost_basis_per_share) else None)
        display_value = value if value else (float(h.current_value) if h.current_value else None)
        if display_value:
            total_value += display_value
            at = h.asset_type or "other"
            by_type[at] = by_type.get(at, 0) + display_value
        if cost:
            total_cost += cost

    allocations = [
        {"label": k, "pct": round(v / total_value * 100, 2) if total_value else 0, "value": round(v, 2)}
        for k, v in sorted(by_type.items(), key=lambda x: -x[1])
    ]

    gain_pct = ((total_value - total_cost) / total_cost * 100) if total_cost > 0 else None

    return {
        "total_value":    round(total_value, 2),
        "total_cost":     round(total_cost, 2),
        "gain_pct":       round(gain_pct, 2) if gain_pct else None,
        "position_count": len(holdings),
        "allocations":    allocations,
    }


# ── Analysis ──────────────────────────────────────────────────────────────────

@router.get("/analysis")
def get_analysis(
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    analysis = get_latest_analysis(db)
    if not analysis:
        raise HTTPException(status_code=404, detail="No analysis yet. POST /analysis/refresh first.")
    row = db.query(HoldingsAnalysis).first()
    return {
        "analysis":     analysis,
        "refreshed_at": row.generated_at.isoformat() if row and row.generated_at else None,
    }


@router.post("/analysis/refresh")
def do_refresh_analysis(
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    try:
        result = refresh_analysis(db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return result


# ── Price refresh ─────────────────────────────────────────────────────────────

@router.get("/prices/refresh")
def refresh_prices(
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    holdings    = db.query(Holding).all()
    tickers     = list({h.yfinance_ticker for h in holdings if h.yfinance_ticker})
    asset_types = {h.yfinance_ticker: h.asset_type or "etf" for h in holdings if h.yfinance_ticker}

    if not tickers:
        return {"refreshed": 0}

    prices = get_prices(tickers, db, asset_types=asset_types, force_refresh=True)
    return {"refreshed": len([p for p in prices.values() if p.get("price")])}


# ── Delete by account ─────────────────────────────────────────────────────────

@router.delete("/account/{account_id}")
def delete_account_holdings(
    account_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_auth),
):
    """Delete all holdings for a specific account_id."""
    deleted = db.query(Holding).filter(Holding.account_id == account_id).delete()
    db.commit()
    return {"deleted": deleted, "account_id": account_id}
