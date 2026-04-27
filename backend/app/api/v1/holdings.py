"""
Holdings API routes.
All routes require auth via require_auth dependency.
Holdings island — zero coupling to accounts/balances/networth.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import require_auth
from app.models.models import Holding, PriceCache, HoldingsAnalysis, Account
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
    # Build account_id -> account_name lookup
    accounts     = db.query(Account).all()
    account_names = {a.id: a.name for a in accounts}
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
            "account_name":   account_names.get(h.account_id, h.account_id),
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
    # Build account_id -> account_name lookup
    accounts     = db.query(Account).all()
    account_names = {a.id: a.name for a in accounts}
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


@router.get("/tax-efficiency")
def get_tax_efficiency(db: Session = Depends(get_db), _: str = Depends(require_auth)):
    """Compute tax efficiency score and recommendations based on holdings."""
    import json
    from sqlalchemy import text

    # account_id -> name lookup
    account_names = {a.id: a.name for a in db.query(Account).all()}

    # Load account type mapping from user_settings
    mapping_row = db.execute(text(
        "SELECT value FROM user_settings WHERE key = 'holdings_account_types'"
    )).fetchone()
    account_types = json.loads(mapping_row.value) if mapping_row else {}

    # Get all holdings with values
    rows = db.execute(text("""
        SELECT account_id, ticker, name, asset_type, current_value, yfinance_ticker
        FROM holdings WHERE current_value > 0
        ORDER BY account_id, current_value DESC
    """)).fetchall()

    if not rows:
        return {"score": None, "grade": None, "positions": [], "recommendations": [],
                "matrix": [], "account_types": account_types, "error": "No holdings data"}

    # Asset type tax efficiency classification
    def classify_tax_efficiency(asset_type: str, ticker: str, name: str) -> dict:
        t = (asset_type or "").lower()
        n = (name or "").upper()
        tk = (ticker or "").upper()

        # Bonds
        TAX_ADVANTAGED = ["traditional_401k", "roth", "hsa"]
        if "bond" in n or "fixed" in n or "income" in n or tk in ("BND","AGG","TLT","IEF","SHY","VCIT","VCSH"):
            return {"tax_type": "high", "label": "Bond/Fixed Income", "best_location": TAX_ADVANTAGED}
        # YieldMax / covered call / high-income ETFs — must be in tax-advantaged
        if "yieldmax" in n or "covered call" in n or "0dte" in n or "dividend" in n or tk in ("NVDY","MSTY","NFLY","YMAG","YMAX","ULTY","PLTY","YBTC","YBIT","QDTE","XDTE","SCHD","DVY","VYM","JEPI","JEPQ"):
            return {"tax_type": "high", "label": "High-Income ETF", "best_location": TAX_ADVANTAGED}
        # Target date funds
        if "target" in n or "pmp" in n or "retire" in n:
            return {"tax_type": "high", "label": "Target Date Fund", "best_location": TAX_ADVANTAGED}
        import re
        if re.search("20[3-9][0-9]", n):
            return {"tax_type": "high", "label": "Target Date Fund", "best_location": TAX_ADVANTAGED}
        # International (foreign tax credit benefit in taxable)
        if "intl" in n or "international" in n or "foreign" in n or "emerging" in n:
            return {"tax_type": "medium", "label": "International", "best_location": ["taxable"]}
        # Broad index ETF (tax efficient)
        if "index" in n or "s&p" in n or "total" in n or tk in ("VTI","VOO","FXAIX","SWTSX","ITOT"):
            return {"tax_type": "low", "label": "Index Fund/ETF", "best_location": ["taxable", "traditional_401k", "roth"]}
        # Growth ETF/Stock — fine in any tax-advantaged or taxable
        if t == "etf" or t == "stock":
            return {"tax_type": "low", "label": "ETF/Stock", "best_location": ["roth", "taxable", "traditional_401k", "hsa"]}
        # Non-tickered / CUSIP funds — typically in employer plans, fine in tax-advantaged
        if t in ("fund_nontickered", "fund_cusip"):
            return {"tax_type": "medium", "label": "Mutual Fund", "best_location": ["traditional_401k", "roth", "hsa"]}

        return {"tax_type": "low", "label": "Other", "best_location": ["taxable", "traditional_401k", "roth", "hsa"]}

    # Score each position
    total_value = sum(float(r.current_value) for r in rows)
    score_deductions = 0
    positions = []
    recommendations = []

    for r in rows:
        acct_type = account_types.get(r.account_id, "unknown")
        tax_info  = classify_tax_efficiency(r.asset_type, r.ticker, r.name)
        value     = float(r.current_value)
        pct       = round(value / total_value * 100, 1) if total_value > 0 else 0

        # Is this asset misplaced?
        misplaced = acct_type not in tax_info["best_location"] and acct_type != "unknown"
        severity  = 0
        if misplaced:
            if tax_info["tax_type"] == "high":
                severity = 3  # High tax drag in wrong account
            elif tax_info["tax_type"] == "medium":
                severity = 1
            score_deductions += severity * (pct / 100)

        positions.append({
            "account_id":   r.account_id,
            "account_name": account_names.get(r.account_id, r.account_id),
            "account_type": acct_type,
            "ticker":       r.ticker,
            "name":         r.name,
            "asset_type":   r.asset_type,
            "value":        value,
            "pct":          pct,
            "tax_type":     tax_info["tax_type"],
            "tax_label":    tax_info["label"],
            "best_location": tax_info["best_location"],
            "misplaced":    misplaced,
            "severity":     severity,
        })

        if misplaced and severity >= 2 and value > 5000:
            best = tax_info["best_location"][0].replace("_", " ").title()
            recommendations.append({
                "ticker":      r.ticker,
                "name":        r.name,
                "account_id":  r.account_id,
                "account_name": account_names.get(r.account_id, r.account_id),
                "account_type": acct_type,
                "value":       value,
                "action":      f"Move to {best} account",
                "reason":      f"{tax_info['label']} generates high taxable income — better in {best}",
                "severity":    severity,
            })

    # Final score
    raw_score = max(0, 100 - (score_deductions * 20))
    score = round(raw_score)
    grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D"

    # Matrix: account x tax_type
    accounts_seen = list(dict.fromkeys(p["account_id"] for p in positions))
    matrix = []
    for acct in accounts_seen:
        acct_positions = [p for p in positions if p["account_id"] == acct]
        acct_value = sum(p["value"] for p in acct_positions)
        matrix.append({
            "account_id":   acct,
            "account_name": account_names.get(acct, acct),
            "account_type": account_types.get(acct, "unknown"),
            "total_value":  round(acct_value, 2),
            "breakdown": {
                "high":   round(sum(p["value"] for p in acct_positions if p["tax_type"] == "high"), 2),
                "medium": round(sum(p["value"] for p in acct_positions if p["tax_type"] == "medium"), 2),
                "low":    round(sum(p["value"] for p in acct_positions if p["tax_type"] == "low"), 2),
            },
            "has_misplaced": any(p["misplaced"] for p in acct_positions),
        })

    recommendations.sort(key=lambda x: x["severity"] * x["value"], reverse=True)

    return {
        "score":          score,
        "grade":          grade,
        "total_value":    round(total_value, 2),
        "positions":      positions,
        "recommendations": recommendations[:10],
        "matrix":         matrix,
        "account_types":  account_types,
    }


@router.post("/tax-efficiency/mapping")
def save_account_type_mapping(body: dict, db: Session = Depends(get_db), _: str = Depends(require_auth)):
    """Save account type mapping to user_settings."""
    import json
    from sqlalchemy import text
    value = json.dumps(body.get("mapping", {}))
    db.execute(text("""
        INSERT INTO user_settings (key, value, updated_at)
        VALUES ('holdings_account_types', :value, :updated_at)
        ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :updated_at
    """), {"value": value, "updated_at": datetime.utcnow().isoformat()})
    db.commit()
    return {"status": "saved"}


@router.get("/review")
def get_holdings_review(refresh: bool = False, db: Session = Depends(get_db), _: str = Depends(require_auth)):
    """Get holdings review. Returns cached result unless refresh=true."""
    from app.services.holdings_review import review_holdings
    from sqlalchemy import text
    import json

    # account_id -> name lookup
    account_names = {a.id: a.name for a in db.query(Account).all()}

    # Return cached result if available and not forcing refresh
    if not refresh:
        cached = db.execute(text("SELECT result_json, generated_at FROM holdings_review_cache WHERE id = 'latest'")).fetchone()
        if cached:
            result = json.loads(cached.result_json)
            result["cached_at"] = cached.generated_at
            return result

    rows = db.execute(text("""
        SELECT DISTINCT ticker, name, account_id, asset_type,
            yfinance_ticker, current_value, last_price
        FROM holdings WHERE current_value > 0
        ORDER BY current_value DESC
    """)).fetchall()

    if not rows:
        return {"spy_return_1y": None, "positions": [], "summary": {}}

    NON_TICKERED_TYPES = ("fund_nontickered", "fund_cusip")
    tickered     = [r for r in rows if r.asset_type not in NON_TICKERED_TYPES and r.yfinance_ticker]
    non_tickered = [r for r in rows if r.asset_type in NON_TICKERED_TYPES or not r.yfinance_ticker]

    tickers = list(set(r.yfinance_ticker for r in tickered if r.yfinance_ticker))
    review_data = review_holdings(tickers) if tickers else {}

    order = {"Watch": 0, "Underperform": 1, "In-line": 2, "Outperform": 3, "N/A": 4}
    positions = []

    for r in tickered:
        tk = r.yfinance_ticker
        rd = review_data.get(tk, {})
        positions.append({
            "ticker": r.ticker, "yf_ticker": tk, "name": r.name,
            "account_id": r.account_id, "account_name": account_names.get(r.account_id, r.account_id), "asset_type": r.asset_type,
            "current_value": float(r.current_value or 0),
            "last_price": float(r.last_price) if r.last_price else None,
            "return_1y": rd.get("return_1y"), "spy_return_1y": rd.get("spy_return_1y"),
            "vs_spy": rd.get("vs_spy"), "ema200": rd.get("ema200"),
            "above_ema200": rd.get("above_ema200"),
            "status": rd.get("status", "N/A"),
            "recommendation": rd.get("recommendation", "No data"),
            "has_data": rd.get("error") is None,
        })

    # Load manual proxy overrides from user_settings
    proxy_override_row = db.execute(text(
        "SELECT value FROM user_settings WHERE key = 'fund_proxy_mapping'"
    )).fetchone()
    import json as _pjson
    proxy_overrides = _pjson.loads(proxy_override_row.value) if proxy_override_row else {}

    from app.services.holdings_review import auto_proxy
    # Collect proxy tickers needed for non-tickered funds
    proxy_tickers_needed = {}
    for r in non_tickered:
        proxy = proxy_overrides.get(r.ticker) or proxy_overrides.get(r.name) or auto_proxy(r.name or "")
        if proxy:
            proxy_tickers_needed[r.ticker] = proxy

    # Fetch proxy data
    proxy_data = review_holdings(list(set(proxy_tickers_needed.values()))) if proxy_tickers_needed else {}

    for r in non_tickered:
        proxy = proxy_tickers_needed.get(r.ticker)
        rd    = proxy_data.get(proxy, {}) if proxy else {}
        has_proxy = bool(proxy and rd.get("error") is None and rd.get("return_1y") is not None)

        positions.append({
            "ticker": r.ticker, "yf_ticker": proxy, "name": r.name,
            "account_id": r.account_id, "account_name": account_names.get(r.account_id, r.account_id), "asset_type": r.asset_type,
            "current_value": float(r.current_value or 0),
            "last_price": float(r.last_price) if r.last_price else None,
            "return_1y":    rd.get("return_1y")    if has_proxy else None,
            "spy_return_1y": rd.get("spy_return_1y") if has_proxy else None,
            "vs_spy":       rd.get("vs_spy")       if has_proxy else None,
            "ema200":       rd.get("ema200")        if has_proxy else None,
            "above_ema200": rd.get("above_ema200")  if has_proxy else None,
            "status":       rd.get("status", "N/A") if has_proxy else "N/A",
            "recommendation": (f"via {proxy} proxy · " + rd.get("recommendation", "")) if has_proxy else "No proxy — add mapping in settings",
            "has_data": has_proxy,
            "proxy_ticker": proxy,
        })

    positions.sort(key=lambda x: (order.get(x["status"], 5), -(x["current_value"] or 0)))
    spy_return = next((rd.get("spy_return_1y") for rd in review_data.values() if rd.get("spy_return_1y")), None)

    # Sanitize nan/inf values
    import math
    def clean(v):
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        return v

    for p in positions:
        for k in ["return_1y", "spy_return_1y", "vs_spy", "ema200", "last_price", "current_value"]:
            p[k] = clean(p.get(k))

    result = {
        "spy_return_1y": spy_return,
        "positions": positions,
        "summary": {
            "outperform":   sum(1 for p in positions if p["status"] == "Outperform"),
            "inline":       sum(1 for p in positions if p["status"] == "In-line"),
            "underperform": sum(1 for p in positions if p["status"] == "Underperform"),
            "watch":        sum(1 for p in positions if p["status"] == "Watch"),
            "na":           sum(1 for p in positions if p["status"] == "N/A"),
        }
    }

    # Cache the result
    import json as _json
    db.execute(text("""
        INSERT INTO holdings_review_cache (id, result_json, generated_at)
        VALUES ('latest', :result_json, :generated_at)
        ON CONFLICT(id) DO UPDATE SET result_json = :result_json, generated_at = :generated_at
    """), {"result_json": _json.dumps(result), "generated_at": datetime.utcnow().isoformat()})
    db.commit()

    return result


@router.get("/review/proxy-mapping")
def get_proxy_mapping(db: Session = Depends(get_db), _: str = Depends(require_auth)):
    from sqlalchemy import text
    import json
    row = db.execute(text("SELECT value FROM user_settings WHERE key = 'fund_proxy_mapping'")).fetchone()
    return {"mapping": json.loads(row.value) if row else {}}

@router.post("/review/proxy-mapping")
def save_proxy_mapping(body: dict, db: Session = Depends(get_db), _: str = Depends(require_auth)):
    from sqlalchemy import text
    import json
    value = json.dumps(body.get("mapping", {}))
    db.execute(text("""
        INSERT INTO user_settings (key, value, updated_at)
        VALUES ('fund_proxy_mapping', :value, :updated_at)
        ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :updated_at
    """), {"value": value, "updated_at": datetime.utcnow().isoformat()})
    db.commit()
    return {"status": "saved"}
