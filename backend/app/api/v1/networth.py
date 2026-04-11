from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.database import get_db
from app.models.models import Account, BalanceSnapshot, Owner
from datetime import date
import json

router = APIRouter()

ASSET_CATEGORIES = {"cash", "taxable", "retirement", "hsa", "alternative", "manual"}
LIABILITY_CATEGORIES = {"credit_card", "loan"}

def get_latest_balances(db: Session):
    subq = db.query(
        BalanceSnapshot.account_id,
        func.max(BalanceSnapshot.snapshot_date).label("max_date")
    ).group_by(BalanceSnapshot.account_id).subquery()

    rows = db.query(BalanceSnapshot, Account, Owner)\
        .join(Account, Account.id == BalanceSnapshot.account_id)\
        .join(Owner, Owner.id == Account.owner_id)\
        .join(subq, (subq.c.account_id == BalanceSnapshot.account_id) &
                    (subq.c.max_date == BalanceSnapshot.snapshot_date))\
        .filter(Account.is_active == True)\
        .all()
    return rows

@router.get("/summary")
def get_net_worth_summary(db: Session = Depends(get_db)):
    rows = get_latest_balances(db)

    total_assets = 0.0
    total_liabilities = 0.0
    category_breakdown = {}
    owner_breakdown = {}

    for snapshot, account, owner in rows:
        bal = snapshot.balance
        cat = account.category
        owner_name = owner.name

        if cat in ASSET_CATEGORIES:
            total_assets += bal
        elif cat in LIABILITY_CATEGORIES:
            total_liabilities += bal

        category_breakdown[cat] = category_breakdown.get(cat, 0) + bal
        owner_breakdown[owner_name] = owner_breakdown.get(owner_name, 0) + (
            bal if cat in ASSET_CATEGORIES else -bal
        )

    return {
        "total_assets": round(total_assets, 2),
        "total_liabilities": round(total_liabilities, 2),
        "net_worth": round(total_assets - total_liabilities, 2),
        "category_breakdown": {k: round(v, 2) for k, v in category_breakdown.items()},
        "owner_breakdown": {k: round(v, 2) for k, v in owner_breakdown.items()},
        "as_of": date.today().isoformat()
    }

@router.get("/history")
def get_net_worth_history(db: Session = Depends(get_db)):
    snapshots = db.query(
        BalanceSnapshot.snapshot_date,
        Account.category,
        func.sum(BalanceSnapshot.balance).label("total")
    ).join(Account, Account.id == BalanceSnapshot.account_id)\
     .filter(Account.is_active == True)\
     .group_by(BalanceSnapshot.snapshot_date, Account.category)\
     .order_by(BalanceSnapshot.snapshot_date)\
     .all()

    history = {}
    for row in snapshots:
        d = str(row.snapshot_date)
        if d not in history:
            history[d] = {"date": d, "assets": 0, "liabilities": 0, "net_worth": 0}
        if row.category in ASSET_CATEGORIES:
            history[d]["assets"] += row.total
        elif row.category in LIABILITY_CATEGORIES:
            history[d]["liabilities"] += row.total
        history[d]["net_worth"] = history[d]["assets"] - history[d]["liabilities"]

    return list(history.values())
