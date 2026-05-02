"""
backend/app/api/v1/futures.py

Endpoints:
  POST /api/v1/futures/import          — upload + parse a PDF statement
  GET  /api/v1/futures/imports         — list imported batches
  DELETE /api/v1/futures/imports/{id}  — remove a batch and its data
  GET  /api/v1/futures/summary         — overall account summary (all time or ?month=)
  GET  /api/v1/futures/daily           — daily P&L + volume (?month=, ?symbol=)
  GET  /api/v1/futures/instruments     — per-symbol breakdown (?month=)
  GET  /api/v1/futures/top-trades      — top 10 winners + losers (?month=, ?symbol=)
  GET  /api/v1/futures/psychology      — behavioral metrics + SL rule scoring
"""

import os
import tempfile
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.core.auth import require_auth
from app.services.futures_parser import (
    parse_statement, compute_daily_pnl, CONTRACT_SPECS
)

router = APIRouter(prefix="/api/v1/futures", tags=["futures"])

# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

@router.post("/import")
def import_statement(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: str = Depends(require_auth),
):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    # Check duplicate
    existing = db.execute(
        text("SELECT id FROM futures_import_batches WHERE filename = :fn"),
        {"fn": file.filename}
    ).fetchone()
    if existing:
        raise HTTPException(409, f"File '{file.filename}' already imported (batch {existing[0]})")

    # Save to temp file and parse
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    try:
        stmt = parse_statement(tmp_path)
    finally:
        os.unlink(tmp_path)

    if not stmt.legs:
        raise HTTPException(422, "No trade legs found in PDF — check format")

    # Insert batch
    res = db.execute(
        text("""
            INSERT INTO futures_import_batches
                (filename, account_num, period_start, period_end, leg_count)
            VALUES (:fn, :acct, :ps, :pe, :lc)
        """),
        {
            "fn":   file.filename,
            "acct": stmt.account_num,
            "ps":   stmt.period_start,
            "pe":   stmt.period_end,
            "lc":   len(stmt.legs),
        }
    )
    batch_id = res.lastrowid

    # Insert legs
    for leg in stmt.legs:
        db.execute(
            text("""
                INSERT INTO futures_trades
                    (batch_id, trade_date, symbol, side, qty, price,
                     contract_year, contract_month, exchange, exp_date)
                VALUES
                    (:bid, :td, :sym, :side, :qty, :price,
                     :yr, :mo, :exch, :exp)
            """),
            {
                "bid":  batch_id,
                "td":   leg.trade_date,
                "sym":  leg.symbol,
                "side": leg.side,
                "qty":  leg.qty,
                "price": leg.price,
                "yr":   leg.contract_year,
                "mo":   leg.contract_month,
                "exch": leg.exchange,
                "exp":  leg.exp_date,
            }
        )

    # Insert daily summaries (with computed P&L)
    pnl_map = compute_daily_pnl(stmt.daily_summary)
    for row in stmt.daily_summary:
        gross = pnl_map.get((row.trade_date, row.symbol), 0.0)
        net   = gross + row.total_fees  # fees are negative
        db.execute(
            text("""
                INSERT OR REPLACE INTO futures_daily_summary
                    (batch_id, trade_date, symbol, total_long, total_short,
                     avg_long, avg_short, gross_pnl, commission, exchange_fees,
                     nfa_fees, total_fees, net_pnl)
                VALUES
                    (:bid, :td, :sym, :tl, :ts, :al, :as_, :gp,
                     :comm, :exf, :nfa, :tf, :np)
            """),
            {
                "bid":  batch_id,
                "td":   row.trade_date,
                "sym":  row.symbol,
                "tl":   row.total_long,
                "ts":   row.total_short,
                "al":   row.avg_long,
                "as_":  row.avg_short,
                "gp":   gross,
                "comm": row.commission,
                "exf":  row.exchange_fees,
                "nfa":  row.nfa_fees,
                "tf":   row.total_fees,
                "np":   net,
            }
        )

    # Insert monthly P&L summary — aggregate by symbol (handles duplicate SIL rows)
    fee_by_sym = {}
    for row in stmt.daily_summary:
        fee_by_sym[row.symbol] = fee_by_sym.get(row.symbol, 0.0) + row.total_fees

    pnl_by_sym = {}
    rt_by_sym = {}
    for ps_row in stmt.pnl_summary:
        pnl_by_sym[ps_row.symbol] = pnl_by_sym.get(ps_row.symbol, 0.0) + ps_row.gross_pnl
        rt_by_sym[ps_row.symbol]  = rt_by_sym.get(ps_row.symbol, 0) + ps_row.total_long

    for sym, gp in pnl_by_sym.items():
        tf = fee_by_sym.get(sym, 0.0)
        db.execute(
            text("""
                INSERT OR REPLACE INTO futures_monthly_summary
                    (batch_id, symbol, gross_pnl, total_fees, net_pnl, round_trips)
                VALUES (:bid, :sym, :gp, :tf, :np, :rt)
            """),
            {
                "bid": batch_id,
                "sym": sym,
                "gp":  gp,
                "tf":  tf,
                "np":  gp + tf,
                "rt":  rt_by_sym.get(sym, 0),
            }
        )

    db.commit()
    return {
        "batch_id":     batch_id,
        "filename":     file.filename,
        "period_start": stmt.period_start,
        "period_end":   stmt.period_end,
        "leg_count":    len(stmt.legs),
        "account":      stmt.account.__dict__,
    }


# ---------------------------------------------------------------------------
# Import management
# ---------------------------------------------------------------------------

@router.get("/imports")
def list_imports(db: Session = Depends(get_db), _: str = Depends(require_auth)):
    rows = db.execute(text("""
        SELECT id, filename, account_num, period_start, period_end,
               imported_at, leg_count
        FROM futures_import_batches
        ORDER BY period_start DESC
    """)).fetchall()
    return [dict(r._mapping) for r in rows]


@router.delete("/imports/{batch_id}")
def delete_import(
    batch_id: int,
    db: Session = Depends(get_db),
    _: str = Depends(require_auth),
):
    row = db.execute(
        text("SELECT id FROM futures_import_batches WHERE id = :id"),
        {"id": batch_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "Batch not found")

    for tbl in ["futures_trades", "futures_daily_summary", "futures_monthly_summary"]:
        db.execute(text(f"DELETE FROM {tbl} WHERE batch_id = :id"), {"id": batch_id})
    db.execute(
        text("DELETE FROM futures_import_batches WHERE id = :id"), {"id": batch_id}
    )
    db.commit()
    return {"deleted": batch_id}


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

def _month_filter(month: Optional[str]) -> tuple[str, dict]:
    if month:
        return "AND strftime('%Y-%m', trade_date) = :month", {"month": month}
    return "", {}


@router.get("/summary")
def get_summary(
    month: Optional[str] = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
    _: str = Depends(require_auth),
):
    mf, mp = _month_filter(month)

    # Account-level from daily data
    totals = db.execute(text(f"""
        SELECT
            SUM(m.gross_pnl)  AS gross_pnl,
            SUM(d.total_fees) AS total_fees,
            SUM(m.gross_pnl) + SUM(d.total_fees) AS net_pnl,
            SUM(m.round_trips) AS round_trips,
            (SELECT COUNT(DISTINCT trade_date) FROM futures_daily_summary
             WHERE batch_id IN (SELECT id FROM futures_import_batches)) AS trading_days
        FROM futures_monthly_summary m
        JOIN futures_import_batches b ON m.batch_id = b.id
        LEFT JOIN (
            SELECT symbol, SUM(total_fees) AS total_fees
            FROM futures_daily_summary
            GROUP BY symbol
        ) d ON m.symbol = d.symbol
    """), {}).fetchone()

    # Per symbol — combine SIL rows in monthly_summary
    by_sym = db.execute(text(f"""
        SELECT
            m.symbol,
            SUM(m.gross_pnl)  AS gross_pnl,
            COALESCE(d.total_fees, 0) AS total_fees,
            SUM(m.gross_pnl) + COALESCE(d.total_fees, 0) AS net_pnl,
            SUM(m.round_trips) AS round_trips,
            COALESCE(d.active_days, 0) AS active_days
        FROM futures_monthly_summary m
        LEFT JOIN (
            SELECT symbol,
                   SUM(total_fees) AS total_fees,
                   COUNT(DISTINCT trade_date) AS active_days
            FROM futures_daily_summary
            GROUP BY symbol
        ) d ON m.symbol = d.symbol
        GROUP BY m.symbol
        ORDER BY SUM(m.gross_pnl) DESC
    """), {}).fetchall()

    # Available months
    months = db.execute(text("""
        SELECT DISTINCT strftime('%Y-%m', trade_date) AS m
        FROM futures_daily_summary
        ORDER BY m DESC
    """)).fetchall()

    return {
        "totals":           dict(totals._mapping) if totals else {},
        "by_symbol":        [dict(r._mapping) for r in by_sym],
        "available_months": [r[0] for r in months],
    }


@router.get("/daily")
def get_daily(
    month:  Optional[str] = Query(None),
    symbol: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: str = Depends(require_auth),
):
    conditions = ["1=1"]
    params: dict = {}
    if month:
        conditions.append("strftime('%Y-%m', trade_date) = :month")
        params["month"] = month
    if symbol:
        conditions.append("symbol = :symbol")
        params["symbol"] = symbol
    where = " AND ".join(conditions)

    rows = db.execute(text(f"""
        SELECT
            trade_date,
            GROUP_CONCAT(DISTINCT symbol ORDER BY symbol) AS symbols,
            SUM(gross_pnl)  AS gross_pnl,
            SUM(total_fees) AS total_fees,
            SUM(net_pnl)    AS net_pnl,
            CAST(SUM(total_long + total_short) / 2 AS INTEGER) AS contracts
        FROM futures_daily_summary
        WHERE {where}
        GROUP BY trade_date
        ORDER BY trade_date
    """), params).fetchall()

    return [dict(r._mapping) for r in rows]


@router.get("/instruments")
def get_instruments(
    month: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: str = Depends(require_auth),
):
    mf, mp = _month_filter(month)
    rows = db.execute(text(f"""
        SELECT
            symbol,
            SUM(gross_pnl)  AS gross_pnl,
            SUM(total_fees) AS total_fees,
            SUM(net_pnl)    AS net_pnl,
            CAST(SUM(total_long + total_short) / 2 AS INTEGER) AS round_trips,
            COUNT(DISTINCT trade_date) AS active_days,
            AVG(CASE WHEN total_long  > 0 THEN avg_long  END) AS overall_avg_long,
            AVG(CASE WHEN total_short > 0 THEN avg_short END) AS overall_avg_short
        FROM futures_daily_summary
        WHERE 1=1 {mf}
        GROUP BY symbol
        ORDER BY gross_pnl DESC
    """), mp).fetchall()

    specs = {k: {**v, "name": _sym_name(k)} for k, v in CONTRACT_SPECS.items()}
    result = []
    for r in rows:
        d = dict(r._mapping)
        d["spec"] = specs.get(d["symbol"], {})
        d["fee_drag_pct"] = round(
            abs(d["total_fees"]) / d["gross_pnl"] * 100, 1
        ) if d["gross_pnl"] and d["gross_pnl"] != 0 else None
        result.append(d)
    return result


@router.get("/top-trades")
def get_top_trades(
    month:  Optional[str] = Query(None),
    symbol: Optional[str] = Query(None),
    limit:  int = Query(10),
    db: Session = Depends(get_db),
    _: str = Depends(require_auth),
):
    conditions = ["1=1"]
    params: dict = {"limit": limit}
    if month:
        conditions.append("strftime('%Y-%m', trade_date) = :month")
        params["month"] = month
    if symbol:
        conditions.append("symbol = :symbol")
        params["symbol"] = symbol
    where = " AND ".join(conditions)

    winners = db.execute(text(f"""
        SELECT trade_date, symbol, gross_pnl, net_pnl, total_fees,
               total_long, total_short, avg_long, avg_short
        FROM futures_daily_summary
        WHERE {where} AND gross_pnl > 0
        ORDER BY gross_pnl DESC
        LIMIT :limit
    """), params).fetchall()

    losers = db.execute(text(f"""
        SELECT trade_date, symbol, gross_pnl, net_pnl, total_fees,
               total_long, total_short, avg_long, avg_short
        FROM futures_daily_summary
        WHERE {where} AND gross_pnl < 0
        ORDER BY gross_pnl ASC
        LIMIT :limit
    """), params).fetchall()

    def enrich(rows):
        out = []
        for r in rows:
            d = dict(r._mapping)
            sym = d["symbol"]
            spec = CONTRACT_SPECS.get(sym, {})
            al = d.get("avg_long")
            as_ = d.get("avg_short")
            if al and as_:
                move = round(as_ - al, 4)
                d["price_move"]    = move
                d["move_direction"] = "favorable" if (move > 0) else "adverse"
            d["contract_name"] = _sym_name(sym)
            d["analysis"]      = _trade_analysis(d)
            out.append(d)
        return out

    return {"winners": enrich(winners), "losers": enrich(losers)}


@router.get("/psychology")
def get_psychology(
    month: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: str = Depends(require_auth),
):
    mf, mp = _month_filter(month)

    # Win/loss day counts
    wl = db.execute(text(f"""
        SELECT
            COUNT(CASE WHEN net_pnl > 0 THEN 1 END)  AS win_days,
            COUNT(CASE WHEN net_pnl < 0 THEN 1 END)  AS loss_days,
            COUNT(CASE WHEN net_pnl = 0 THEN 1 END)  AS flat_days,
            AVG(CASE WHEN net_pnl > 0 THEN net_pnl END) AS avg_win,
            AVG(CASE WHEN net_pnl < 0 THEN net_pnl END) AS avg_loss,
            MAX(net_pnl)  AS best_day,
            MIN(net_pnl)  AS worst_day,
            SUM(net_pnl)  AS total_net
        FROM (
            SELECT trade_date, SUM(net_pnl) AS net_pnl
            FROM futures_daily_summary
            WHERE 1=1 {mf}
            GROUP BY trade_date
        )
    """), mp).fetchone()

    # Consecutive loss sequences (adverse re-entry pattern)
    all_days = db.execute(text(f"""
        SELECT trade_date, SUM(net_pnl) AS net_pnl
        FROM futures_daily_summary
        WHERE 1=1 {mf}
        GROUP BY trade_date
        ORDER BY trade_date
    """), mp).fetchall()

    max_consecutive_losses = 0
    cur_streak = 0
    for row in all_days:
        if row[1] < 0:
            cur_streak += 1
            max_consecutive_losses = max(max_consecutive_losses, cur_streak)
        else:
            cur_streak = 0

    # SL rule compliance metrics
    # Days where MNQ gross < -150 (daily loss limit breach)
    mnq_limit_breaches = db.execute(text(f"""
        SELECT COUNT(*) FROM futures_daily_summary
        WHERE symbol = 'MNQ' AND gross_pnl < -150 {mf}
    """), mp).fetchone()[0]

    # Days where avg_long > avg_short (adverse direction trading)
    adverse_days = db.execute(text(f"""
        SELECT COUNT(*) FROM futures_daily_summary
        WHERE avg_long IS NOT NULL AND avg_short IS NOT NULL
          AND avg_long > avg_short AND gross_pnl < 0
          {mf}
    """), mp).fetchone()[0]

    d = dict(wl._mapping) if wl else {}
    avg_win  = d.get("avg_win")  or 0
    avg_loss = d.get("avg_loss") or 0
    rr_ratio = round(abs(avg_win / avg_loss), 2) if avg_loss and avg_loss != 0 else None

    return {
        **d,
        "win_loss_ratio":          rr_ratio,
        "max_consecutive_losses":  max_consecutive_losses,
        "mnq_daily_limit_breaches": mnq_limit_breaches,
        "adverse_direction_days":  adverse_days,
        "sl_rules": {
            "mnq_hard_stop_pts":      20,
            "mnq_daily_loss_limit":   -150,
            "sil_hard_stop_pts":      0.25,
            "roll_rule_sessions":     2,
            "size_down_after_losses": 2,
        },
        "estimated_savings": {
            "mnq_daily_cap":  mnq_limit_breaches * 500,
            "sil_roll_rule":  1600,
            "total_est":      mnq_limit_breaches * 500 + 1600,
        }
    }


def _sym_name(sym: str) -> str:
    return {
        "MNQ": "Micro E-mini Nasdaq-100",
        "SIL": "Micro Silver",
        "MCL": "Micro Crude Oil",
        "MGC": "Micro Gold",
        "MBT": "Micro Bitcoin",
    }.get(sym, sym)


def _trade_analysis(d: dict) -> str:
    sym   = d.get("symbol", "")
    pnl   = d.get("gross_pnl", 0)
    al    = d.get("avg_long")
    as_   = d.get("avg_short")
    tl    = d.get("total_long", 0)
    ts    = d.get("total_short", 0)

    if pnl > 0:
        if sym == "SIL":
            return "SIL long momentum — bought dip or trend continuation, avg exit above avg entry."
        if sym == "MNQ":
            if tl >= 6:
                return "High-volume MNQ win — trend aligned, multiple entries in same direction."
            return "Clean MNQ scalp — entry and exit in favorable window."
        return f"{sym} profitable — small sample, conviction entry."
    else:
        if sym == "SIL":
            return "SIL adverse — avg long above avg short. Possible premature entry or held through reversal."
        if sym == "MNQ":
            if tl and al and as_ and al > as_:
                return "MNQ adverse direction — avg long > avg short. Buying into weakness, no stop honored."
            return "MNQ loss — price moved against position. Review re-entry count."
        return f"{sym} loss — adverse price move, review exit timing."
