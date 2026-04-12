"""
Holdings CSV/PDF import service.
Supports: Betterment, Fidelity (all variants), M1 Finance, Empower (PDF).
Returns a list of normalized dicts — no DB writes here, caller does that.
"""
import csv
import io
import re
import hashlib
from datetime import date, datetime
from typing import Optional


# ── Numeric cleaning ──────────────────────────────────────────────────────────

def _num(val) -> Optional[float]:
    """Strip $, +, commas, %, handle --, empty, None."""
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
    """Normalize ticker for yfinance. BRK.B -> BRK-B."""
    if not ticker:
        return None
    return ticker.strip().replace(".", "-")

def _is_cusip(symbol: str) -> bool:
    """9-char alphanumeric = CUSIP, not a tradeable ticker."""
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
    # Skip rows with no quantity (money market rows)
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
    """Extract as-of date from Fidelity footer: 'Date downloaded Apr-12-2026'"""
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
    """
    Lot-level export — aggregate lots by ticker.
    Columns: Account, Account #, Symbol, Shares, PurchaseDate,
             MarketValue, CostBasis, $UnrealizedGain/Loss, %UnrealizedGain/Loss
    """
    reader = csv.DictReader(io.StringIO(content))
    lots: dict[str, dict] = {}  # ticker -> aggregated

    for row in reader:
        symbol = row.get("Symbol", "").strip()
        qty    = _num(row.get("Shares"))
        cost   = _num(row.get("CostBasis"))
        name   = row.get("Account", "").strip()

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
            ticker     = ticker,
            name       = None,
            shares     = shares,
            cost_per_share = cost_per,
            total_cost = total_cost,
            broker     = "betterment",
            as_of      = today,
            asset_type = "etf",
        ))
    return results


# ── Fidelity parser ───────────────────────────────────────────────────────────

def parse_fidelity(content: str) -> list[dict]:
    """
    Position-level. Handles all Fidelity account types:
    - Standard: tickers, skip FDRXX** etc.
    - Dell 401k: no tickers, description-only funds
    - SNPS 401k: mix of tickers and CUSIPs, skip BROKERAGELINK
    Footer disclaimer rows are skipped.
    Columns: Account Number, Account Name, Symbol, Description, Quantity,
             Last Price, Last Price Change, Current Value, ...,
             Cost Basis Total, Average Cost Basis, Type
    """
    # Strip BOM
    content  = content.lstrip('\ufeff')
    as_of    = _fidelity_date(content)
    results  = []

    # Split into lines, parse only header + data rows (stop at footer)
    lines    = content.splitlines()
    data_lines = []
    for line in lines:
        stripped = line.strip()
        # Footer rows start with a quote and contain disclaimer text
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

        # Skip money market and special rows
        if _should_skip(symbol or desc, row.get("Quantity")):
            continue

        # Skip BROKERAGELINK pointer row (actual positions in separate file)
        if symbol.upper() == "BROKERAGELINK":
            continue

        # Dell-style: no ticker symbol, only description
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
                yf_ticker      = None,  # no yfinance lookup
            ))
            continue

        # CUSIP in symbol column
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
                yf_ticker      = None,  # no yfinance lookup
            ))
            continue

        # Normal ticker
        results.append(_row(
            ticker         = symbol,
            name           = desc,
            shares         = qty or 0.0,
            cost_per_share = avg_cost,
            total_cost     = tot_cost,
            broker         = "fidelity",
            as_of          = as_of,
            asset_type     = "etf",   # yfinance will refine this
        ))

    return results


# ── M1 Finance parser ─────────────────────────────────────────────────────────

def parse_m1(content: str) -> list[dict]:
    """
    Position-level, clean.
    Columns: Symbol, Name, Quantity, Avg. Price, Cost Basis,
             Unrealized Gain ($), Unrealized Gain (%), Value
    """
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
            asset_type     = "stock",  # yfinance will refine
        ))

    return results


# ── Empower PDF parser ────────────────────────────────────────────────────────

def parse_empower_pdf(pdf_bytes: bytes) -> list[dict]:
    """
    Parse Empower monthly report PDF.
    Extracts holdings table from Account Holdings pages.
    Columns in PDF: Name | Symbol | Price | Quantity | Market Value | % of Account
    No cost basis available in Empower reports.
    as_of_date extracted from PDF header: 'As of Date :MM/DD/YYYY'
    """
    import pdfplumber

    as_of   = date.today()
    results = []

    # Skip these pseudo-rows
    SKIP_NAMES = {
        "US DOLLARS AND MONEY FUND SWEEPS",
        "Total Cash and Cash Equivalents",
        "Total Equity",
        "Total Fixed Income",
        "Total Account",
        "Cash and Cash Equivalents",
        "Equity",
        "Fixed Income",
        "Account Type: Individual",
    }

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = ""
        for page in pdf.pages:
            full_text += (page.extract_text() or "") + "\n"

        # Extract as-of date from header text
        m = re.search(r'As of Date\s*:?\s*(\d{2}/\d{2}/\d{4})', full_text)
        if m:
            try:
                as_of = datetime.strptime(m.group(1), "%m/%d/%Y").date()
            except ValueError:
                pass

        # Parse tables from all pages
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    if not row or len(row) < 4:
                        continue

                    # Clean all cells
                    cells = [str(c).strip() if c else "" for c in row]

                    # Try to find symbol and quantity
                    # Empower table layout: Name | Symbol | Price | Quantity | MV | %
                    # Symbol is typically 2-5 uppercase letters
                    symbol = None
                    qty    = None
                    name   = cells[0] if cells else ""

                    # Skip header/total rows
                    if name in SKIP_NAMES or not name:
                        continue
                    if name.startswith("Account Holdings"):
                        continue
                    if name.startswith("Report Legend"):
                        continue

                    # Find symbol in row (2-5 uppercase letters)
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
                        cost_per_share = None,   # not in Empower reports
                        total_cost     = None,
                        broker         = "empower",
                        as_of          = as_of,
                        asset_type     = "etf",
                    ))

    # Deduplicate by ticker (PDF may have same ticker on multiple pages)
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
    Route to correct parser based on filename extension and content.
    Returns normalized list of holding dicts ready for DB insert.
    """
    fname = filename.lower()

    # PDF -> Empower
    if fname.endswith(".pdf"):
        return parse_empower_pdf(content)

    # CSV -> detect broker from headers
    text    = content.decode("utf-8", errors="replace")
    # Strip BOM for header detection
    sample  = text.lstrip('\ufeff')
    first_line = sample.splitlines()[0] if sample.splitlines() else ""
    headers    = first_line.split(",")

    broker = detect_broker(headers)

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
    """MD5 of sorted ticker+shares — detects when portfolio changed."""
    key = "|".join(
        f"{h['ticker']}:{h['shares']:.4f}"
        for h in sorted(holdings, key=lambda x: x['ticker'])
    )
    return hashlib.md5(key.encode()).hexdigest()
