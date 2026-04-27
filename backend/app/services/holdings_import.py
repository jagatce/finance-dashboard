"""
Holdings CSV/PDF import service.
Supports: Betterment, Fidelity (all variants), M1, Empower (PDF), Robinhood (PDF).
Returns normalized list of dicts — no DB writes here, caller does that.
"""
import csv
import io
import re
import hashlib
from datetime import date, datetime
from typing import Optional


# ── Numeric cleaning ──────────────────────────────────────────────────────────

def _num(val) -> Optional[float]:
    if val is None:
        return None
    s = str(val).strip()
    if s in ("--", "", "N/A", "n/a", "-"):
        return None
    s = re.sub(r'[$+%,]', '', s)
    try:
        return float(s)
    except ValueError:
        return None


# ── Ticker helpers ────────────────────────────────────────────────────────────

def _yf_ticker(ticker: str) -> Optional[str]:
    if not ticker:
        return None
    return ticker.strip().replace(".", "-")

def _is_cusip(symbol: str) -> bool:
    return bool(re.match(r'^[A-Z0-9]{9}$', symbol.strip()))

SKIP_SYMBOLS = {
    "FDRXX", "FZFXX", "SPAXX", "FZDXX", "FCASH",
    "BROKERAGELINK", "PENDING", "CASH", "USD",
}

def _should_skip(symbol: str, quantity) -> bool:
    if symbol:
        sym = symbol.strip().rstrip("*").upper()
        if sym in SKIP_SYMBOLS:
            return True
    if quantity is None or str(quantity).strip() == "":
        return True
    try:
        if float(str(quantity).strip()) == 0:
            return True
    except ValueError:
        pass
    return False


# ── Broker detection ──────────────────────────────────────────────────────────

def detect_broker(headers: list[str]) -> str:
    h = {x.strip() for x in headers}
    if "PurchaseDate" in h and "CostBasis" in h and "Account #" in h:
        return "betterment"
    if "Account Number" in h and "Average Cost Basis" in h and "Description" in h:
        return "fidelity"
    if "Avg. Price" in h and "Unrealized Gain ($)" in h:
        return "m1"
    if "Account Number" in h and "Investment Name" in h and "Symbol" in h and "Share Price" in h:
        return "vanguard"
    raise ValueError(f"Unknown broker format. Headers: {headers}")


# ── Fidelity date extraction ──────────────────────────────────────────────────

def _fidelity_date(raw_text: str) -> date:
    m = re.search(r'Date downloaded (\w+-\d+-\d+)', raw_text)
    if m:
        try:
            return datetime.strptime(m.group(1), "%b-%d-%Y").date()
        except ValueError:
            pass
    return date.today()


# ── Output row builder ────────────────────────────────────────────────────────

def _row(ticker, name, shares, cost_per_share, total_cost,
         broker, as_of, asset_type="etf", yf_ticker=None,
         last_price=None, current_value=None):
    t = ticker.strip() if ticker else ticker
    return {
        "ticker":               t,
        "name":                 name,
        "shares":               shares,
        "cost_basis_per_share": cost_per_share,
        "total_cost_basis":     total_cost,
        "last_price":           last_price,
        "current_value":        current_value,
        "broker":               broker,
        "as_of_date":           as_of,
        "asset_type":           asset_type,
        "yfinance_ticker":      yf_ticker or _yf_ticker(t),
    }


# ── Betterment parser ─────────────────────────────────────────────────────────

def parse_betterment(content: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(content))
    lots: dict[str, dict] = {}

    for row in reader:
        symbol  = row.get("Symbol", "").strip()
        qty     = _num(row.get("Shares"))
        cost    = _num(row.get("CostBasis"))
        mktval  = _num(row.get("MarketValue"))

        if not symbol or qty is None:
            continue

        if symbol not in lots:
            lots[symbol] = {"shares": 0.0, "total_cost": 0.0, "market_value": 0.0}
        lots[symbol]["shares"]       += qty
        lots[symbol]["total_cost"]   += (cost or 0.0)
        lots[symbol]["market_value"] += (mktval or 0.0)

    results = []
    today   = date.today()
    for ticker, agg in lots.items():
        shares     = agg["shares"]
        total_cost = agg["total_cost"]
        mkt_val    = agg["market_value"]
        cost_per   = (total_cost / shares) if shares > 0 else None
        last_price = (mkt_val / shares) if (shares > 0 and mkt_val) else None
        results.append(_row(
            ticker         = ticker,
            name           = None,
            shares         = shares,
            cost_per_share = cost_per,
            total_cost     = total_cost,
            broker         = "betterment",
            as_of          = today,
            asset_type     = "etf",
            last_price     = last_price,
            current_value  = mkt_val if mkt_val else None,
        ))
    return results


# ── Fidelity parser ───────────────────────────────────────────────────────────

def parse_fidelity(content: str) -> list[dict]:
    content  = content.lstrip('\ufeff')
    as_of    = _fidelity_date(content)
    results  = []

    lines      = content.splitlines()
    data_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('"') and len(stripped) > 50:
            break
        data_lines.append(line)

    reader = csv.DictReader(io.StringIO("\n".join(data_lines)))

    for row in reader:
        symbol      = (row.get("Symbol") or "").strip().rstrip("*")
        desc        = (row.get("Description") or "").strip()
        qty         = _num(row.get("Quantity"))
        avg_cost    = _num(row.get("Average Cost Basis"))
        tot_cost    = _num(row.get("Cost Basis Total"))
        last_price  = _num(row.get("Last Price"))
        cur_value   = _num(row.get("Current Value"))

        if _should_skip(symbol or desc, row.get("Quantity")):
            continue
        if symbol.upper() == "BROKERAGELINK":
            continue

        if not symbol and desc:
            results.append(_row(
                ticker         = desc,
                name           = desc,
                shares         = qty or 0.0,
                cost_per_share = avg_cost,
                total_cost     = tot_cost,
                last_price     = last_price,
                current_value  = cur_value,
                broker         = "fidelity",
                as_of          = as_of,
                asset_type     = "fund_nontickered",
                yf_ticker      = None,
            ))
            continue

        if _is_cusip(symbol):
            results.append(_row(
                ticker         = symbol,
                name           = desc,
                shares         = qty or 0.0,
                cost_per_share = avg_cost,
                total_cost     = tot_cost,
                last_price     = last_price,
                current_value  = cur_value,
                broker         = "fidelity",
                as_of          = as_of,
                asset_type     = "fund_cusip",
                yf_ticker      = None,
            ))
            continue

        results.append(_row(
            ticker         = symbol,
            name           = desc,
            shares         = qty or 0.0,
            cost_per_share = avg_cost,
            total_cost     = tot_cost,
            last_price     = last_price,
            current_value  = cur_value,
            broker         = "fidelity",
            as_of          = as_of,
            asset_type     = "etf",
        ))

    return results


# ── M1 Finance parser ─────────────────────────────────────────────────────────

def parse_m1(content: str) -> list[dict]:
    reader  = csv.DictReader(io.StringIO(content))
    results = []
    today   = date.today()

    for row in reader:
        symbol    = (row.get("Symbol") or "").strip()
        name      = (row.get("Name") or "").strip()
        qty       = _num(row.get("Quantity"))
        avg_price = _num(row.get("Avg. Price"))
        tot_cost  = _num(row.get("Cost Basis"))

        if not symbol or qty is None:
            continue

        mkt_val = _num(row.get("Value"))
        results.append(_row(
            ticker         = symbol,
            name           = name,
            shares         = qty,
            cost_per_share = avg_price,
            total_cost     = tot_cost,
            broker         = "m1",
            as_of          = today,
            asset_type     = "stock",
            last_price     = avg_price,
            current_value  = mkt_val,
        ))

    return results


# ── Empower PDF parser ────────────────────────────────────────────────────────

def parse_empower_pdf(pdf_bytes: bytes) -> list[dict]:
    import pdfplumber

    as_of   = date.today()
    results = []

    # Rows to skip — section headers, totals, cash sweeps
    SKIP_NAMES = {
        "US DOLLARS AND MONEY FUND SWEEPS",
        "Total Cash and Cash Equivalents",
        "Total Equity", "Total Fixed Income", "Total Account",
        "Cash and Cash Equivalents", "Equity", "Fixed Income",
        "Account Type: Individual",
    }
    # Header rows by symbol cell content
    SKIP_SYMBOLS = {"USD", "Symbol", ""}

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = "\n".join(p.extract_text() or "" for p in pdf.pages)

        m = re.search(r'As of Date\s*:?\s*(\d{2}/\d{2}/\d{4})', full_text)
        if m:
            try:
                as_of = datetime.strptime(m.group(1), "%m/%d/%Y").date()
            except ValueError:
                pass

        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                # Only process Account Holdings tables (have 6 cols with Symbol/Price/Qty/MktVal)
                if not table or len(table) < 2:
                    continue

                # Detect holdings table by header row containing "Symbol"
                header_idx = None
                for ri, row in enumerate(table):
                    cells = [str(c or "").strip() for c in row]
                    if "Symbol" in cells and "Quantity" in cells:
                        header_idx = ri
                        break

                if header_idx is None:
                    continue

                # Map column positions from header
                hdr = [str(c or "").strip() for c in table[header_idx]]
                try:
                    sym_i = hdr.index("Symbol")
                    qty_i = hdr.index("Quantity")
                    # Price and Market Value may vary
                    price_i = hdr.index("Price") if "Price" in hdr else None
                    mktval_i = hdr.index("Market Value") if "Market Value" in hdr else None
                except ValueError:
                    continue

                for row in table[header_idx + 1:]:
                    if not row or len(row) <= max(sym_i, qty_i):
                        continue
                    cells = [str(c or "").strip() for c in row]

                    name   = cells[0] if cells[0] else ""
                    symbol = cells[sym_i] if sym_i < len(cells) else ""
                    qty    = _num(cells[qty_i]) if qty_i < len(cells) else None
                    price  = _num(cells[price_i]) if (price_i and price_i < len(cells)) else None
                    mktval = _num(cells[mktval_i]) if (mktval_i and mktval_i < len(cells)) else None

                    if not symbol or symbol in SKIP_SYMBOLS:
                        continue
                    if not re.match(r'^[A-Z]{1,6}$', symbol):
                        continue
                    if name in SKIP_NAMES:
                        continue
                    if qty is None or qty <= 0:
                        continue

                    results.append(_row(
                        ticker         = symbol,
                        name           = name,
                        shares         = qty,
                        cost_per_share = None,
                        total_cost     = None,
                        last_price     = price,
                        current_value  = mktval,
                        broker         = "empower",
                        as_of          = as_of,
                        asset_type     = "etf",
                    ))

    # Dedupe by ticker — keep first occurrence
    seen    = {}
    deduped = []
    for r in results:
        if r["ticker"] not in seen:
            seen[r["ticker"]] = True
            deduped.append(r)
    return deduped


# ── Robinhood PDF parser ──────────────────────────────────────────────────────

def parse_robinhood_pdf(pdf_bytes: bytes) -> list[dict]:
    """
    Parse Robinhood monthly statement PDF.
    Handles multi-account PDFs (Traditional + Roth in one file).
    Skips accounts with $0 closing portfolio value.

    Two line formats observed:
    Format A (inline): "Microsoft MSFT Cash 2 $370.17000 $740.34 3.78%"
    Format B (split):  prev_line = name, cur_line = "TICKER Cash qty $price $val"
    """
    import pdfplumber

    as_of   = date.today()
    results = []

    # Format A: Name TICKER Cash|Margin qty $price $value pct%
    inline_re = re.compile(
        r"^(.+?)\s+([A-Z]{1,5})\s+(?:Cash|Margin)\s+([\d,]+\.?\d*)\s+\$([\d,]+\.\d+)\s+\$([\d,]+\.\d+)"
    )
    # Format B: TICKER Cash|Margin qty $price $value
    split_re = re.compile(
        r"^([A-Z]{1,5})\s+(?:Cash|Margin)\s+([\d,]+\.?\d*)\s+\$([\d,]+\.\d+)\s+\$([\d,]+\.\d+)"
    )
    # Portfolio Value $open $close [pct%]
    pv_re = re.compile(
        r"Portfolio Value\s+\$[\d,]+\.\d+\s+\$([\d,]+\.\d+)"
    )

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        all_pages_text = [p.extract_text() or "" for p in pdf.pages]
        full_text      = "\n".join(all_pages_text)

        dm = re.search(r"\d{2}/\d{2}/\d{4}\s+to\s+(\d{2}/\d{2}/\d{4})", full_text)
        if dm:
            try:
                as_of = datetime.strptime(dm.group(1), "%m/%d/%Y").date()
            except ValueError:
                pass

        in_holdings      = False
        current_nonempty = True
        prev_line        = ""

        for page_text in all_pages_text:
            for line in page_text.splitlines():
                line = line.strip()
                if not line:
                    continue

                # Account section boundary
                pv = pv_re.search(line)
                if pv:
                    closing          = float(pv.group(1).replace(",", ""))
                    current_nonempty = closing > 0.0
                    in_holdings      = False
                    prev_line        = ""
                    continue

                if "Securities Held in Account" in line:
                    in_holdings = current_nonempty
                    prev_line   = ""
                    continue

                if in_holdings and (
                    "Loaned Securities" in line or
                    line.startswith("Total Securities") or
                    line.startswith("Brokerage Cash")
                ):
                    in_holdings = False
                    continue

                if not in_holdings:
                    prev_line = line
                    continue

                if line.startswith("Sym/Cusip") or line.startswith("Page "):
                    continue

                # Try format A first (everything on one line)
                m = inline_re.match(line)
                if m:
                    name   = m.group(1).strip()
                    symbol = m.group(2)
                    qty    = _num(m.group(3))
                    price  = _num(m.group(4))
                    value  = _num(m.group(5))
                    if not _should_skip(symbol, qty):
                        results.append(_row(
                            ticker=symbol, name=name, shares=qty,
                            cost_per_share=price, total_cost=value,
                            broker="robinhood", as_of=as_of,
                            asset_type="stock", last_price=price, current_value=value,
                        ))
                    prev_line = line
                    continue

                # Try format B (ticker on this line, name on prev)
                m2 = split_re.match(line)
                if m2:
                    symbol = m2.group(1)
                    qty    = _num(m2.group(2))
                    price  = _num(m2.group(3))
                    value  = _num(m2.group(4))
                    name   = prev_line if prev_line and not split_re.match(prev_line) else symbol
                    if not _should_skip(symbol, qty):
                        results.append(_row(
                            ticker=symbol, name=name, shares=qty,
                            cost_per_share=price, total_cost=value,
                            broker="robinhood", as_of=as_of,
                            asset_type="stock", last_price=price, current_value=value,
                        ))

                prev_line = line

    seen    = {}
    deduped = []
    for r in results:
        if r["ticker"] not in seen:
            seen[r["ticker"]] = True
            deduped.append(r)
    return deduped


# ── Main entry point ──────────────────────────────────────────────────────────


# ── Apex Clearing (Ally IRA) PDF parser ──────────────────────────────────────

def parse_apex_clearing_pdf(pdf_bytes: bytes) -> list[dict]:
    """
    Parse Apex Clearing brokerage statement (used by Ally Invest IRA).
    Positions table format:
      SYMBOL/CUSIP | ACCOUNT TYPE | QUANTITY | PRICE | MARKET VALUE | ...
    Header line: SYMBOL/ ACCOUNT MARKET LAST PERIOD'S EST. ANNUAL % OF TOTAL
                 DESCRIPTION CUSIP TYPE QUANTITY PRICE VALUE ...
    Data lines:  COMPANY NAME  TICKER  C  qty  $price  $value ...
    """
    import pdfplumber

    as_of   = date.today()
    results = []

    # Pattern: NAME TICKER  C  qty  $price  $mktval
    # e.g. "APPLE INC AAPL C 100 $253.79 $25,379.00 $26,418.00 -4% $104 73.249%"
    row_re = re.compile(
        r"^(.+?)\s+([A-Z]{1,5})\s+C\s+([\d,]+\.?\d*)\s+\$?([\d,]+\.\d+)\s+\$?([\d,]+\.\d+)"
    )

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = "\n".join(p.extract_text() or "" for p in pdf.pages)

        # as-of date from "March 1, 2026 - March 31, 2026"
        dm = re.search(r"(\w+ \d+, \d{4})\s*-\s*(\w+ \d+, \d{4})", full_text)
        if dm:
            try:
                as_of = datetime.strptime(dm.group(2), "%B %d, %Y").date()
            except ValueError:
                pass

        in_equities = False
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            for line in page_text.splitlines():
                line = line.strip()
                if "EQUITIES / OPTIONS" in line:
                    in_equities = True
                    continue
                if in_equities and line.startswith("Total Equities"):
                    in_equities = False
                    continue
                if not in_equities:
                    continue

                m = row_re.match(line)
                if m:
                    name   = m.group(1).strip()
                    symbol = m.group(2)
                    qty    = _num(m.group(3))
                    price  = _num(m.group(4))
                    value  = _num(m.group(5))
                    if not _should_skip(symbol, qty):
                        yf = _yf_ticker(symbol)
                        results.append(_row(
                            ticker=symbol, name=name, shares=qty,
                            cost_per_share=price, total_cost=value,
                            broker="apex_clearing", as_of=as_of,
                            asset_type="stock", yf_ticker=yf,
                            last_price=price, current_value=value,
                        ))

    return results


# ── Empower PDF parser ────────────────────────────────────────────────────────

def parse_empower_pdf(pdf_bytes: bytes) -> list[dict]:
    """
    Parse Empower 401k quarterly statement PDF.
    Positions table (page 2-3):
      Fund Name  Beginning Balance  Deposits  Change in Value  Transfers  Withdrawals/Expenses  Ending Balance  Ending Units/Shares
    Section headers: AssetAllocation, InternationalFunds, MidCapFunds, LargeCapFunds etc.
    """
    import pdfplumber

    as_of   = date.today()
    results = []

    # Row pattern: fund name (may have spaces) then numbers
    # "BlackRock Retirement 0.00 452.68 22,190.38 22,643.06 2,219.038"
    # "S&P 500 Index Fund 19,160.54 -830.60 -12.95 18,316.99 1,091.961"
    row_re = re.compile(
        r"^(.+?)\s+([\d,]+\.\d+)\s+(-?[\d,]+\.\d+)\s+(-?[\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)$"
    )

    SECTION_HEADERS = {
        "AssetAllocation", "InternationalFunds", "MidCapFunds",
        "LargeCapFunds", "SmallCapFunds", "BondFunds", "StableValue"
    }

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = "\n".join(p.extract_text() or "" for p in pdf.pages)

        # As-of date: "Statement Period: 01/01/2026 - 03/31/2026"
        dm = re.search(r"Statement Period:\s*\S+\s*-\s*(\d{2}/\d{2}/\d{4})", full_text)
        if dm:
            try:
                as_of = datetime.strptime(dm.group(1), "%m/%d/%Y").date()
            except ValueError:
                pass

        # Step 1: collect raw lines between "How is my account invested?" and "What is my vested"
        raw_lines = []
        in_table  = False
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                line = line.strip()
                if "How is my account invested?" in line:
                    in_table = True
                    continue
                if in_table and ("What is my vested" in line or "What activity" in line):
                    in_table = False
                if in_table and line:
                    raw_lines.append(line)

        # Step 2: join continuation lines into complete fund rows
        # Data line: ends with shares (3 decimal places e.g. "2,219.038")
        # Continuation: name fragment on next line (no numbers), appended to fund name
        data_line_re = re.compile(r"([\d,]+\.\d{3})\s*$")
        skip_re = re.compile(r"^(ADDR-|THE 401|RUJAL|20730805|Totals|Ending|Beginning|How is|Balance Dep|\d+\.\d+%)")
        section_re = re.compile(r"^(AssetAllocation|InternationalFunds|MidCapFunds|LargeCapFunds|SmallCapFunds|BondFunds|StableValue)$")

        joined = []
        i = 0
        while i < len(raw_lines):
            line = raw_lines[i]
            if skip_re.match(line) or section_re.match(line.replace(" ","")):
                i += 1
                continue
            if data_line_re.search(line):
                # Check if next line is a name continuation (no numbers)
                suffix = ""
                if i + 1 < len(raw_lines):
                    nxt = raw_lines[i + 1]
                    if not re.search(r"[\d,]+\.\d+", nxt) and not skip_re.match(nxt) and not section_re.match(nxt.replace(" ","")):
                        suffix = " " + nxt.strip()
                        i += 1  # consume continuation line
                joined.append(line + suffix)
            i += 1

        # Step 3: parse each joined line
        # Format: [name parts...] begin deposits change transfers exp ending shares
        # We want: ending_balance (2nd to last number), shares (last number)
        parse_re = re.compile(r"^(.*?)\s+([\d,]+\.\d+)\s+(-?[\d,]+\.\d+)\s+(-?[\d,]+\.\d+)\s+(-?[\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d{3})$")
        for line in joined:
            m = parse_re.match(line)
            if m:
                name           = m.group(1).strip()
                ending_balance = _num(m.group(6))
                shares         = _num(m.group(7))
            else:
                # fallback: grab last two numbers
                nums = re.findall(r"-?[\d,]+\.\d+", line)
                if len(nums) < 2:
                    continue
                ending_balance = _num(nums[-2])
                shares         = _num(nums[-1])
                # name = everything before first number
                name = re.split(r"\s+[\d,]+\.\d+", line)[0].strip()

            if not name or not shares or shares == 0 or not ending_balance or ending_balance <= 0:
                continue

            # Clean up name — remove any leading numbers
            name = re.sub(r"^[\d,.\s]+", "", name).strip()
            if not name:
                continue

            results.append(_row(
                ticker=name[:20],
                name=name,
                shares=shares,
                cost_per_share=None,
                total_cost=ending_balance,
                broker="empower",
                as_of=as_of,
                asset_type="mutual_fund",
                last_price=None,
                current_value=ending_balance,
            ))

    return results


# ── NEPC BPAS 403 PDF parser ──────────────────────────────────────────────────

def parse_bpas_pdf(pdf_bytes: bytes) -> list[dict]:
    """
    Parse BPAS 403b statement PDF.
    Account Detail section has:
      Fund Name | Ticker | Category | Balance_start | Contributions | Earnings | ... | Balance_end | Shares
    Example: "FIDELITY CONTRAFUND 100% 9,167.39 3,029.52 297.13 0.00 0.00 -16.34 12,477.70 513.4856"
    """
    import pdfplumber

    as_of   = date.today()
    results = []

    # Pattern: FUND NAME [pct%] numbers... ending_balance shares
    row_re = re.compile(
        r"^([A-Z][A-Z &.]+?)\s+(?:\d+%\s+)?[\d,]+\.\d+(?:\s+-?[\d,]+\.\d+)+\s+([\d,]+\.\d{4})\s*$"
    )
    # Simpler: grab name + last two numbers (ending balance + shares)
    row_re2 = re.compile(
        r"^([A-Z][A-Z &.']+(?:\s+[A-Z0-9]+)*)\s+(?:\d+%\s+)?.+\s+([\d,]+\.\d+)\s+([\d,]+\.\d{4})$"
    )

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = "\n".join(p.extract_text() or "" for p in pdf.pages)

        # As-of: "As of 12/31/2025"
        dm = re.search(r"As of\s+(\d{1,2}/\d{1,2}/\d{4})", full_text)
        if dm:
            try:
                as_of = datetime.strptime(dm.group(1), "%m/%d/%Y").date()
            except ValueError:
                pass

        in_detail = False
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            for line in page_text.splitlines():
                line = line.strip()

                if "ACCOUNT DETAIL BY INVESTMENT" in line:
                    in_detail = True
                    continue
                if in_detail and "TOTAL INVESTMENTS" in line:
                    in_detail = False
                    continue
                if not in_detail or not line:
                    continue

                # Skip header rows
                if any(h in line for h in ["Category", "Investment Name", "Allocation", "Balance", "Contributions"]):
                    continue

                m = row_re2.match(line)
                if m:
                    # Strip leading category words (e.g. "EQUITY FIDELITY..." -> "FIDELITY...")
                    raw_name = m.group(1).strip()
                    name     = re.sub(r"^(EQUITY|BOND|STABLE VALUE|BALANCED)\s+", "", raw_name, flags=re.IGNORECASE).strip()
                    ending_balance = _num(m.group(2))
                    shares         = _num(m.group(3))

                    if not name or not shares or shares == 0:
                        continue

                    # Look up ticker from name
                    ticker_map = {
                        "FIDELITY CONTRAFUND": "FCNTX",
                        "AMERICAN FUNDS EUPAC": "RERGX",
                        "MFS VALUE": "MEIKX",
                        "PIMCO REAL RETURN": "PRRIX",
                        "PIMCO TOTAL RETURN": "PTTRX",
                        "T. ROWE PRICE ALL-CAP": "PNAIX",
                        "VANGUARD 500 INDEX": "VFIAX",
                        "VANGUARD DEV MKTS": "VTMGX",
                        "VANGUARD EMG MKTS": "VEMAX",
                    }
                    ticker = next((v for k, v in ticker_map.items() if k in name.upper()), name[:8].upper())

                    results.append(_row(
                        ticker=ticker,
                        name=name,
                        shares=shares,
                        cost_per_share=None,
                        total_cost=ending_balance,
                        broker="bpas",
                        as_of=as_of,
                        asset_type="mutual_fund",
                        last_price=None,
                        current_value=ending_balance,
                    ))

    return results


def parse_vanguard(content: str) -> list[dict]:
    """
    Vanguard CSV export — two sections separated by blank line.
    First section = positions (Account Number, Investment Name, Symbol, Shares, Share Price, Total Value)
    Second section = transactions — skip entirely.
    """
    import csv, io
    from datetime import date

    results = []
    lines = content.splitlines()

    # Find the positions header line
    pos_start = None
    for i, line in enumerate(lines):
        if line.startswith("Account Number,Investment Name,Symbol,Shares,Share Price"):
            pos_start = i
            break

    if pos_start is None:
        return results

    # Read rows until blank line (end of positions section)
    pos_lines = []
    for line in lines[pos_start:]:
        if line.strip() == "":
            break
        pos_lines.append(line)

    reader = csv.DictReader(io.StringIO("\n".join(pos_lines)))
    today = date.today()

    for row in reader:
        symbol = (row.get("Symbol") or "").strip()
        name   = (row.get("Investment Name") or "").strip()
        shares = _num(row.get("Shares"))
        price  = _num(row.get("Share Price"))
        value  = _num(row.get("Total Value"))

        if not symbol or shares is None:
            continue
        if _should_skip(symbol, shares):
            continue

        yf = _yf_ticker(symbol)
        asset_type = "money_market" if symbol in ("VMFXX", "VMRXX", "VMMXX") else "etf"

        results.append(_row(
            ticker=symbol,
            name=name,
            shares=shares,
            cost_per_share=price,
            total_cost=value,
            broker="vanguard",
            as_of=today,
            asset_type=asset_type,
            yf_ticker=yf,
            last_price=price,
            current_value=value,
        ))

    return results


def parse_holdings(filename: str, content: bytes) -> list[dict]:
    """
    Route to correct parser based on filename and content.
    Returns normalized list of holding dicts ready for DB insert.
    """
    fname = filename.lower()

    if fname.endswith(".pdf"):
        if "robinhood" in fname:
            return parse_robinhood_pdf(content)
        if "empower" in fname or "aegis" in fname or "401k" in fname.replace(" ", ""):
            return parse_empower_pdf(content)
        if "bpas" in fname or "nepc" in fname or "403" in fname:
            return parse_bpas_pdf(content)
        if "ally" in fname or "apex" in fname or "statement" in fname:
            return parse_apex_clearing_pdf(content)
        return parse_empower_pdf(content)  # fallback

    text       = content.decode("utf-8", errors="replace")
    sample     = text.lstrip('\ufeff')
    first_line = sample.splitlines()[0] if sample.splitlines() else ""
    headers    = first_line.split(",")
    broker     = detect_broker(headers)

    if broker == "betterment":
        return parse_betterment(sample)
    elif broker == "fidelity":
        return parse_fidelity(sample)
    elif broker == "m1":
        return parse_m1(sample)
    elif broker == "vanguard":
        return parse_vanguard(sample)
    else:
        raise ValueError(f"Unsupported broker: {broker}")


# ── Holdings hash (for analysis cache invalidation) ───────────────────────────

def compute_holdings_hash(holdings: list[dict]) -> str:
    key = "|".join(
        f"{h['ticker']}:{h['shares']:.4f}"
        for h in sorted(holdings, key=lambda x: x['ticker'])
    )
    return hashlib.md5(key.encode()).hexdigest()
