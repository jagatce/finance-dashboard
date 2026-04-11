# FinanceOS — Project Context for Claude

## What This Is
A local-first personal finance dashboard. All data stored on-device in
SQLite (SQLCipher encrypted). No cloud, no external services.

## Tech Stack
- Backend: Python 3.12, FastAPI, SQLAlchemy, SQLite (SQLCipher)
- Frontend: Next.js 16, TypeScript, Tailwind CSS, Recharts
- Package managers: uv (Python), npm (Node)
- Location: ~/finance-dashboard/
- GitHub: https://github.com/jagatce/finance-dashboard

## Running the App
Terminal 1 — Backend:
  cd ~/finance-dashboard/backend
  uv run uvicorn main:app --reload --port 8000

Terminal 2 — Frontend:
  cd ~/finance-dashboard/frontend
  npm run dev

Open http://localhost:3000

## Architecture
- backend/main.py — FastAPI app entry point
- backend/app/models/models.py — All SQLAlchemy models
- backend/app/api/v1/ — API route files (owners, accounts, networth)
- backend/app/core/database.py — DB connection + SQLCipher setup
- frontend/app/ — Next.js pages (App Router)
- frontend/components/Sidebar.tsx — Navigation

## API Endpoints (http://localhost:8000)
- GET/POST             /api/v1/owners/
- GET/POST/PUT/DELETE  /api/v1/accounts/
- POST                 /api/v1/accounts/snapshots/  (upsert by account+date)
- GET                  /api/v1/accounts/{id}/snapshots/
- GET                  /api/v1/networth/summary
- GET                  /api/v1/networth/history

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

## Pages Built
- /                             — Dashboard
- /networth                     — Net worth history chart + allocation pie
- /balances                     — Bulk balance entry
- /accounts/[id]                — Account detail, history chart, snapshot table
- /accounts/category/[category] — All accounts in a category
- /settings                     — Household members + account management

## Sidebar Routes
- Overview: /, /networth, /balances
- Assets: /accounts/category/cash|taxable|retirement|hsa|alternative|manual
- Liabilities: /accounts/category/credit_card|loan
- Planning: /insurance, /spending, /reviews
- System: /settings

## What's NOT Built Yet (planned)
- /insurance    — Insurance policy tracker
- /spending     — Transaction entry + category breakdown
- /reviews      — Monthly/quarterly/yearly review cards
- Future planning — projections, budget vs actual
- CSV import    — 401k statements + credit card transactions
- Alembic migrations — schema versioning (TODO)
- DB encryption — DB_PASSPHRASE empty in dev

## Git Workflow
- main — stable (tagged, pushed to GitHub)
- dev  — active development
- feature/xxx — individual features
- Latest tag: v0.5.1

## Key Decisions (don't revisit)
- No Plaid, no cloud, no auth
- Manual balance entry, snapshot-based history
- Localhost only

## Household
- Two adults (self + spouse) + child support
- member_type options: self | spouse | child | joint
- 529/Custodial account subtypes available for children

## Resuming in a New Conversation
Say: "I'm building FinanceOS. Here's the context:" then paste this file.
