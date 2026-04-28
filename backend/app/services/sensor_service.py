"""
Sensor service — sends technicals + fundamentals to Claude Haiku
and returns structured per-ticker analysis.
"""
import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from anthropic import Anthropic
from app.models.models import TickerAnalysis, PriceCache
from app.services.technicals_service import fetch_technicals

SYSTEM_PROMPT = """You are a quantitative financial analyst. You will receive technical and fundamental data for a single ticker.
Respond ONLY with a valid JSON object — no markdown, no preamble, no explanation outside the JSON.

Your response must have exactly this structure:
{
  "signal": "buy" | "sell" | "watch",
  "health_score": <integer 0-100>,
  "summary": "2-3 sentence plain-English assessment",
  "reasoning": "3-4 sentences explaining the signal based on the data provided",
  "risks": ["risk1", "risk2", "risk3"],
  "catalysts": ["catalyst1", "catalyst2"],
  "technicals_summary": "1-2 sentences on technical picture",
  "fundamentals_summary": "1-2 sentences on fundamental picture"
}

Signal rules:
- buy: technically sound (price near or below EMA200, RSI not overbought, MACD bullish) AND fundamentals reasonable
- sell: technically weak (price well below EMA200, RSI oversold or falling, MACD bearish) OR fundamentals deteriorating
- watch: mixed signals, wait for confirmation

Health score 0-100:
- 80-100: strong across technicals + fundamentals
- 60-79: solid with some concerns
- 40-59: mixed, needs monitoring
- 20-39: weak, caution warranted
- 0-19: avoid

Keep risks and catalysts as short phrases (2-5 words each), max 4 each.
"""


def analyze_ticker(ticker: str, db: Session) -> dict:
    """
    Fetch technicals, call Claude, store result in ticker_analysis.
    Also upserts fresh price into price_cache so wafer list shows live price.
    Returns the full analysis dict.
    """
    client = Anthropic()  # instantiated here so ANTHROPIC_API_KEY is read after load_dotenv()

    # Fetch technicals + fundamentals
    technicals = fetch_technicals(ticker)
    if "error" in technicals:
        raise ValueError(f"Technicals fetch failed: {technicals['error']}")

    fund = technicals.get("fundamentals", {})

    user_message = f"""Analyze {ticker} as of {datetime.now(timezone.utc).strftime('%Y-%m-%d')}:

PRICE & TREND
  Current Price:  ${technicals['price']}
  EMA 200:        ${technicals['ema200']}  ({'+' if technicals['delta_ema'] >= 0 else ''}{technicals['delta_ema']}% {'above' if technicals['delta_ema'] >= 0 else 'below'} EMA200)
  All-Time High:  ${technicals['ath']}  ({technicals['delta_ath']}% from ATH)

MOMENTUM
  RSI (14):       {technicals['rsi']} — {technicals['rsi_label']}
  MACD Histogram: {technicals['macd_hist']} — {technicals['macd_label']}
  MACD Line:      {technicals['macd']}  Signal: {technicals['macd_signal']}

BOLLINGER BANDS (20, 2σ)
  Upper: ${technicals['bb_upper']}  Mid: ${technicals['bb_mid']}  Lower: ${technicals['bb_lower']}
  Position: {technicals['bb_position']}
  Width: {technicals['bb_width']}%

FUNDAMENTALS
  Name:           {fund.get('name', 'N/A')}
  Sector:         {fund.get('sector', 'N/A')}
  Market Cap:     {fund.get('market_cap', 'N/A')}
  P/E (trailing): {fund.get('pe_ratio', 'N/A')}
  P/E (forward):  {fund.get('forward_pe', 'N/A')}
  Div Yield:      {fund.get('dividend_yield', 'N/A')}
  Revenue Growth: {fund.get('revenue_growth', 'N/A')}
  52w High:       {fund.get('week_52_high', 'N/A')}
  52w Low:        {fund.get('week_52_low', 'N/A')}
"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    analysis = json.loads(raw)

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Upsert price_cache so wafer list always shows fresh price after analysis.
    # Only update price/name/updated_at — never null out day_change_pct, sector,
    # asset_type, prev_close, currency which price_service.py owns.
    fund_data = technicals.get("fundamentals", {})
    pc = db.query(PriceCache).filter(PriceCache.ticker == ticker).first()
    if pc:
        pc.price      = technicals["price"]
        pc.name       = fund_data.get("name") or pc.name or ticker
        pc.updated_at = now
        # preserve all other columns — do not overwrite with None
    else:
        # New row — sensor only knows price/name, rest stay NULL until price_service runs
        db.add(PriceCache(
            ticker     = ticker,
            price      = technicals["price"],
            name       = fund_data.get("name") or ticker,
            updated_at = now,
        ))

    # Upsert ticker_analysis
    row = db.query(TickerAnalysis).filter(TickerAnalysis.ticker == ticker).first()
    if row:
        row.signal          = analysis.get("signal")
        row.health_score    = analysis.get("health_score")
        row.analysis_json   = json.dumps(analysis)
        row.technicals_json = json.dumps(technicals)
        row.refreshed_at    = now
    else:
        db.add(TickerAnalysis(
            ticker          = ticker,
            signal          = analysis.get("signal"),
            health_score    = analysis.get("health_score"),
            analysis_json   = json.dumps(analysis),
            technicals_json = json.dumps(technicals),
            refreshed_at    = now,
        ))

    db.commit()

    return {"analysis": analysis, "technicals": technicals}


def get_ticker_analysis(ticker: str, db: Session) -> dict | None:
    """Return stored analysis + technicals for a ticker, or None."""
    row = db.query(TickerAnalysis).filter(TickerAnalysis.ticker == ticker).first()
    if not row:
        return None
    return {
        "ticker":       ticker,
        "signal":       row.signal,
        "health_score": row.health_score,
        "analysis":     json.loads(row.analysis_json),
        "technicals":   json.loads(row.technicals_json),
        "refreshed_at": row.refreshed_at.isoformat() if row.refreshed_at else None,
    }
