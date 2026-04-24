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
               owner_id, source, is_recurring, created_at
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

    # Attach a temp id to each for frontend tracking
    for i, t in enumerate(result["transactions"]):
        t["_tmp_id"] = str(i)
        t["account_id"] = account_id

    for i, t in enumerate(result.get("income", [])):
        t["_tmp_id"] = str(i)

    return {
        "bank": result["bank"],
        "transactions": result["transactions"],
        "income": result.get("income", []),
    }


@router.post("/transactions/import/confirm")
def confirm_import(body: dict, db: Session = Depends(get_db), _=Depends(require_auth)):
    """Save confirmed spending transactions + income rows to DB."""
    txns         = body.get("transactions", [])
    income_rows  = body.get("income", [])
    saved_txns   = 0
    saved_income = 0

    # Save spending transactions
    for t in txns:
        tid = str(uuid.uuid4())
        db.execute(text("""
            INSERT INTO transactions
              (id, account_id, transaction_date, posted_date, description,
               amount, category, subcategory, merchant,
               owner_id, source, is_recurring, created_at)
            VALUES
              (:id, :account_id, :transaction_date, :posted_date, :description,
               :amount, :category, :subcategory, :merchant,
               :owner_id, :source, :is_recurring, :created_at)
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
    return {"saved_transactions": saved_txns, "saved_income": saved_income}


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
