import uuid
from datetime import datetime, date
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
import math

from app.core.database import get_db
from app.core.auth import require_auth

router = APIRouter(prefix="/api/v1/mortgage", tags=["mortgage"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class MortgageIn(BaseModel):
    property_name: str
    address: Optional[str] = None
    purchase_price: Optional[float] = None
    purchase_date: Optional[str] = None
    notes: Optional[str] = None

class LoanIn(BaseModel):
    mortgage_id: str
    event_type: str          # purchase | refinance | payoff
    loan_type: str           # fixed | arm
    original_balance: float
    rate: float              # annual rate as percentage e.g. 6.5
    term_months: int
    start_date: str
    end_date: Optional[str] = None
    monthly_escrow: Optional[float] = 0
    monthly_extra_principal: Optional[float] = 0
    closing_costs: Optional[float] = 0
    down_payment: Optional[float] = 0
    arm_initial_period: Optional[int] = None
    arm_cap: Optional[float] = None
    arm_lifetime_cap: Optional[float] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = True

class PaymentIn(BaseModel):
    loan_id: str
    payment_date: str
    principal: float
    interest: float
    escrow: Optional[float] = 0
    extra_principal: Optional[float] = 0
    balance_after: Optional[float] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Amortization helpers
# ---------------------------------------------------------------------------

def compute_monthly_payment(balance: float, annual_rate: float, term_months: int) -> float:
    """Standard amortization formula."""
    if annual_rate == 0:
        return balance / term_months
    r = annual_rate / 100 / 12
    return balance * r * math.pow(1 + r, term_months) / (math.pow(1 + r, term_months) - 1)


def build_amortization(
    original_balance: float,
    annual_rate: float,
    term_months: int,
    start_date: str,
    monthly_extra: float = 0,
    one_time_extras: dict = {},  # {month_number: amount}
) -> List[dict]:
    """Build full amortization schedule with optional extra payments."""
    r = annual_rate / 100 / 12
    monthly_pi = compute_monthly_payment(original_balance, annual_rate, term_months)
    balance = original_balance
    schedule = []

    start = datetime.strptime(start_date, "%Y-%m-%d")

    for month in range(1, term_months + 1):
        if balance <= 0:
            break

        interest   = round(balance * r, 2)
        principal  = round(min(monthly_pi - interest, balance), 2)
        extra      = monthly_extra + one_time_extras.get(month, 0)
        extra      = round(min(extra, balance - principal), 2)
        balance    = round(balance - principal - extra, 2)

        # Calculate payment date
        pay_month = ((start.month - 1 + month) % 12) + 1
        pay_year  = start.year + (start.month - 1 + month) // 12
        pay_date  = f"{pay_year}-{str(pay_month).zfill(2)}-01"

        schedule.append({
            "month":         month,
            "payment_date":  pay_date,
            "payment":       round(monthly_pi + extra, 2),
            "principal":     principal,
            "interest":      interest,
            "extra":         extra,
            "balance":       max(balance, 0),
            "cumulative_interest": None,  # filled below
        })

        if balance <= 0:
            break

    # Add cumulative interest
    cum = 0
    for row in schedule:
        cum += row["interest"]
        row["cumulative_interest"] = round(cum, 2)

    return schedule


# ---------------------------------------------------------------------------
# MORTGAGES
# ---------------------------------------------------------------------------

@router.get("/")
def list_mortgages(db: Session = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute(text("""
        SELECT m.*, 
          (SELECT COUNT(*) FROM mortgage_loans l WHERE l.mortgage_id = m.id) as loan_count
        FROM mortgages m ORDER BY m.purchase_date DESC
    """)).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/")
def create_mortgage(body: MortgageIn, db: Session = Depends(get_db), _=Depends(require_auth)):
    mid = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO mortgages (id, property_name, address, purchase_price, purchase_date, notes, created_at)
        VALUES (:id, :property_name, :address, :purchase_price, :purchase_date, :notes, :created_at)
    """), {
        "id": mid, "property_name": body.property_name, "address": body.address,
        "purchase_price": body.purchase_price, "purchase_date": body.purchase_date,
        "notes": body.notes, "created_at": datetime.utcnow().isoformat(),
    })
    db.commit()
    return {"id": mid, "status": "created"}


@router.get("/{mortgage_id}")
def get_mortgage(mortgage_id: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    m = db.execute(text("SELECT * FROM mortgages WHERE id = :id"), {"id": mortgage_id}).fetchone()
    if not m:
        raise HTTPException(404, "Mortgage not found")
    loans = db.execute(text("""
        SELECT * FROM mortgage_loans WHERE mortgage_id = :id ORDER BY start_date
    """), {"id": mortgage_id}).fetchall()
    return {
        "mortgage": dict(m._mapping),
        "loans": [dict(l._mapping) for l in loans],
    }


@router.delete("/{mortgage_id}")
def delete_mortgage(mortgage_id: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    db.execute(text("DELETE FROM mortgage_payments WHERE loan_id IN (SELECT id FROM mortgage_loans WHERE mortgage_id = :id)"), {"id": mortgage_id})
    db.execute(text("DELETE FROM mortgage_loans WHERE mortgage_id = :id"), {"id": mortgage_id})
    db.execute(text("DELETE FROM mortgages WHERE id = :id"), {"id": mortgage_id})
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# LOANS
# ---------------------------------------------------------------------------

@router.post("/loan/add")
def add_loan(body: LoanIn, db: Session = Depends(get_db), _=Depends(require_auth)):
    # Deactivate previous active loan if this is a refi
    if body.event_type == "refinance":
        db.execute(text("""
            UPDATE mortgage_loans SET is_active = 0, end_date = :end_date
            WHERE mortgage_id = :mid AND is_active = 1
        """), {"mid": body.mortgage_id, "end_date": body.start_date})

    lid = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO mortgage_loans
          (id, mortgage_id, event_type, loan_type, original_balance, rate, term_months,
           start_date, end_date, monthly_escrow, monthly_extra_principal,
           closing_costs, down_payment, arm_initial_period, arm_cap, arm_lifetime_cap,
           notes, is_active, created_at)
        VALUES
          (:id, :mortgage_id, :event_type, :loan_type, :original_balance, :rate, :term_months,
           :start_date, :end_date, :monthly_escrow, :monthly_extra_principal,
           :closing_costs, :down_payment, :arm_initial_period, :arm_cap, :arm_lifetime_cap,
           :notes, :is_active, :created_at)
    """), {
        "id": lid, "mortgage_id": body.mortgage_id, "event_type": body.event_type,
        "loan_type": body.loan_type, "original_balance": body.original_balance,
        "rate": body.rate, "term_months": body.term_months, "start_date": body.start_date,
        "end_date": body.end_date, "monthly_escrow": body.monthly_escrow or 0,
        "monthly_extra_principal": body.monthly_extra_principal or 0,
        "closing_costs": body.closing_costs or 0, "down_payment": body.down_payment or 0,
        "arm_initial_period": body.arm_initial_period, "arm_cap": body.arm_cap,
        "arm_lifetime_cap": body.arm_lifetime_cap, "notes": body.notes,
        "is_active": body.is_active if body.is_active is not None else True,
        "created_at": datetime.utcnow().isoformat(),
    })
    db.commit()
    return {"id": lid, "status": "created"}


@router.put("/loan/{loan_id}")
def update_loan(loan_id: str, body: dict, db: Session = Depends(get_db), _=Depends(require_auth)):
    allowed = {"rate", "monthly_escrow", "monthly_extra_principal", "notes"}
    fields  = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(400, "Nothing to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["loan_id"] = loan_id
    db.execute(text(f"UPDATE mortgage_loans SET {set_clause} WHERE id = :loan_id"), fields)
    db.commit()
    return {"status": "updated"}


@router.delete("/loan/{loan_id}")
def delete_loan(loan_id: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    db.execute(text("DELETE FROM mortgage_payments WHERE loan_id = :id"), {"id": loan_id})
    db.execute(text("DELETE FROM mortgage_loans WHERE id = :id"), {"id": loan_id})
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# AMORTIZATION
# ---------------------------------------------------------------------------

@router.get("/loan/{loan_id}/amortization")
def get_amortization(
    loan_id: str,
    extra_monthly: float = 0,
    db: Session = Depends(get_db),
    _=Depends(require_auth)
):
    loan = db.execute(text("SELECT * FROM mortgage_loans WHERE id = :id"), {"id": loan_id}).fetchone()
    if not loan:
        raise HTTPException(404, "Loan not found")

    l = dict(loan._mapping)

    # Get one-time extra payments from mortgage_payments table
    payment_rows = db.execute(text("""
        SELECT payment_date, extra_principal FROM mortgage_payments
        WHERE loan_id = :id AND extra_principal > 0
        ORDER BY payment_date
    """), {"id": loan_id}).fetchall()

    # Convert one-time payments to month numbers
    start = datetime.strptime(l["start_date"], "%Y-%m-%d")
    one_time = {}
    for p in payment_rows:
        pd = datetime.strptime(p.payment_date, "%Y-%m-%d")
        month_num = (pd.year - start.year) * 12 + (pd.month - start.month) + 1
        one_time[month_num] = one_time.get(month_num, 0) + float(p.extra_principal)

    monthly_extra = (l.get("monthly_extra_principal") or 0) + extra_monthly

    schedule = build_amortization(
        original_balance = l["original_balance"],
        annual_rate      = l["rate"],
        term_months      = l["term_months"],
        start_date       = l["start_date"],
        monthly_extra    = monthly_extra,
        one_time_extras  = one_time,
    )

    # Base schedule (no extras) for comparison
    base_schedule = build_amortization(
        original_balance = l["original_balance"],
        annual_rate      = l["rate"],
        term_months      = l["term_months"],
        start_date       = l["start_date"],
    )

    monthly_pi = compute_monthly_payment(l["original_balance"], l["rate"], l["term_months"])

    return {
        "loan": l,
        "monthly_pi":       round(monthly_pi, 2),
        "monthly_payment":  round(monthly_pi + (l.get("monthly_escrow") or 0), 2),
        "schedule":         schedule,
        "total_interest":   schedule[-1]["cumulative_interest"] if schedule else 0,
        "payoff_months":    len(schedule),
        "payoff_date":      schedule[-1]["payment_date"] if schedule else None,
        "base_total_interest": base_schedule[-1]["cumulative_interest"] if base_schedule else 0,
        "base_payoff_months":  len(base_schedule),
        "interest_saved":   round((base_schedule[-1]["cumulative_interest"] if base_schedule else 0) -
                                  (schedule[-1]["cumulative_interest"] if schedule else 0), 2),
        "months_saved":     len(base_schedule) - len(schedule),
    }


# ---------------------------------------------------------------------------
# PAYMENTS
# ---------------------------------------------------------------------------

@router.get("/loan/{loan_id}/payments")
def get_payments(loan_id: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    rows = db.execute(text("""
        SELECT * FROM mortgage_payments WHERE loan_id = :id ORDER BY payment_date
    """), {"id": loan_id}).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/payment/add")
def add_payment(body: PaymentIn, db: Session = Depends(get_db), _=Depends(require_auth)):
    pid = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO mortgage_payments
          (id, loan_id, payment_date, principal, interest, escrow, extra_principal, balance_after, notes, created_at)
        VALUES
          (:id, :loan_id, :payment_date, :principal, :interest, :escrow, :extra_principal, :balance_after, :notes, :created_at)
    """), {
        "id": pid, "loan_id": body.loan_id, "payment_date": body.payment_date,
        "principal": body.principal, "interest": body.interest,
        "escrow": body.escrow or 0, "extra_principal": body.extra_principal or 0,
        "balance_after": body.balance_after, "notes": body.notes,
        "created_at": datetime.utcnow().isoformat(),
    })
    db.commit()
    return {"id": pid, "status": "created"}


@router.delete("/payment/{payment_id}")
def delete_payment(payment_id: str, db: Session = Depends(get_db), _=Depends(require_auth)):
    db.execute(text("DELETE FROM mortgage_payments WHERE id = :id"), {"id": payment_id})
    db.commit()
    return {"status": "deleted"}
