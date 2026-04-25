import uuid
from datetime import datetime, date
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_auth
from app.services.cashflow_import import parse_transactions

router = APIRouter(prefix="/api/v1/cashflow", tags=["cashflow"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TransactionIn(BaseModel):
    account_id: str
    transaction_date: str
    description: str
    amount: float
    category: Optional[str] = None
    subcategory: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None
    owner_id: Optional[str] = None
    source: Optional[str] = "manual"
    is_recurring: Optional[bool] = False

class TransactionUpdate(BaseModel):
    category: Optional[str] = None
    subcategory: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None
    is_recurring: Optional[bool] = None
    description: Optional[str] = None
    amount: Optional[float] = None

class IncomeIn(BaseModel):
    owner_id: str
    date: str
    source_name: str
    income_type: Optional[str] = None   # salary|bonus|freelance|dividend
    amount: float
    notes: Optional[str] = None

class CategoryApply(BaseModel):
    # [{id, category, subcategory, is_recurring}]
    updates: List[dict]

class ReviewGenerate(BaseModel):
    month: str  # "2026-04"


# ---------------------------------------------------------------------------
# TRANSACTIONS
# ---------------------------------------------------------------------------

@router.get("/transactions")
def get_transactions(month: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    """Get all transactions for a given month (YYYY-MM)."""
    try:
        year, mon = month.split("-")
    except ValueError:
        raise HTTPException(400, "month must be YYYY-MM")

    rows = db.execute(text("""
        SELECT id, account_id, transaction_date, posted_date, description,
               amount, category, subcategory, merchant, notes,
               owner_id, source, is_recurring, batch_id, created_at
        FROM transactions
        WHERE strftime('%Y-%m', transaction_date) = :month
        ORDER BY transaction_date DESC
    """), {"month": month}).fetchall()

    return [dict(r._mapping) for r in rows]


@router.post("/transactions")
def create_transaction(body: TransactionIn, db: Session = Depends(get_db), _=Depends(require_auth)):
    tid = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO transactions
          (id, account_id, transaction_date, description, amount,
           category, subcategory, merchant, notes,
           owner_id, source, is_recurring, created_at)
        VALUES
          (:id, :account_id, :transaction_date, :description, :amount,
           :category, :subcategory, :merchant, :notes,
           :owner_id, :source, :is_recurring, :created_at)
    """), {
        "id": tid,
        "account_id": body.account_id,
        "transaction_date": body.transaction_date,
        "description": body.description,
        "amount": body.amount,
        "category": body.category,
        "subcategory": body.subcategory,
        "merchant": body.merchant,
        "notes": body.notes,
        "owner_id": body.owner_id,
        "source": body.source or "manual",
        "is_recurring": body.is_recurring or False,
        "created_at": datetime.utcnow().isoformat(),
    })
    db.commit()
    return {"id": tid, "status": "created"}


@router.put("/transactions/{tid}")
def update_transaction(tid: str, body: TransactionUpdate, db: Session = Depends(get_db), _=Depends(require_auth)):
    fields = {k: v for k, v in body.dict().items() if v is not None}
    if not fields:
        raise HTTPException(400, "Nothing to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["tid"] = tid
    db.execute(text(f"UPDATE transactions SET {set_clause} WHERE id = :tid"), fields)
    db.commit()
    return {"status": "updated"}


@router.delete("/transactions/{tid}")
def delete_transaction(tid: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    db.execute(text("DELETE FROM transactions WHERE id = :tid"), {"tid": tid})
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# CSV IMPORT
# ---------------------------------------------------------------------------

@router.post("/transactions/import")
async def import_csv(
    account_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_auth),
):
    """Parse a bank CSV and return raw transactions for user to confirm."""
    content = await file.read()
    result = parse_transactions(file.filename, content)
    if result["error"]:
        raise HTTPException(400, result["error"])

    # Generate batch_id for this upload
    batch_id = str(uuid.uuid4())

    # Attach temp ids and batch_id for frontend tracking
    for i, t in enumerate(result["transactions"]):
        t["_tmp_id"] = str(i)
        t["account_id"] = account_id
        t["batch_id"] = batch_id

    for i, t in enumerate(result.get("income", [])):
        t["_tmp_id"] = str(i)

    return {
        "bank": result["bank"],
        "batch_id": batch_id,
        "filename": file.filename,
        "transactions": result["transactions"],
        "income": result.get("income", []),
    }


@router.post("/transactions/import/confirm")
def confirm_import(body: dict, db: Session = Depends(get_db), _=Depends(require_auth)):
    """Save confirmed spending transactions + income rows to DB."""
    txns         = body.get("transactions", [])
    income_rows  = body.get("income", [])
    batch_id     = body.get("batch_id") or str(uuid.uuid4())
    filename     = body.get("filename", "")
    saved_txns   = 0
    saved_income = 0

    # Derive account_id and bank from first transaction
    account_id   = txns[0].get("account_id", "") if txns else ""
    bank         = txns[0].get("source", "manual") if txns else "manual"

    # Look up account name
    acct_row = db.execute(text("SELECT name FROM accounts WHERE id = :id"), {"id": account_id}).fetchone()
    account_name = acct_row.name if acct_row else account_id

    # Save import_batches record
    db.execute(text("""
        INSERT OR REPLACE INTO import_batches
          (id, source_type, filename, account_id, account_name, bank, row_count, income_count, imported_at)
        VALUES
          (:id, 'transactions', :filename, :account_id, :account_name, :bank, :row_count, :income_count, :imported_at)
    """), {
        "id": batch_id,
        "filename": filename,
        "account_id": account_id,
        "account_name": account_name,
        "bank": bank,
        "row_count": len(txns),
        "income_count": len(income_rows),
        "imported_at": datetime.utcnow().isoformat(),
    })

    # Save spending transactions
    for t in txns:
        tid = str(uuid.uuid4())
        db.execute(text("""
            INSERT INTO transactions
              (id, account_id, transaction_date, posted_date, description,
               amount, category, subcategory, merchant,
               owner_id, source, is_recurring, batch_id, created_at)
            VALUES
              (:id, :account_id, :transaction_date, :posted_date, :description,
               :amount, :category, :subcategory, :merchant,
               :owner_id, :source, :is_recurring, :batch_id, :created_at)
        """), {
            "id": tid,
            "account_id": t.get("account_id", ""),
            "transaction_date": t.get("transaction_date", ""),
            "posted_date": t.get("posted_date"),
            "description": t.get("description", ""),
            "amount": float(t.get("amount", 0)),
            "category": t.get("category"),
            "subcategory": t.get("subcategory"),
            "merchant": t.get("merchant"),
            "owner_id": t.get("owner_id"),
            "source": t.get("source", "manual"),
            "is_recurring": t.get("is_recurring", False),
            "batch_id": batch_id,
            "created_at": datetime.utcnow().isoformat(),
        })
        saved_txns += 1

    # Save income rows to income_transactions
    for inc in income_rows:
        iid = str(uuid.uuid4())
        db.execute(text("""
            INSERT INTO income_transactions
              (id, owner_id, date, source_name, income_type, amount, notes, created_at)
            VALUES
              (:id, :owner_id, :date, :source_name, :income_type, :amount, :notes, :created_at)
        """), {
            "id": iid,
            "owner_id":    inc.get("owner_id") or inc.get("owner_hint") or "unknown",
            "date":        inc.get("transaction_date", ""),
            "source_name": inc.get("description", ""),
            "income_type": inc.get("income_type", "other"),
            "amount":      float(inc.get("amount", 0)),
            "notes":       inc.get("full_description"),
            "created_at":  datetime.utcnow().isoformat(),
        })
        saved_income += 1

    db.commit()
    return {"saved_transactions": saved_txns, "saved_income": saved_income, "batch_id": batch_id}


# ---------------------------------------------------------------------------
# CLAUDE AUTO-CATEGORIZE
# ---------------------------------------------------------------------------

@router.post("/transactions/categorize")
async def categorize_transactions(body: dict, _=Depends(require_auth)):
    """
    Takes a list of transaction descriptions, returns suggested categories.
    Uses Anthropic API directly (same pattern as analysis_service).
    """
    import os, json
    import anthropic

    descriptions = body.get("descriptions", [])
    if not descriptions:
        return {"suggestions": []}

    categories = body.get("categories", [
        "Groceries", "Dining", "Transport", "Gas", "Shopping",
        "Entertainment", "Subscriptions", "Health", "Travel",
        "Utilities", "Insurance", "Rent/Mortgage", "Education",
        "Personal Care", "Gifts", "Other"
    ])

    prompt = f"""You are categorizing personal finance transactions.
Given these transaction descriptions, suggest a category and subcategory for each.
Also flag if it looks like a recurring subscription (is_recurring: true/false).

Available categories: {', '.join(categories)}

Transactions:
{chr(10).join(f'{i+1}. {d}' for i, d in enumerate(descriptions))}

Respond ONLY with a JSON array, one object per transaction, in order:
[{{"description": "...", "category": "...", "subcategory": "...", "is_recurring": false}}, ...]
No markdown, no explanation, just the JSON array."""

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = message.content[0].text.strip()
    try:
        suggestions = json.loads(raw)
    except json.JSONDecodeError:
        suggestions = [{"description": d, "category": "Other", "subcategory": None, "is_recurring": False}
                       for d in descriptions]

    return {"suggestions": suggestions}


# ---------------------------------------------------------------------------
# INCOME
# ---------------------------------------------------------------------------

@router.get("/income")
def get_income(month: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute(text("""
        SELECT id, owner_id, date, source_name, income_type, amount, notes, created_at
        FROM income_transactions
        WHERE strftime('%Y-%m', date) = :month
        ORDER BY date DESC
    """), {"month": month}).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/income")
def create_income(body: IncomeIn, db: Session = Depends(get_db), _=Depends(require_auth)):
    iid = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO income_transactions
          (id, owner_id, date, source_name, income_type, amount, notes, created_at)
        VALUES
          (:id, :owner_id, :date, :source_name, :income_type, :amount, :notes, :created_at)
    """), {
        "id": iid,
        "owner_id": body.owner_id,
        "date": body.date,
        "source_name": body.source_name,
        "income_type": body.income_type,
        "amount": body.amount,
        "notes": body.notes,
        "created_at": datetime.utcnow().isoformat(),
    })
    db.commit()
    return {"id": iid, "status": "created"}


@router.put("/income/{iid}")
def update_income(iid: str, body: dict, db: Session = Depends(get_db), _=Depends(require_auth)):
    fields = {k: v for k, v in body.items() if k in ("owner_id", "income_type", "source_name", "amount", "notes")}
    if not fields:
        raise HTTPException(400, "Nothing to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["iid"] = iid
    db.execute(text(f"UPDATE income_transactions SET {set_clause} WHERE id = :iid"), fields)
    db.commit()
    return {"status": "updated"}


@router.delete("/income/{iid}")
def delete_income(iid: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    db.execute(text("DELETE FROM income_transactions WHERE id = :iid"), {"iid": iid})
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# SUMMARY (powers Savings Rate tab)
# ---------------------------------------------------------------------------

@router.get("/summary")
def get_summary(year: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    """Returns 12 months of income, spending, savings for a given year."""
    months = [f"{year}-{str(m).zfill(2)}" for m in range(1, 13)]
    result = []

    for month in months:
        spending_row = db.execute(text("""
            SELECT COALESCE(SUM(amount), 0) as total
            FROM transactions
            WHERE strftime('%Y-%m', transaction_date) = :month
        """), {"month": month}).fetchone()

        income_row = db.execute(text("""
            SELECT COALESCE(SUM(amount), 0) as total
            FROM income_transactions
            WHERE strftime('%Y-%m', date) = :month
        """), {"month": month}).fetchone()

        income   = float(income_row.total)
        spending = float(spending_row.total)
        saved    = income - spending
        rate     = round((saved / income * 100), 1) if income > 0 else 0.0

        result.append({
            "month": month,
            "income": income,
            "spending": spending,
            "saved": saved,
            "savings_rate": rate,
        })

    return result


# ---------------------------------------------------------------------------
# FORECAST
# ---------------------------------------------------------------------------

@router.get("/forecast")
def get_forecast(db: Session = Depends(get_db), _=Depends(require_auth)):
    """Returns 12-month cash flow forecast based on historical averages."""
    from calendar import monthrange
    import datetime as dt

    # --- Historical averages ---
    income_rows = db.execute(text("""
        SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
        FROM income_transactions GROUP BY month ORDER BY month
    """)).fetchall()

    spending_rows = db.execute(text("""
        SELECT strftime('%Y-%m', transaction_date) as month, SUM(amount) as total
        FROM transactions GROUP BY month ORDER BY month
    """)).fetchall()

    income_by_month  = {r.month: float(r.total) for r in income_rows}
    spending_by_month = {r.month: float(r.total) for r in spending_rows}

    # Months that have BOTH income and spending data = complete months
    complete_months = sorted(set(income_by_month.keys()) & set(spending_by_month.keys()))
    all_income_months  = sorted(income_by_month.keys())
    all_spending_months = sorted(spending_by_month.keys())

    avg_income   = round(sum(income_by_month.values()) / len(income_by_month), 2) if income_by_month else 0
    avg_spending = round(sum(spending_by_month.values()) / len(spending_by_month), 2) if spending_by_month else 0
    avg_savings  = round(avg_income - avg_spending, 2)
    savings_rate = round((avg_savings / avg_income * 100), 1) if avg_income > 0 else 0

    # Monthly recurring total
    recurring_row = db.execute(text("""
        SELECT ROUND(SUM(DISTINCT amount), 2) as total
        FROM transactions WHERE is_recurring = 1
    """)).fetchone()
    monthly_recurring = float(recurring_row.total or 0)

    # Current liquid balance (cash accounts)
    balance_rows = db.execute(text("""
        SELECT a.id, a.name, b.balance
        FROM balance_snapshots b
        JOIN accounts a ON b.account_id = a.id
        WHERE a.category = 'cash'
        AND b.snapshot_date = (
            SELECT MAX(b2.snapshot_date) FROM balance_snapshots b2
            WHERE b2.account_id = a.id
        )
        AND a.is_active = 1
    """)).fetchall()

    checking_accounts = [r for r in balance_rows if "checking" in r.name.lower()]
    current_liquid = sum(float(r.balance) for r in checking_accounts)

    # --- 12-month projection ---
    today = dt.date.today()
    projections = []
    running_balance = current_liquid

    for i in range(12):
        # Get the month
        month_date = dt.date(today.year, today.month, 1)
        if today.month + i > 12:
            year = today.year + (today.month + i - 1) // 12
            month = (today.month + i - 1) % 12 + 1
        else:
            year = today.year
            month = today.month + i
        month_str = f"{year}-{str(month).zfill(2)}"

        # Use actual data if available, else use average
        actual_income   = income_by_month.get(month_str)
        actual_spending = spending_by_month.get(month_str)
        proj_income   = actual_income   if actual_income   is not None else avg_income
        proj_spending = actual_spending if actual_spending is not None else avg_spending
        proj_savings  = round(proj_income - proj_spending, 2)
        running_balance = round(running_balance + proj_savings, 2)

        projections.append({
            "month":           month_str,
            "income":          round(proj_income, 2),
            "spending":        round(proj_spending, 2),
            "savings":         proj_savings,
            "savings_rate":    round((proj_savings / proj_income * 100), 1) if proj_income > 0 else 0,
            "liquid_balance":  running_balance,
            "is_actual":       actual_income is not None or actual_spending is not None,
            "is_complete":     month_str in complete_months,
        })

    return {
        "assumptions": {
            "avg_income":        avg_income,
            "avg_spending":      avg_spending,
            "avg_savings":       avg_savings,
            "savings_rate":      savings_rate,
            "monthly_recurring": monthly_recurring,
            "current_liquid":    round(current_liquid, 2),
            "income_months":     len(all_income_months),
            "spending_months":   len(all_spending_months),
            "complete_months":   complete_months,
        },
        "projections": projections,
    }


# ---------------------------------------------------------------------------
# RECURRING
# ---------------------------------------------------------------------------

@router.get("/recurring")
def get_recurring(db: Session = Depends(get_db), _=Depends(require_auth)):
    """Returns confirmed recurring transactions and auto-detected candidates."""

    # Confirmed recurring — flagged is_recurring=1, grouped by description+amount
    confirmed_sql = """
        SELECT
            t.description,
            t.amount,
            t.category,
            t.source,
            COUNT(*) as occurrences,
            MIN(t.transaction_date) as first_seen,
            MAX(t.transaction_date) as last_seen,
            ROUND(SUM(t.amount), 2) as ytd_total,
            GROUP_CONCAT(DISTINCT strftime('%Y-%m', t.transaction_date)) as months
        FROM transactions t
        WHERE t.is_recurring = 1
        GROUP BY t.description, t.amount
        ORDER BY t.amount DESC
    """
    confirmed_rows = db.execute(text(confirmed_sql)).fetchall()

    # Auto-detect candidates — not flagged, but appear in 2+ different months
    candidates_sql = """
        SELECT
            t.description,
            ROUND(t.amount, 2) as amount,
            t.category,
            COUNT(*) as occurrences,
            COUNT(DISTINCT strftime('%Y-%m', t.transaction_date)) as distinct_months,
            MIN(t.transaction_date) as first_seen,
            MAX(t.transaction_date) as last_seen,
            GROUP_CONCAT(DISTINCT strftime('%Y-%m', t.transaction_date)) as months
        FROM transactions t
        WHERE (t.is_recurring = 0 OR t.is_recurring IS NULL)
        GROUP BY t.description, ROUND(t.amount, 2)
        HAVING distinct_months >= 2
        ORDER BY distinct_months DESC, amount DESC
    """
    candidate_rows = db.execute(text(candidates_sql)).fetchall()

    return {
        "confirmed": [dict(r._mapping) for r in confirmed_rows],
        "candidates": [dict(r._mapping) for r in candidate_rows],
    }


@router.post("/recurring/mark")
def mark_recurring(body: dict, db: Session = Depends(get_db), _=Depends(require_auth)):
    """Mark all transactions matching description+amount as recurring."""
    description = body.get("description")
    amount      = body.get("amount")
    is_recurring = body.get("is_recurring", True)

    if not description:
        raise HTTPException(400, "description required")

    params: dict = {"description": description, "is_recurring": is_recurring}
    if amount is not None:
        result = db.execute(text("""
            UPDATE transactions
            SET is_recurring = :is_recurring
            WHERE description = :description AND ROUND(amount, 2) = ROUND(:amount, 2)
        """), {**params, "amount": amount})
    else:
        result = db.execute(text("""
            UPDATE transactions
            SET is_recurring = :is_recurring
            WHERE description = :description
        """), params)

    db.commit()
    return {"updated": result.rowcount}


# ---------------------------------------------------------------------------
# IMPORT HISTORY
# ---------------------------------------------------------------------------

@router.get("/imports")
def get_imports(db: Session = Depends(get_db), _=Depends(require_auth)):
    """Returns import history from import_batches table."""
    sql = """
        SELECT
            b.id as batch_id,
            b.filename,
            b.account_id,
            b.account_name,
            b.bank,
            b.row_count,
            b.income_count,
            b.imported_at,
            b.source_type
        FROM import_batches b
        ORDER BY b.imported_at DESC
    """
    rows = db.execute(text(sql)).fetchall()
    return [dict(r._mapping) for r in rows]


@router.delete("/imports/{batch_id}")
def delete_import_batch(
    batch_id: str,
    db: Session = Depends(get_db),
    _=Depends(require_auth),
):
    """Delete all transactions for a batch and remove the batch record."""
    result = db.execute(text("""
        DELETE FROM transactions WHERE batch_id = :batch_id
    """), {"batch_id": batch_id})
    db.execute(text("DELETE FROM import_batches WHERE id = :id"), {"id": batch_id})
    db.commit()
    return {"deleted": result.rowcount}


# ---------------------------------------------------------------------------
# TRENDS
# ---------------------------------------------------------------------------

@router.get("/trends")
def get_trends(year: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    """Returns monthly spending per account for a full year — powers Trends chart."""
    months = [f"{year}-{str(m).zfill(2)}" for m in range(1, 13)]

    rows = db.execute(text("""
        SELECT
            strftime('%Y-%m', t.transaction_date) as month,
            t.account_id,
            a.name as account_name,
            COALESCE(SUM(t.amount), 0) as total
        FROM transactions t
        LEFT JOIN accounts a ON t.account_id = a.id
        WHERE strftime('%Y', t.transaction_date) = :year
        GROUP BY month, t.account_id
        ORDER BY month, t.account_id
    """), {"year": year}).fetchall()

    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------
# CATEGORIES
# ---------------------------------------------------------------------------

@router.get("/categories")
def get_categories(db: Session = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute(text("""
        SELECT id, name, parent_category, color, icon FROM spend_categories
        ORDER BY parent_category NULLS FIRST, name
    """)).fetchall()

    # Also return a hardcoded default list if table is empty
    cats = [dict(r._mapping) for r in rows]
    if not cats:
        defaults = [
            "Groceries", "Dining", "Transport", "Gas", "Shopping",
            "Entertainment", "Subscriptions", "Health", "Travel",
            "Utilities", "Insurance", "Rent/Mortgage", "Education",
            "Personal Care", "Gifts", "Other"
        ]
        cats = [{"id": str(i), "name": n, "parent_category": None, "color": None, "icon": None}
                for i, n in enumerate(defaults)]
    return cats


# ---------------------------------------------------------------------------
# MONTHLY REVIEW
# ---------------------------------------------------------------------------

@router.get("/reviews")
def get_review(month: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    """Get saved review for a month (YYYY-MM)."""
    year, mon = month.split("-")
    period_start = f"{month}-01"

    row = db.execute(text("""
        SELECT * FROM reviews
        WHERE period_start = :period_start AND period_type = 'monthly'
        ORDER BY generated_at DESC LIMIT 1
    """), {"period_start": period_start}).fetchone()

    if not row:
        return {"exists": False}
    return {"exists": True, "review": dict(row._mapping)}


@router.post("/reviews/generate")
def generate_review(body: ReviewGenerate, db: Session = Depends(get_db), _=Depends(require_auth)):
    """Generate a Claude monthly review synthesizing all data sources."""
    import os, json
    import anthropic
    from calendar import monthrange

    month = body.month  # "2026-04"
    year, mon = month.split("-")
    period_start = f"{month}-01"
    last_day = monthrange(int(year), int(mon))[1]
    period_end = f"{month}-{last_day}"

    # --- Gather data ---

    # 1. Cashflow
    spending_rows = db.execute(text("""
        SELECT category, COALESCE(SUM(amount),0) as total
        FROM transactions
        WHERE strftime('%Y-%m', transaction_date) = :month
        GROUP BY category ORDER BY total DESC
    """), {"month": month}).fetchall()

    total_spending = sum(float(r.total) for r in spending_rows)
    spending_breakdown = {r.category or "Uncategorized": float(r.total) for r in spending_rows}

    income_rows = db.execute(text("""
        SELECT source_name, income_type, SUM(amount) as total
        FROM income_transactions
        WHERE strftime('%Y-%m', date) = :month
        GROUP BY source_name, income_type
    """), {"month": month}).fetchall()

    total_income = sum(float(r.total) for r in income_rows)
    savings = total_income - total_spending
    savings_rate = round((savings / total_income * 100), 1) if total_income > 0 else 0.0

    # 2. Net worth delta
    nw_rows = db.execute(text("""
        SELECT snapshot_date, net_worth FROM net_worth_snapshots
        WHERE snapshot_date BETWEEN :start AND :end
        ORDER BY snapshot_date
    """), {"start": period_start, "end": period_end}).fetchall()

    nw_start = float(nw_rows[0].net_worth)  if nw_rows else None
    nw_end   = float(nw_rows[-1].net_worth) if nw_rows else None
    nw_delta = round(nw_end - nw_start, 2)  if (nw_start and nw_end) else None

    # 3. Sensor signals
    signal_rows = db.execute(text("""
        SELECT signal, COUNT(*) as cnt FROM ticker_analysis GROUP BY signal
    """)).fetchall()
    signals = {r.signal: r.cnt for r in signal_rows}

    # --- Build prompt ---
    prompt = f"""You are a personal finance advisor reviewing {year}-{mon} for a household.

CASH FLOW:
- Total Income: ${total_income:,.0f}
- Total Spending: ${total_spending:,.0f}
- Saved: ${savings:,.0f}
- Savings Rate: {savings_rate}%
- Spending by category: {json.dumps(spending_breakdown, indent=2)}

NET WORTH:
- Start of month: {"$" + f"{nw_start:,.0f}" if nw_start else "No data"}
- End of month: {"$" + f"{nw_end:,.0f}" if nw_end else "No data"}
- Change: {"$" + f"{nw_delta:,.0f}" if nw_delta is not None else "No data"}

PORTFOLIO SENSOR SIGNALS:
- Buy signals: {signals.get('buy', 0)}
- Sell signals: {signals.get('sell', 0)}
- Watch signals: {signals.get('watch', 0)}

Write a concise monthly review with these sections:
1. **Summary** — 2-3 sentence headline of the month
2. **Cash Flow** — what stood out in spending, savings rate assessment
3. **Net Worth** — change and what likely drove it
4. **Portfolio** — sensor signal summary, any action items
5. **Action Items** — 2-3 concrete things to do next month

Be direct, specific, and avoid generic advice. Use the actual numbers."""

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}]
    )
    review_text = message.content[0].text.strip()

    # --- Upsert into reviews ---
    existing = db.execute(text("""
        SELECT id FROM reviews WHERE period_start = :period_start AND period_type = 'monthly'
    """), {"period_start": period_start}).fetchone()

    if existing:
        db.execute(text("""
            UPDATE reviews SET
              net_worth_start = :nw_start,
              net_worth_end   = :nw_end,
              net_worth_change = :nw_delta,
              total_income    = :total_income,
              total_expenses  = :total_spending,
              savings_amount  = :savings,
              savings_rate    = :savings_rate,
              notes           = :notes,
              generated_at    = :generated_at
            WHERE id = :id
        """), {
            "id": existing.id,
            "nw_start": nw_start, "nw_end": nw_end, "nw_delta": nw_delta,
            "total_income": total_income, "total_spending": total_spending,
            "savings": savings, "savings_rate": savings_rate,
            "notes": review_text,
            "generated_at": datetime.utcnow().isoformat(),
        })
    else:
        db.execute(text("""
            INSERT INTO reviews
              (id, period_type, period_start, period_end,
               net_worth_start, net_worth_end, net_worth_change,
               total_income, total_expenses, savings_amount, savings_rate,
               notes, generated_at)
            VALUES
              (:id, 'monthly', :period_start, :period_end,
               :nw_start, :nw_end, :nw_delta,
               :total_income, :total_spending, :savings, :savings_rate,
               :notes, :generated_at)
        """), {
            "id": str(uuid.uuid4()),
            "period_start": period_start, "period_end": period_end,
            "nw_start": nw_start, "nw_end": nw_end, "nw_delta": nw_delta,
            "total_income": total_income, "total_spending": total_spending,
            "savings": savings, "savings_rate": savings_rate,
            "notes": review_text,
            "generated_at": datetime.utcnow().isoformat(),
        })

    db.commit()
    return {
        "month": month,
        "review": review_text,
        "stats": {
            "total_income": total_income,
            "total_spending": total_spending,
            "savings": savings,
            "savings_rate": savings_rate,
            "nw_delta": nw_delta,
        }
    }
