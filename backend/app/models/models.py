import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Boolean, Date, DateTime, Integer, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

def gen_uuid():
    return str(uuid.uuid4())

# ── Owners ────────────────────────────────────────────────────────────────────
class Owner(Base):
    __tablename__ = "owners"
    id          = Column(String, primary_key=True, default=gen_uuid)
    name        = Column(String, nullable=False)
    member_type = Column(String, default="self")  # self | spouse | joint
    created_at  = Column(DateTime, default=datetime.utcnow)
    accounts           = relationship("Account", back_populates="owner")
    income_entries     = relationship("IncomeEntry", back_populates="owner")
    insurance_policies = relationship("InsurancePolicy", back_populates="owner")

# ── Accounts ──────────────────────────────────────────────────────────────────
class Account(Base):
    __tablename__ = "accounts"
    id          = Column(String, primary_key=True, default=gen_uuid)
    owner_id    = Column(String, ForeignKey("owners.id"), nullable=False)
    name        = Column(String, nullable=False)
    institution = Column(String)
    category    = Column(String, nullable=False)
    subtype     = Column(String)
    currency    = Column(String, default="USD")
    is_active   = Column(Boolean, default=True)
    notes       = Column(Text)
    created_at  = Column(DateTime, default=datetime.utcnow)
    owner     = relationship("Owner", back_populates="accounts")
    snapshots = relationship("BalanceSnapshot", back_populates="account")

# ── Balance Snapshots ─────────────────────────────────────────────────────────
class BalanceSnapshot(Base):
    __tablename__ = "balance_snapshots"
    id            = Column(String, primary_key=True, default=gen_uuid)
    account_id    = Column(String, ForeignKey("accounts.id"), nullable=False)
    balance       = Column(Float, nullable=False)
    snapshot_date = Column(Date, nullable=False)
    as_of_date    = Column(Date)
    source        = Column(String, default="manual")
    notes         = Column(Text)
    created_at    = Column(DateTime, default=datetime.utcnow)
    account = relationship("Account", back_populates="snapshots")

# ── Net Worth Snapshots ───────────────────────────────────────────────────────
class NetWorthSnapshot(Base):
    __tablename__ = "net_worth_snapshots"
    id                      = Column(String, primary_key=True, default=gen_uuid)
    snapshot_date           = Column(Date, nullable=False)
    total_assets            = Column(Float, default=0)
    total_liabilities       = Column(Float, default=0)
    net_worth               = Column(Float, default=0)
    owner_breakdown_json    = Column(Text)
    category_breakdown_json = Column(Text)
    created_at              = Column(DateTime, default=datetime.utcnow)

# ── Transactions ──────────────────────────────────────────────────────────────
class Transaction(Base):
    __tablename__ = "transactions"
    id               = Column(String, primary_key=True, default=gen_uuid)
    account_id       = Column(String, ForeignKey("accounts.id"), nullable=False)
    transaction_date = Column(Date, nullable=False)
    posted_date      = Column(Date)
    description      = Column(String)
    amount           = Column(Float, nullable=False)
    category         = Column(String)
    subcategory      = Column(String)
    merchant         = Column(String)
    notes            = Column(Text)
    created_at       = Column(DateTime, default=datetime.utcnow)

# ── Spend Categories ──────────────────────────────────────────────────────────
class SpendCategory(Base):
    __tablename__ = "spend_categories"
    id              = Column(String, primary_key=True, default=gen_uuid)
    name            = Column(String, nullable=False)
    parent_category = Column(String)
    color           = Column(String)
    icon            = Column(String)
    created_at      = Column(DateTime, default=datetime.utcnow)

# ── Retirement Fund Holdings ──────────────────────────────────────────────────
class RetirementFundHolding(Base):
    __tablename__ = "retirement_fund_holdings"
    id             = Column(String, primary_key=True, default=gen_uuid)
    account_id     = Column(String, ForeignKey("accounts.id"), nullable=False)
    statement_date = Column(Date, nullable=False)
    fund_name      = Column(String, nullable=False)
    fund_ticker    = Column(String)
    fund_type      = Column(String)
    fund_category  = Column(String)
    balance        = Column(Float)
    units          = Column(Float)
    unit_price     = Column(Float)
    pct_of_account = Column(Float)
    ytd_return     = Column(Float)
    created_at     = Column(DateTime, default=datetime.utcnow)

# ── Insurance Policies ────────────────────────────────────────────────────────
class InsurancePolicy(Base):
    __tablename__ = "insurance_policies"
    id                = Column(String, primary_key=True, default=gen_uuid)
    owner_id          = Column(String, ForeignKey("owners.id"), nullable=False)
    policy_type       = Column(String, nullable=False)
    provider          = Column(String)
    policy_number     = Column(String)
    coverage_amount   = Column(Float)
    premium_amount    = Column(Float)
    premium_frequency = Column(String, default="monthly")
    premium_due_date  = Column(Integer)
    renewal_date      = Column(Date)
    deductible        = Column(Float)
    notes             = Column(Text)
    is_active         = Column(Boolean, default=True)
    created_at        = Column(DateTime, default=datetime.utcnow)
    owner = relationship("Owner", back_populates="insurance_policies")

# ── HSA Snapshots ─────────────────────────────────────────────────────────────
class HSASnapshot(Base):
    __tablename__ = "hsa_snapshots"
    id                         = Column(String, primary_key=True, default=gen_uuid)
    account_id                 = Column(String, ForeignKey("accounts.id"), nullable=False)
    snapshot_date              = Column(Date, nullable=False)
    cash_balance               = Column(Float, default=0)
    investment_balance         = Column(Float, default=0)
    ytd_contributions          = Column(Float, default=0)
    ytd_employer_contributions = Column(Float, default=0)
    annual_limit               = Column(Float)
    created_at                 = Column(DateTime, default=datetime.utcnow)

# ── Income Entries ────────────────────────────────────────────────────────────
class IncomeEntry(Base):
    __tablename__ = "income_entries"
    id             = Column(String, primary_key=True, default=gen_uuid)
    owner_id       = Column(String, ForeignKey("owners.id"), nullable=False)
    source_name    = Column(String, nullable=False)
    income_type    = Column(String)
    amount         = Column(Float, nullable=False)
    frequency      = Column(String, default="monthly")
    effective_date = Column(Date)
    end_date       = Column(Date)
    is_gross       = Column(Boolean, default=True)
    notes          = Column(Text)
    created_at     = Column(DateTime, default=datetime.utcnow)
    owner = relationship("Owner", back_populates="income_entries")

# ── Reviews ───────────────────────────────────────────────────────────────────
class Review(Base):
    __tablename__ = "reviews"
    id               = Column(String, primary_key=True, default=gen_uuid)
    period_type      = Column(String, nullable=False)
    period_start     = Column(Date, nullable=False)
    period_end       = Column(Date, nullable=False)
    net_worth_start  = Column(Float)
    net_worth_end    = Column(Float)
    net_worth_change = Column(Float)
    total_income     = Column(Float)
    total_expenses   = Column(Float)
    savings_amount   = Column(Float)
    savings_rate     = Column(Float)
    notes            = Column(Text)
    generated_at     = Column(DateTime, default=datetime.utcnow)
