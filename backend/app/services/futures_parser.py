"""
backend/app/services/futures_parser.py

Parses Robinhood Derivatives monthly futures statement PDFs.

Sections extracted:
  1. Monthly Trade Confirmations  — raw legs (buy/sell)
  2. Trade Confirmation Summary   — daily totals with fees
  3. Purchase and Sale Summary    — closed P&L by symbol/month

Contract specs for P&L calculation:
  MNQ  tick=0.25  tick_value=$0.50  multiplier=$2/pt
  SIL  tick=0.005 tick_value=$5.00  multiplier=$1000/pt
  MCL  tick=0.01  tick_value=$1.00  multiplier=$100/pt
  MGC  tick=0.10  tick_value=$1.00  multiplier=$10/pt
  MBT  tick=5.0   tick_value=$0.50  multiplier=$0.10/pt
"""

import re
import pdfplumber
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

CONTRACT_SPECS = {
    "MNQ": {"multiplier": 2.0,    "tick": 0.25,  "tick_val": 0.50},
    "SIL": {"multiplier": 1000.0, "tick": 0.005, "tick_val": 5.00},
    "MCL": {"multiplier": 100.0,  "tick": 0.01,  "tick_val": 1.00},
    "MGC": {"multiplier": 10.0,   "tick": 0.10,  "tick_val": 1.00},
    "MBT": {"multiplier": 0.10,   "tick": 5.0,   "tick_val": 0.50},
}

@dataclass
class FutureLeg:
    trade_date: str
    symbol: str
    side: str          # "L" or "S"
    qty: float
    price: float
    contract_year: int
    contract_month: int
    exchange: str
    exp_date: str

@dataclass
class DailySummaryRow:
    trade_date: str
    symbol: str
    total_long: float
    total_short: float
    avg_long: Optional[float]
    avg_short: Optional[float]
    commission: float
    exchange_fees: float
    nfa_fees: float
    total_fees: float

@dataclass
class PnLSummaryRow:
    symbol: str
    total_long: int
    total_short: int
    gross_pnl: float

@dataclass
class AccountSummary:
    beginning_cash: float = 0.0
    commissions: float = 0.0
    exchange_fees: float = 0.0
    nfa_fees: float = 0.0
    total_fees: float = 0.0
    gross_pnl: float = 0.0
    cash_activity: float = 0.0
    ending_cash: float = 0.0
    open_trade_equity: float = 0.0
    total_equity: float = 0.0
    initial_margin: float = 0.0
    margin_excess: float = 0.0

@dataclass
class ParsedStatement:
    account_num: str = ""
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    legs: list = field(default_factory=list)
    daily_summary: list = field(default_factory=list)
    pnl_summary: list = field(default_factory=list)
    account: AccountSummary = field(default_factory=AccountSummary)


def parse_statement(pdf_path: str) -> ParsedStatement:
    result = ParsedStatement()
    full_text = ""

    with pdfplumber.open(pdf_path) as pdf:
        pages_text = []
        for page in pdf.pages:
            t = page.extract_text() or ""
            pages_text.append(t)
        full_text = "\n".join(pages_text)

    _parse_header(full_text, result)
    _parse_legs(full_text, result)
    _parse_daily_summary(full_text, result)
    _parse_pnl_summary(full_text, result)
    _parse_account_summary(full_text, result)

    return result


def _parse_header(text: str, result: ParsedStatement):
    m = re.search(r"RHD Account Number:\s*(RH\d+)", text)
    if m:
        result.account_num = m.group(1)
    m = re.search(r"Date:\s*(\d{4}-\d{2}-\d{2})", text)
    if m:
        d = m.group(1)
        result.period_end = d
        result.period_start = d[:7] + "-01"


def _parse_legs(text: str, result: ParsedStatement):
    """
    Parse Monthly Trade Confirmations section.
    Columns: Trade Date | AT | Qty Long | Qty Short | Subtype | Symbol |
             Contract Year | Month | Exchange | Exp Date | Trade Price | Currency Code | Trade Type | Description
    """
    section = _extract_section(text, "Monthly Trade Confirmations", "Trade Confirmation Summary")
    if not section:
        return

    # Pattern: date  AT  qty_long  qty_short  subtype  symbol  year  month  exchange  exp_date  price  currency  trade_type  description
    pattern = re.compile(
        r"(\d{4}-\d{2}-\d{2})\s+US\s+"
        r"(\d+\.\d+)\s+(\d+\.\d+)\s+"
        r"(?:\w+\s+)?"                         # subtype (optional)
        r"(MNQ|SIL|MCL|MGC|MBT|MBT|ES|NQ|CL|GC|SI)\s+"
        r"(\d{4})\s+(\d+)\s+"
        r"(\w+)\s+"
        r"(\d{4}-\d{2}-\d{2})\s+"
        r"([\d.]+)"
    )

    for m in pattern.finditer(section):
        qty_long  = float(m.group(2))
        qty_short = float(m.group(3))
        symbol    = m.group(4)
        price     = float(m.group(9))

        if qty_long > 0:
            side = "L"
            qty  = qty_long
        elif qty_short > 0:
            side = "S"
            qty  = qty_short
        else:
            continue

        result.legs.append(FutureLeg(
            trade_date     = m.group(1),
            symbol         = symbol,
            side           = side,
            qty            = qty,
            price          = price,
            contract_year  = int(m.group(5)),
            contract_month = int(m.group(6)),
            exchange       = m.group(7),
            exp_date       = m.group(8),
        ))


def _parse_daily_summary(text: str, result: ParsedStatement):
    section = _extract_section(text, "Trade Confirmation Summary", "Purchase and Sale")
    if not section:
        return

    lines = section.split("\n")
    rows = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if re.match(r"^2026-\s+2026-$", line):
            data_line = lines[i+1].strip() if i+1 < len(lines) else ""
            suffix_line = lines[i+2].strip() if i+2 < len(lines) else ""
            if re.match(r"^\d{2}-\d{2}\s+\d{2}-\d{2}$", suffix_line):
                trade_date = "2026-" + suffix_line.split()[0]
                rows.append(trade_date + " " + data_line)
                i += 3
                continue
        i += 1

    pattern = re.compile(
        r"(\d{4}-\d{2}-\d{2})\s+"
        r"US\s+"
        r"(\d+\.\d+)\s+(\d+\.\d+)\s+"
        r"(\d+\.\d+)\s*"
        r"(\d+\.\d+)?\s*"
        r"(MNQ|SIL|MCL|MGC|MBT|ES|NQ|CL|GC|SI)\s+"
        r"\w+\s+\d{4}\s+\d+\s+\w+\s+"
        r"(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+USD"
    )

    for row in rows:
        m = pattern.search(row)
        if not m:
            continue
        tl  = float(m.group(2))
        ts  = float(m.group(3))
        al  = float(m.group(4))
        as_ = float(m.group(5)) if m.group(5) else None

        if tl == 0:
            avg_long, avg_short = None, al
        elif ts == 0:
            avg_long, avg_short = al, None
        else:
            avg_long, avg_short = al, as_

        result.daily_summary.append(DailySummaryRow(
            trade_date    = m.group(1),
            symbol        = m.group(6),
            total_long    = tl,
            total_short   = ts,
            avg_long      = avg_long,
            avg_short     = avg_short,
            commission    = float(m.group(7)),
            exchange_fees = float(m.group(8)),
            nfa_fees      = float(m.group(9)),
            total_fees    = float(m.group(10)),
        ))


def _parse_pnl_summary(text: str, result: ParsedStatement):
    section = _extract_section(text, "Purchase and Sale Summary", "Journal Entries")
    if not section:
        return

    pattern = re.compile(
        r"(\d{4}-\d{2}-\d{2})\s+US\s+"
        r"(\d+\.\d+)\s+(\d+\.\d+)\s+"
        r"(MNQ|SIL|MCL|MGC|MBT)\s+"
        r"\d{4}\s+\d+\s+\w+\s+[\d-]+\s+"
        r"(-?[\d.]+)\s+USD"
    )

    for m in pattern.finditer(section):
        result.pnl_summary.append(PnLSummaryRow(
            symbol      = m.group(4),
            total_long  = int(float(m.group(2))),
            total_short = int(float(m.group(3))),
            gross_pnl   = float(m.group(5)),
        ))


def _parse_account_summary(text: str, result: ParsedStatement):
    section = _extract_section(text, "Account Summary", None)
    if not section:
        return

    def _val(label):
        m = re.search(rf"{re.escape(label)}\s+[\d.]+\s+(-?[\d.]+)", section)
        return float(m.group(1)) if m else 0.0

    result.account.beginning_cash    = _val("Beginning Cash Balance")
    result.account.commissions       = _val("Commissions")
    result.account.exchange_fees     = _val("Exchange Fees")
    result.account.nfa_fees          = _val("NFA Fees")
    result.account.total_fees        = _val("Total Commissions and Fees")
    result.account.gross_pnl         = _val("Gross Profit and Loss")
    result.account.cash_activity     = _val("Cash Activity")
    result.account.ending_cash       = _val("Ending Cash Balance")
    result.account.open_trade_equity = _val("Open Trade Equity")
    result.account.total_equity      = _val("Total Equity")
    result.account.initial_margin    = _val("Initial Margin")
    result.account.margin_excess     = _val("Margin Excess")


def _extract_section(text: str, start_marker: str, end_marker: Optional[str]) -> str:
    start = text.find(start_marker)
    if start == -1:
        return ""
    start += len(start_marker)
    if end_marker:
        end = text.find(end_marker, start)
        return text[start:end] if end != -1 else text[start:]
    return text[start:]


def compute_daily_pnl(daily_summary_rows: list) -> dict:
    """
    Estimate gross P&L per day per symbol from avg long/short prices.
    Returns dict keyed by (trade_date, symbol) -> estimated_gross_pnl
    """
    results = {}
    for row in daily_summary_rows:
        spec = CONTRACT_SPECS.get(row.symbol)
        if not spec or row.avg_long is None or row.avg_short is None:
            results[(row.trade_date, row.symbol)] = 0.0
            continue
        # net closed = min(long, short) round-trips
        closed = min(row.total_long, row.total_short)
        pnl = (row.avg_short - row.avg_long) * spec["multiplier"] * closed
        results[(row.trade_date, row.symbol)] = round(pnl, 2)
    return results
