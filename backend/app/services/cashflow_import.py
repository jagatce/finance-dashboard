import io
import csv
from datetime import datetime
from typing import List, Dict, Any


def detect_bank(headers: List[str]) -> str:
    h = [x.strip().lower() for x in headers]
    if "transaction date" in h and "post date" in h:
        return "chase"
    if "date" in h and "description" in h and "card member" in h:
        return "amex"
    if "date" in h and "description" in h and "running bal." in h:
        return "bofa"
    return "unknown"


def _parse_amount(val: str) -> float:
    """Strip $, commas, spaces and convert to float."""
    return float(val.replace("$", "").replace(",", "").strip())


def _parse_date(val: str) -> str:
    """Normalize date to YYYY-MM-DD."""
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
            # Chase: negative = expense, positive = payment/credit
            if amount >= 0:
                continue  # skip credits/payments
            out.append({
                "transaction_date": _parse_date(r.get("Transaction Date", "")),
                "posted_date":      _parse_date(r.get("Post Date", "")),
                "description":      r.get("Description", "").strip(),
                "merchant":         r.get("Description", "").strip(),
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
            # Amex: positive = expense, negative = credit
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


def _parse_bofa(rows: List[Dict]) -> List[Dict]:
    out = []
    for r in rows:
        try:
            amount = _parse_amount(r.get("Amount", "0"))
            # BofA: negative = expense
            if amount >= 0:
                continue
            out.append({
                "transaction_date": _parse_date(r.get("Date", "")),
                "posted_date":      None,
                "description":      r.get("Description", "").strip(),
                "merchant":         r.get("Description", "").strip(),
                "amount":           abs(amount),
                "category":         None,
                "source":           "bofa",
            })
        except (ValueError, KeyError):
            continue
    return out


def parse_transactions(filename: str, content: bytes) -> Dict[str, Any]:
    """
    Main entry point. Returns:
      { bank: str, transactions: List[dict], error: str|None }
    """
    try:
        text = content.decode("utf-8-sig")  # strip BOM (Fidelity-style)
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
        if not rows:
            return {"bank": "unknown", "transactions": [], "error": "Empty file"}

        headers = list(rows[0].keys())
        bank = detect_bank(headers)

        if bank == "chase":
            txns = _parse_chase(rows)
        elif bank == "amex":
            txns = _parse_amex(rows)
        elif bank == "bofa":
            txns = _parse_bofa(rows)
        else:
            return {"bank": "unknown", "transactions": [], "error": f"Unrecognized CSV format. Headers: {headers}"}

        return {"bank": bank, "transactions": txns, "error": None}

    except Exception as e:
        return {"bank": "unknown", "transactions": [], "error": str(e)}
