from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.models import Account, BalanceSnapshot
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date

router = APIRouter()

class AccountCreate(BaseModel):
    owner_id: str
    name: str
    institution: Optional[str] = None
    category: str
    subtype: Optional[str] = None
    currency: str = "USD"
    notes: Optional[str] = None

class AccountOut(BaseModel):
    id: str
    owner_id: str
    name: str
    institution: Optional[str]
    category: str
    subtype: Optional[str]
    currency: str
    is_active: bool
    notes: Optional[str]
    created_at: datetime
    class Config:
        from_attributes = True

class SnapshotCreate(BaseModel):
    account_id: str
    balance: float
    snapshot_date: date
    as_of_date: Optional[date] = None
    notes: Optional[str] = None

class SnapshotOut(BaseModel):
    id: str
    account_id: str
    balance: float
    snapshot_date: date
    as_of_date: Optional[date]
    source: str
    notes: Optional[str]
    created_at: datetime
    class Config:
        from_attributes = True

@router.get("/", response_model=list[AccountOut])
def get_accounts(category: Optional[str] = None, owner_id: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Account).filter(Account.is_active == True)
    if category:
        q = q.filter(Account.category == category)
    if owner_id:
        q = q.filter(Account.owner_id == owner_id)
    return q.all()

@router.post("/", response_model=AccountOut)
def create_account(account: AccountCreate, db: Session = Depends(get_db)):
    db_account = Account(**account.model_dump())
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account

@router.put("/{account_id}", response_model=AccountOut)
def update_account(account_id: str, account: AccountCreate, db: Session = Depends(get_db)):
    db_account = db.query(Account).filter(Account.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")
    for k, v in account.model_dump().items():
        setattr(db_account, k, v)
    db.commit()
    db.refresh(db_account)
    return db_account

@router.delete("/{account_id}")
def delete_account(account_id: str, db: Session = Depends(get_db)):
    db_account = db.query(Account).filter(Account.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")
    db_account.is_active = False
    db.commit()
    return {"ok": True}

@router.post("/snapshots/", response_model=SnapshotOut)
def add_snapshot(snapshot: SnapshotCreate, db: Session = Depends(get_db)):
    db_snapshot = BalanceSnapshot(**snapshot.model_dump())
    db.add(db_snapshot)
    db.commit()
    db.refresh(db_snapshot)
    return db_snapshot

@router.get("/{account_id}/snapshots/", response_model=list[SnapshotOut])
def get_snapshots(account_id: str, db: Session = Depends(get_db)):
    return db.query(BalanceSnapshot)\
             .filter(BalanceSnapshot.account_id == account_id)\
             .order_by(BalanceSnapshot.snapshot_date.desc())\
             .all()
