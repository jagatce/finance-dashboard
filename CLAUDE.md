# FinanceOS — Project Context for Claude

## What This Is
A local-first personal finance dashboard. All data stored on-device in
SQLite (SQLCipher encrypted). No cloud, no external services.

## Tech Stack
- Backend: Python 3.12, FastAPI, SQLAlchemy, SQLite (SQLCipher)
- Frontend: Next.js 16, TypeScript, Tailwind CSS, Recharts
- Package managers: uv (Python), npm (Node)
- Location: ~/finance-dashboard/

## Running the App
```bash
# Terminal 1 — Backend
cd ~/finance-dashboard/backend
uv run uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend  
cd ~/finance-dashboard/frontend
npm run dev
```
Open http://localhost:3000

## Architecture
- backend/main.py — FastAPI app entry point
- backend/app/models/models.py — All SQLAlchemy models
- backend/app/api/v1/ — API route files (owners, accounts, networth)
- backend/app/core/database.py — DB connection + SQLCipher setup
- frontend/app/ — Next.js pages (App Router)
- frontend/components/Sidebar.tsx — Navigation

## API Endpoints (http://localhost:8000)
- GET/POST   /api/v1/owners/
- GET/POST/PUT/DELETE /api/v1/accounts/
- POST       /api/v1/accounts/snapshots/  (upsert by account+date)
- GET        /api/v1/accounts/{id}/snapshots/
- GET        /api/v1/networth/summary
- GET        /api/v1/networth/history

## Database Tables
owners, accounts, balance_snapshots, net_worth_snapshots,
transactions, spend_categories, retirement_fund_holdings,
insurance_policies, hsa_snapshots, income_entries, reviews

## Data Model Key Points
- Every balance update is a snapshot (append-only, never overwrite)
- Same account + same date = upsert (no duplicates)
- Net worth = latest snapshot per account, assets minus liabilities
- Asset categories: cash, taxable, retirement, hsa, alternative, manual
- Liability categories: credit_card, loan
- Owners have member_type: self | spouse | child | joint

## Pages Built So Far
- / — Dashboard (net worth summary, asset/liability cards)
- /networth — Net worth history chart + allocation pie
- /balances — Bulk balance entry (account names link to detail)
- /accounts/[id] — Account detail with history chart + snapshot table
- /settings — Household members + account management (add/edit/delete)

## What's NOT Built Yet (planned)
- /accounts/[category] — Account list pages per category
- /insurance — Insurance policy tracker
- /spending — Transaction entry + category breakdown
- /reviews — Monthly/quarterly/yearly review cards
- Future planning — projections, budget vs actual
- CSV import — for 401k statements and credit card transactions
- Encryption — DB_PASSPHRASE currently empty (dev mode)

## Git Workflow
- main — stable releases (tagged v0.x.0)
- dev — active development
- feature/xxx — individual features, merge to dev then main
- Current: on dev branch
- Latest tag: v0.4.1

## Key Design Decisions (already made, don't revisit)
- No Plaid — manual balance entry by design
- No cloud DB — SQLite only, local file
- No auth — localhost only, single user
- Schema changes via Alembic migrations (not yet set up — TODO)
- Snapshot-based history — never update, always insert new date

## Household
- Jagat Parekh (self)
- Rujal Kansara (spouse)
- Kids support added (child member_type)
- 529/Custodial subtypes available

## How to Resume in a New Conversation
Tell Claude:
"I'm building FinanceOS, a local personal finance dashboard.
Read CLAUDE.md in my project for full context, then help me
continue with [what you want to build next]."
Then paste the contents of this file.
