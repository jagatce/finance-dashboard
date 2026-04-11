from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.models import Owner
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

router = APIRouter()

class OwnerCreate(BaseModel):
    name: str
    member_type: str = "self"

class OwnerOut(BaseModel):
    id: str
    name: str
    member_type: str
    created_at: datetime
    class Config:
        from_attributes = True

@router.get("/", response_model=list[OwnerOut])
def get_owners(db: Session = Depends(get_db)):
    return db.query(Owner).all()

@router.post("/", response_model=OwnerOut)
def create_owner(owner: OwnerCreate, db: Session = Depends(get_db)):
    db_owner = Owner(name=owner.name, member_type=owner.member_type)
    db.add(db_owner)
    db.commit()
    db.refresh(db_owner)
    return db_owner

@router.delete("/{owner_id}")
def delete_owner(owner_id: str, db: Session = Depends(get_db)):
    owner = db.query(Owner).filter(Owner.id == owner_id).first()
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    db.delete(owner)
    db.commit()
    return {"ok": True}
