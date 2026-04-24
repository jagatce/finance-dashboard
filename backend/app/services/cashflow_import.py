import io
import csv
import html
import re
from datetime import datetime
from typing import List, Dict, Any


def detect_bank(headers: List[str]) -> str:
    h = [x.strip().lower() for x in headers]
    if "transaction date" in h and "post date" in h:
        return "chase"
    if "running bal." in h or "running bal" in h:
        return "bofa"
    if sorted(h) == sorted(["date", "description", "amount"]):
        return "amex"
    if "date" in h and "description" in h and "card member" in h:
        return "amex"
    return "unknown"


def _parse_amount(val: str) -> float:
    return float(val.replace("$", "").replace(",", "").strip())


def _parse_date(val: str) -> str:
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(val.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return val.strip()


def _parse_chase(rows: List[Dict]) -> List[Dict]:
    out = []
    for r in rows:
        try:
            amount = _parse_amount(r.get("Amount", "0"))
            if amount >= 0:
                continue
            out.append({
                "transaction_date": _parse_date(r.get("Transaction Date", "")),
                "posted_date":      _parse_date(r.get("Post Date", "")),
                "description":      html.unescape(r.get("Description", "").strip()),
                "merchant":         html.unescape(r.get("Description", "").strip()),
                "amount":           abs(amount),
                "category":         r.get("Category", "").strip() or None,
                "source":           "chase",
            })
        except (ValueError, KeyError):
            continue
    return out


def _parse_amex(rows: List[Dict]) -> List[Dict]:
    out = []
    for r in rows:
        try:
            amount = _parse_amount(r.get("Amount", "0"))
            if amount <= 0:
                continue
            out.append({
                "transaction_date": _parse_date(r.get("Date", "")),
                "posted_date":      None,
                "description":      r.get("Description", "").strip(),
                "merchant":         r.get("Description", "").strip(),
                "amount":           amount,
                "category":         r.get("Category", "").strip() or None,
                "source":           "amex",
            })
        except (ValueError, KeyError):
            continue
    return out


# BofA income signals
BOFA_INCOME_SIGNALS = [
    "PAYROLL", "DES:PAYROLL", "DEPOSIT", "Interest Earned",
    "TIMBERLAND ACH", "SRECTRADE", "PREFERRED THERAP",
]

# BofA skip signals — internal transfers, credit card payments
BOFA_SKIP_SIGNALS = [
    "AMERICAN EXPRESS", "CHASE CREDIT CRD", "UNFCU DES:CK-WTH",
    "Beginning balance",
]

# Owner name fragments in BofA INDN: field
# Format: "INDN:PAREKH" or "INDN:KANSARA" embedded in description
# Maps to actual owner_id UUIDs from owners table
BOFA_OWNER_HINTS = [
    ("PAREKH",  "501d5d96-33df-40b6-b11d-ce04ba7ba894"),
    ("KANSARA", "90d343ea-7c82-496f-89f7-ebefad9a8324"),
]

# Income type detection from description keywords
BOFA_INCOME_TYPE_HINTS = [
    ("PAYROLL",    "salary"),
    ("DES:PAYROLL","salary"),
    ("DEPOSIT",    "other"),
    ("Interest",   "dividend"),
    ("TIMBERLAND", "other"),
    ("SRECTRADE",  "dividend"),
    ("PREFERRED THERAP", "salary"),
]


def _is_bofa_income(desc: str) -> bool:
    d = desc.upper()
    return any(s.upper() in d for s in BOFA_INCOME_SIGNALS)


def _is_bofa_skip(desc: str) -> bool:
    d = desc.upper()
    return any(s.upper() in d for s in BOFA_SKIP_SIGNALS)


def _detect_owner_hint(desc: str) -> str:
    """Return owner label hint from INDN: field, or empty string."""
    for fragment, label in BOFA_OWNER_HINTS:
        if fragment.upper() in desc.upper():
            return label
    return ""


def _detect_income_type(desc: str) -> str:
    for keyword, itype in BOFA_INCOME_TYPE_HINTS:
        if keyword.upper() in desc.upper():
            return itype
    return "other"


def _clean_bofa_description(desc: str) -> str:
    """Shorten BofA ACH descriptions — extract the institution name only."""
    # Extract just the company name before DES: or ID:
    match = re.match(r"^([A-Z0-9 &.,*/-]+?)\s+DES:", desc)
    if match:
        return match.group(1).strip().title()
    return desc


def _parse_bofa(rows: List[Dict]) -> List[Dict]:
    spending = []
    income = []
    for r in rows:
        raw_amt = r.get("Amount", "").strip()
        if not raw_amt:
            continue
        try:
            amount = _parse_amount(raw_amt)
        except (ValueError, KeyError):
            continue

        # Filter noise — amounts under $1
        if abs(amount) < 1.0:
            continue

        desc = r.get("Description", "").strip()
        date = r.get("Date", "").strip()
        if not date or not desc:
            continue

        if _is_bofa_skip(desc):
            continue

        clean_desc = _clean_bofa_description(desc)

        if amount > 0 and _is_bofa_income(desc):
            income.append({
                "transaction_date": _parse_date(date),
                "description":      clean_desc,
                "full_description": desc,
                "amount":           amount,
                "source":           "bofa",
                "income_type":      _detect_income_type(desc),
                "owner_hint":       _detect_owner_hint(desc),
                "_row_type":        "income",
            })
        elif amount < 0:
            spending.append({
                "transaction_date": _parse_date(date),
                "posted_date":      None,
                "description":      clean_desc,
                "full_description": desc,
                "merchant":         clean_desc,
                "amount":           abs(amount),
                "category":         None,
                "source":           "bofa",
                "_row_type":        "spending",
            })
    return spending + income


def parse_transactions(filename: str, content: bytes) -> Dict[str, Any]:
    """
    Main entry point. Returns:
      { bank, transactions: List[dict], income: List[dict], error }
    BofA returns both transactions (spending) and income separately.
    Chase and Amex return only transactions (spending), income is empty.
    """
    try:
        text = content.decode("utf-8-sig")

        # BofA has a summary block before real data — skip to Date, header
        lines = text.splitlines()
        start = 0
        for i, line in enumerate(lines):
            if line.startswith("Date,"):
                start = i
                break
        text = "\n".join(lines[start:])

        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
        if not rows:
            return {"bank": "unknown", "transactions": [], "income": [], "error": "Empty file"}

        headers = list(rows[0].keys())
        bank = detect_bank(headers)

        if bank == "chase":
            txns = _parse_chase(rows)
            return {"bank": bank, "transactions": txns, "income": [], "error": None}
        elif bank == "amex":
            txns = _parse_amex(rows)
            return {"bank": bank, "transactions": txns, "income": [], "error": None}
        elif bank == "bofa":
            all_rows = _parse_bofa(rows)
            income = [t for t in all_rows if t.get("_row_type") == "income"]
            txns   = [t for t in all_rows if t.get("_row_type") == "spending"]
            for t in income + txns:
                t.pop("_row_type", None)
            return {"bank": bank, "transactions": txns, "income": income, "error": None}
        else:
            return {
                "bank": "unknown", "transactions": [], "income": [],
                "error": f"Unrecognized CSV format. Headers: {headers}"
            }

    except Exception as e:
        return {"bank": "unknown", "transactions": [], "income": [], "error": str(e)}
