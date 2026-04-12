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
         broker, as_of, asset_type="etf", yf_ticker=None):
    t = ticker.strip() if ticker else ticker
    return {
        "ticker":               t,
        "name":                 name,
        "shares":               shares,
        "cost_basis_per_share": cost_per_share,
        "total_cost_basis":     total_cost,
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
        symbol = row.get("Symbol", "").strip()
        qty    = _num(row.get("Shares"))
        cost   = _num(row.get("CostBasis"))

        if not symbol or qty is None:
            continue

        if symbol not in lots:
            lots[symbol] = {"shares": 0.0, "total_cost": 0.0}
        lots[symbol]["shares"]     += qty
        lots[symbol]["total_cost"] += (cost or 0.0)

    results = []
    today   = date.today()
    for ticker, agg in lots.items():
        shares     = agg["shares"]
        total_cost = agg["total_cost"]
        cost_per   = (total_cost / shares) if shares > 0 else None
        results.append(_row(
            ticker         = ticker,
            name           = None,
            shares         = shares,
            cost_per_share = cost_per,
            total_cost     = total_cost,
            broker         = "betterment",
            as_of          = today,
            asset_type     = "etf",
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
        symbol   = (row.get("Symbol") or "").strip().rstrip("*")
        desc     = (row.get("Description") or "").strip()
        qty      = _num(row.get("Quantity"))
        avg_cost = _num(row.get("Average Cost Basis"))
        tot_cost = _num(row.get("Cost Basis Total"))

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

        results.append(_row(
            ticker         = symbol,
            name           = name,
            shares         = qty,
            cost_per_share = avg_price,
            total_cost     = tot_cost,
            broker         = "m1",
            as_of          = today,
            asset_type     = "stock",
        ))

    return results


# ── Empower PDF parser ────────────────────────────────────────────────────────

def parse_empower_pdf(pdf_bytes: bytes) -> list[dict]:
    import pdfplumber

    as_of   = date.today()
    results = []

    SKIP_NAMES = {
        "US DOLLARS AND MONEY FUND SWEEPS",
        "Total Cash and Cash Equivalents",
        "Total Equity", "Total Fixed Income", "Total Account",
        "Cash and Cash Equivalents", "Equity", "Fixed Income",
        "Account Type: Individual",
    }

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
                for row in table:
                    if not row or len(row) < 4:
                        continue
                    cells = [str(c).strip() if c else "" for c in row]
                    name  = cells[0] if cells else ""

                    if name in SKIP_NAMES or not name:
                        continue
                    if name.startswith("Account Holdings"):
                        continue
                    if name.startswith("Report Legend"):
                        continue

                    symbol = None
                    qty    = None

                    for cell in cells[1:]:
                        cell_clean = cell.strip()
                        if re.match(r'^[A-Z]{2,5}$', cell_clean) and not symbol:
                            symbol = cell_clean
                        elif symbol and qty is None:
                            q = _num(cell_clean)
                            if q is not None and q > 0:
                                qty = q

                    if not symbol or qty is None:
                        continue
                    if symbol in SKIP_SYMBOLS:
                        continue

                    results.append(_row(
                        ticker         = symbol,
                        name           = name,
                        shares         = qty,
                        cost_per_share = None,
                        total_cost     = None,
                        broker         = "empower",
                        as_of          = as_of,
                        asset_type     = "etf",
                    ))

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
    Parse Robinhood monthly statement PDF using text extraction.
    No tables in Robinhood PDFs - data is raw text.
    Pattern per holding:
      Line 1: Company Name
      Line 2: TICKER  Margin|Cash  qty  $price  $mktval ...
    Handles multi-account PDFs (e.g. Traditional + Roth in one file).
    Skips accounts with $0 closing portfolio value.
    As-of date: end date from MM/DD/YYYY to MM/DD/YYYY header.
    """
    import pdfplumber

    as_of      = date.today()
    results    = []
    holding_re = re.compile(
        r"^([A-Z]{1,5})\s+(Margin|Cash)\s+([\d,]+\.?\d*)\s+\$[\d,]+\.\d+"
    )

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        # Extract all text once
        all_pages_text = [p.extract_text() or "" for p in pdf.pages]
        full_text      = "\n".join(all_pages_text)

        # As-of date from: "03/01/2026 to 03/31/2026"
        dm = re.search(r"\d{2}/\d{2}/\d{4}\s+to\s+(\d{2}/\d{2}/\d{4})", full_text)
        if dm:
            try:
                as_of = datetime.strptime(dm.group(1), "%m/%d/%Y").date()
            except ValueError:
                pass

        # Track which portfolio sections are non-empty
        # Find all closing portfolio values — multi-account PDFs have multiple
        # We process page by page and skip sections where portfolio value is $0
        in_holdings      = False
        current_nonempty = True
        prev_line        = ""

        for page_text in all_pages_text:
            lines = page_text.splitlines()
            for line in lines:
                line = line.strip()
                if not line:
                    continue

                # Detect account section boundary — check portfolio value
                pv = re.search(
                    r"Portfolio Value\s+\$[\d,]+\.\d{2}\s+\$([\d,]+\.\d{2})",
                    line
                )
                if pv:
                    closing          = float(pv.group(1).replace(",", ""))
                    current_nonempty = closing > 0.0
                    in_holdings      = False
                    prev_line        = ""
                    continue

                if "Securities Held in Account" in line:
                    if current_nonempty:
                        in_holdings = True
                    prev_line = ""
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

                if (line.startswith("Sym/Cusip") or
                        line.startswith("Estimated Yield") or
                        line.startswith("Page ")):
                    continue

                m = holding_re.match(line)
                if m:
                    symbol = m.group(1)
                    qty    = _num(m.group(3))
                    name   = prev_line if prev_line and not holding_re.match(prev_line) else symbol

                    if symbol not in SKIP_SYMBOLS and not _is_cusip(symbol) and qty and qty > 0:
                        results.append(_row(
                            ticker         = symbol,
                            name           = name,
                            shares         = qty,
                            cost_per_share = None,
                            total_cost     = None,
                            broker         = "robinhood",
                            as_of          = as_of,
                            asset_type     = "stock",
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

def parse_holdings(filename: str, content: bytes) -> list[dict]:
    """
    Route to correct parser based on filename and content.
    Returns normalized list of holding dicts ready for DB insert.
    """
    fname = filename.lower()

    if fname.endswith(".pdf"):
        if "robinhood" in fname:
            return parse_robinhood_pdf(content)
        return parse_empower_pdf(content)

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
    else:
        raise ValueError(f"Unsupported broker: {broker}")


# ── Holdings hash (for analysis cache invalidation) ───────────────────────────

def compute_holdings_hash(holdings: list[dict]) -> str:
    key = "|".join(
        f"{h['ticker']}:{h['shares']:.4f}"
        for h in sorted(holdings, key=lambda x: x['ticker'])
    )
    return hashlib.md5(key.encode()).hexdigest()
