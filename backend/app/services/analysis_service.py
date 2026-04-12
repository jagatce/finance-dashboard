"""
Analysis service — wraps the Anthropic API to generate portfolio analysis.
Stores result in holdings_analysis table (one row, always upserted).
"""
import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from anthropic import Anthropic
from app.models.models import Holding, PriceCache, HoldingsAnalysis

client = Anthropic()

SYSTEM_PROMPT = """You are a financial analyst reviewing a personal investment portfolio.
You will receive a list of holdings with quantities, costs, and current prices.
Respond ONLY with a valid JSON object — no markdown, no preamble, no explanation outside the JSON.

Your response must have exactly this structure:
{
  "summary": "2-3 sentence plain-English overview of the portfolio",
  "total_value": <number>,
  "total_cost": <number>,
  "total_gain_pct": <number>,
  "flags": [
    { "level": "warning|info", "message": "concise flag description" }
  ],
  "allocations": [
    { "label": "category name", "pct": <number> }
  ],
  "top_positions": [
    { "ticker": "TICKER", "name": "Name", "value": <number>, "pct_of_portfolio": <number>, "gain_pct": <number or null> }
  ],
  "commentary": "3-5 sentences of actionable observations about concentration, diversification, risk"
}

Rules:
- top_positions: top 8 by value
- allocations: group by asset_type (stock, etf, fund, crypto, other)
- flags: highlight concentration >20% single position, crypto >10%, missing cost basis, etc.
- All numbers rounded to 2 decimal places
- If cost basis is unknown, gain_pct should be null
"""


def refresh_analysis(db: Session) -> dict:
    holdings = db.query(Holding).all()
    if not holdings:
        return {"error": "No holdings found. Import holdings first."}

    tickers = list({h.yfinance_ticker for h in holdings if h.yfinance_ticker})
    price_map = {}
    if tickers:
        rows = db.query(PriceCache).filter(PriceCache.ticker.in_(tickers)).all()
        price_map = {r.ticker: r for r in rows}

    positions   = []
    total_value = 0.0
    total_cost  = 0.0

    for h in holdings:
        pr    = price_map.get(h.yfinance_ticker) if h.yfinance_ticker else None
        price = pr.price if pr else None
        value = float(h.shares) * price if (price and h.shares) else None
        cost  = float(h.total_cost_basis) if h.total_cost_basis else (
                float(h.shares) * float(h.cost_basis_per_share)
                if (h.shares and h.cost_basis_per_share) else None)

        if value:
            total_value += value
        if cost:
            total_cost += cost

        positions.append({
            "ticker":     h.ticker,
            "name":       pr.name if pr else h.name,
            "asset_type": h.asset_type,
            "shares":     float(h.shares) if h.shares else None,
            "price":      price,
            "value":      round(value, 2) if value else None,
            "cost_basis": round(cost, 2) if cost else None,
            "account_id": h.account_id,
            "broker":     h.broker,
        })

    positions.sort(key=lambda x: x.get("value") or 0, reverse=True)

    user_message = f"""Portfolio as of {datetime.now(timezone.utc).strftime('%Y-%m-%d')}:

Total estimated value: ${total_value:,.2f}
Total cost basis: ${total_cost:,.2f}
Number of positions: {len(positions)}

Holdings (sorted by value):
{json.dumps(positions, indent=2)}
"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    analysis_dict = json.loads(raw)

    # Upsert — holdings_analysis has one row, keyed by id
    row = db.query(HoldingsAnalysis).first()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if row:
        row.analysis_json = json.dumps(analysis_dict)
        row.generated_at  = now
    else:
        db.add(HoldingsAnalysis(
            analysis_json = json.dumps(analysis_dict),
            generated_at  = now,
        ))
    db.commit()

    return analysis_dict


def get_latest_analysis(db: Session) -> dict | None:
    row = db.query(HoldingsAnalysis).first()
    if not row:
        return None
    return json.loads(row.analysis_json)
