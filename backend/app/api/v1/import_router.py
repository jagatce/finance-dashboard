"""
/api/v1/import — folder-based import

GET  /api/v1/import/scan                  — scan disk, return per-file statuses
POST /api/v1/import/run                   — import selected files
GET  /api/v1/import/batches               — all batches with folder metadata
POST /api/v1/import/batches/{id}/rerun    — force re-import a previously imported file
"""
import pathlib, datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_auth
from app.services.folder_scanner import scan_all, ScannedFile
from app.models.models import ImportBatch, Transaction, Holding, IncomeEntry, gen_uuid

router = APIRouter(prefix="/api/v1/import", tags=["import"])


def _auto_categorize(transactions: list[dict]) -> list[dict]:
    """Call Claude to categorize transactions in one batch. Returns transactions with category/subcategory/is_recurring set."""
    import os, json, anthropic

    if not transactions:
        return transactions

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return transactions

    categories = [
        "Groceries", "Dining", "Transport", "Gas", "Shopping",
        "Entertainment", "Subscriptions", "Health", "Travel",
        "Utilities", "Insurance", "Rent/Mortgage", "Education",
        "Personal Care", "Gifts", "Income", "Other"
    ]

    descriptions = [t.get("description", "") for t in transactions]

    prompt = f"""You are categorizing personal finance transactions.
Given these transaction descriptions, suggest a category and subcategory for each.
Also flag if it looks like a recurring subscription (is_recurring: true/false).

Available categories: {", ".join(categories)}

Transactions:
{chr(10).join(f"{i+1}. {d}" for i, d in enumerate(descriptions))}

Respond ONLY with a JSON array, one object per transaction, in order:
[{{"description": "...", "category": "...", "subcategory": "...", "is_recurring": false}}, ...]
No markdown, no explanation, just the JSON array."""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = message.content[0].text.strip()
        suggestions = json.loads(raw)
        for i, t in enumerate(transactions):
            if i < len(suggestions):
                s = suggestions[i]
                t["category"]     = s.get("category") or t.get("category")
                t["subcategory"]  = s.get("subcategory")
                t["is_recurring"] = bool(s.get("is_recurring", False))
    except Exception as e:
        print(f"Auto-categorize failed (non-fatal): {e}")

    return transactions


# ── serialization ─────────────────────────────────────────────────────────────

def _file_dict(f: ScannedFile) -> dict:
    stat = f.path.stat()
    return {
        "path":         str(f.path),
        "filename":     f.path.name,
        "folder_name":  f.folder_name,
        "account_id":   f.account_id,
        "account_name": f.account_name,
        "file_hash":    f.file_hash,
        "status":       f.status,
        "batch_id":     f.batch_id,
        "import_type":  f.import_type,
        "size_bytes":   stat.st_size,
        "modified_at":  datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(),
    }


# ── GET /scan ──────────────────────────────────────────────────────────────────

@router.get("/scan")
def scan_folders(db: Session = Depends(get_db), _=Depends(require_auth)):
    result = scan_all(db)
    return {
        "data_root":     result["data_root"],
        "folders_exist": result["folders_exist"],
        "spending":      [_file_dict(f) for f in result["spending"]],
        "holdings":      [_file_dict(f) for f in result["holdings"]],
        "summary":       result["summary"],
    }


# ── POST /run ──────────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    files: list[str]
    force_reimport: bool = False


@router.post("/run")
def run_import(req: RunRequest, db: Session = Depends(get_db), _=Depends(require_auth)):
    scan = scan_all(db)
    by_path: dict[str, ScannedFile] = {
        str(f.path): f
        for f in scan["spending"] + scan["holdings"]
    }

    results = []
    for path_str in req.files:
        f = by_path.get(path_str)
        if not f:
            results.append({"path": path_str, "ok": False, "error": "not found in scan"})
            continue
        if f.status == "unknown_folder":
            results.append({"path": path_str, "ok": False,
                            "error": f"folder '{f.folder_name}' has no matching account"})
            continue
        if f.status == "imported" and not req.force_reimport:
            results.append({"path": path_str, "ok": False,
                            "error": "already imported", "batch_id": f.batch_id})
            continue
        try:
            raw = f.path.read_bytes()
            if f.import_type == "spending":
                batch_id, count, errors = _do_spending(f, raw, db, req.force_reimport)
            else:
                batch_id, count, errors = _do_holdings(f, raw, db, req.force_reimport)
            results.append({
                "path": path_str, "ok": True,
                "batch_id": batch_id, "rows_imported": count, "errors": errors,
            })
        except Exception as e:
            db.rollback()
            results.append({"path": path_str, "ok": False, "error": str(e)})

    return {"results": results}


# ── spending import ────────────────────────────────────────────────────────────

def _do_spending(f: ScannedFile, raw: bytes, db: Session, force: bool):
    from app.services.cashflow_import import parse_transactions

    # If force re-import, delete old batch + its transactions/income rows
    if force and f.batch_id:
        db.query(Transaction).filter(Transaction.batch_id == f.batch_id).delete()
        db.query(IncomeEntry).filter(IncomeEntry.batch_id == f.batch_id).delete()
        db.query(ImportBatch).filter(ImportBatch.id == f.batch_id).delete()
        db.commit()

    parsed = parse_transactions(f.path.name, raw)

    if parsed.get("error"):
        return None, 0, [parsed["error"]]

    bank         = parsed.get("bank", "unknown")
    transactions = parsed.get("transactions", [])
    income_rows  = parsed.get("income", [])

    # Auto-categorize spending transactions via Claude (one API call, non-fatal)
    transactions = _auto_categorize(transactions)

    batch_id = gen_uuid()
    batch = ImportBatch(
        id=batch_id,
        source_type="spending",
        filename=f.path.name,
        bank=bank,
        account_id=str(f.account_id),
        account_name=f.account_name,
        row_count=len(transactions) + len(income_rows),
        income_count=len(income_rows),
        file_hash=f.file_hash,
        folder_path=str(f.path.parent),
        imported_at=datetime.datetime.utcnow(),
    )
    db.add(batch)
    try:
        db.flush()
    except Exception as e:
        db.rollback()
        raise

    # Valid Transaction columns — strip anything parse_transactions adds that isn't in the model
    valid_cols = {
        "id", "account_id", "transaction_date", "posted_date", "description",
        "amount", "category", "subcategory", "merchant", "notes", "created_at",
        "owner_id", "source", "is_recurring", "batch_id"
    }
    for row in transactions:
        row["batch_id"]   = batch_id
        row["account_id"] = str(f.account_id)
        # Strip unknown keys
        for k in list(row.keys()):
            if k not in valid_cols:
                row.pop(k)
        for datecol in ("transaction_date", "posted_date"):
            val = row.get(datecol)
            if isinstance(val, str) and val:
                import datetime as dt
                row[datecol] = dt.datetime.strptime(val, "%Y-%m-%d").date()
        db.add(Transaction(**row))

    # BofA income rows -> income_transactions table (raw SQL, matches cashflow.py pattern)
    import uuid
    from sqlalchemy import text as sql_text
    for inc in income_rows:
        db.execute(sql_text("""
            INSERT INTO income_transactions
              (id, owner_id, date, source_name, income_type, amount, notes, created_at)
            VALUES
              (:id, :owner_id, :date, :source_name, :income_type, :amount, :notes, :created_at)
        """), {
            "id":          str(uuid.uuid4()),
            "owner_id":    inc.get("owner_id") or inc.get("owner_hint") or "unknown",
            "date":        inc.get("transaction_date", ""),
            "source_name": inc.get("description", ""),
            "income_type": inc.get("income_type", "other"),
            "amount":      float(inc.get("amount", 0)),
            "notes":       inc.get("full_description"),
            "created_at":  datetime.datetime.utcnow().isoformat(),
        })

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise
    return batch_id, len(transactions) + len(income_rows), []


# ── holdings import ────────────────────────────────────────────────────────────

def _do_holdings(f: ScannedFile, raw: bytes, db: Session, force: bool):
    from app.services.holdings_import import parse_holdings, detect_broker

    # If force re-import, wipe old batch + holdings for this account
    if force and f.batch_id:
        db.query(ImportBatch).filter(ImportBatch.id == f.batch_id).delete()
        db.commit()

    # Always replace holdings for this account (latest file = source of truth)
    db.query(Holding).filter(Holding.account_id == str(f.account_id)).delete()

    holdings_rows = parse_holdings(f.path.name, raw)

    # detect_broker needs headers — derive broker from filename via parse_holdings internals
    # parse_holdings already sets asset_type per row; use filename to get broker name
    import csv, io
    try:
        text = raw.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        headers = reader.fieldnames or []
        broker = detect_broker(headers)
    except Exception:
        broker = "unknown"

    batch_id = gen_uuid()
    batch = ImportBatch(
        id=batch_id,
        source_type="holdings",
        filename=f.path.name,
        bank=broker,
        account_id=str(f.account_id),
        account_name=f.account_name,
        row_count=len(holdings_rows),
        income_count=0,
        file_hash=f.file_hash,
        folder_path=str(f.path.parent),
        imported_at=datetime.datetime.utcnow(),
    )
    db.add(batch)
    db.flush()

    for h in holdings_rows:
        h["account_id"] = str(f.account_id)
        h["batch_id"]   = batch_id
        db.add(Holding(**h))

    db.commit()
    return batch_id, len(holdings_rows), []


# ── GET /batches ───────────────────────────────────────────────────────────────

@router.get("/batches")
def get_batches(db: Session = Depends(get_db), _=Depends(require_auth)):
    batches = (
        db.query(ImportBatch)
        .order_by(ImportBatch.imported_at.desc())
        .all()
    )
    return [
        {
            "id":           b.id,
            "source_type":  b.source_type,
            "filename":     b.filename,
            "bank":         b.bank,
            "account_id":   b.account_id,
            "account_name": b.account_name,
            "row_count":    b.row_count,
            "income_count": b.income_count,
            "file_hash":    b.file_hash,
            "folder_path":  b.folder_path,
            "imported_at":  b.imported_at.isoformat() if b.imported_at else None,
        }
        for b in batches
    ]


# ── POST /batches/{id}/rerun ───────────────────────────────────────────────────

@router.post("/batches/{batch_id}/rerun")
def rerun_batch(batch_id: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    batch = db.query(ImportBatch).filter(ImportBatch.id == batch_id).first()
    if not batch or not batch.folder_path:
        raise HTTPException(404, "batch not found or missing folder_path")
    fp = pathlib.Path(batch.folder_path) / batch.filename
    if not fp.exists():
        raise HTTPException(404, f"file no longer on disk: {fp}")
    req = RunRequest(files=[str(fp)], force_reimport=True)
    return run_import(req, db)
