# FinanceOS — Project Context for Claude

## What This Is
A local-first personal finance dashboard. All data stored on-device in
SQLite. No cloud, no external services.

## Tech Stack
- Backend: Python 3.12, FastAPI, SQLAlchemy, SQLite
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

## Auth
- LOGIN_PASSPHRASE in backend/.env gates the login screen
- If empty, app auto-logs in (dev mode)
- Token stored in sessionStorage, cleared on browser close
- DB_PASSPHRASE is separate — left empty for now (DB not encrypted yet)
- Current login passphrase: set in backend/.env (never commit this)

## Architecture
- backend/main.py — FastAPI entry point, all routers registered here
- backend/app/models/models.py — All SQLAlchemy models
- backend/app/api/v1/ — owners.py, accounts.py, networth.py, auth.py, backup.py
- backend/app/core/ — config.py, database.py, auth.py (require_auth dependency)
- frontend/app/ — Next.js pages
- frontend/components/ — Sidebar.tsx, LayoutShell.tsx, AuthGuard.tsx
- frontend/lib/auth.ts — getToken, setToken, clearToken, apiFetch

## API Endpoints (http://localhost:8000)
- GET        /api/v1/auth/status
- POST       /api/v1/auth/login
- GET/POST   /api/v1/owners/
- GET/POST/PUT/DELETE /api/v1/accounts/
- POST       /api/v1/accounts/snapshots/  (upsert by account+date)
- GET        /api/v1/accounts/{id}/snapshots/
- GET        /api/v1/networth/summary
- GET        /api/v1/networth/history
- GET        /api/v1/backup/download
- POST       /api/v1/backup/restore

## All API calls from frontend use apiFetch() from @/lib/auth
## This automatically adds x-auth-token header to every request

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
- Owners: self | spouse | child | joint

## Pages Built
- /                             — Dashboard
- /networth                     — Net worth history chart + allocation pie
- /balances                     — Bulk balance entry (clickable account names)
- /accounts/[id]                — Account detail, history chart, snapshot table
- /accounts/category/[category] — All accounts in a category
- /settings                     — Household members + account management
- /login                        — Passphrase login screen
- /backup                       — Download and restore finance.db

## Sidebar Routes
- Overview: /, /networth, /balances
- Assets: /accounts/category/cash|taxable|retirement|hsa|alternative|manual
- Liabilities: /accounts/category/credit_card|loan
- Planning: /insurance, /spending, /reviews (pages not built yet)
- System: /backup, /settings
- Footer: Lock button (clears token, redirects to /login)

## What is NOT Built Yet (planned)
- /insurance    — Insurance policy tracker
- /spending     — Transaction entry + category breakdown
- /reviews      — Monthly/quarterly/yearly review cards
- Future planning — projections, budget vs actual
- CSV import    — 401k statements + credit card transactions
- DB encryption — DB_PASSPHRASE + SQLCipher (deferred, needs fresh DB)
- Alembic migrations — schema versioning (TODO)

## Git Workflow
- main — stable (tagged, pushed to GitHub)
- dev  — active development
- Latest tag: v0.6.2

## Key Decisions (do not revisit)
- No Plaid, no cloud, no auth server
- Manual balance entry, snapshot-based history
- Localhost only, single user
- LOGIN_PASSPHRASE = app login, DB_PASSPHRASE = DB encryption (separate)

## Resuming in a New Conversation
Say: "I am building FinanceOS. Here is the context:" then paste this file.
