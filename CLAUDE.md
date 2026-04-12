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
- backend/app/api/v1/ — owners.py, accounts.py, networth.py, auth.py, backup.py, holdings.py (NEW)
- backend/app/core/ — config.py, database.py, auth.py (require_auth dependency)
- backend/app/services/ — holdings_import.py, price_service.py (NEW), analysis_service.py (NEW, TODO)
- frontend/app/ — Next.js pages
- frontend/components/ — Sidebar.tsx, LayoutShell.tsx, AuthGuard.tsx
- frontend/lib/auth.ts — getToken, setToken, clearToken, apiFetch

## API Endpoints (http://localhost:8000)
### Existing — DO NOT CHANGE
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

### New Holdings (TODO — not yet wired)
- POST       /api/v1/holdings/import
- GET        /api/v1/holdings/
- GET        /api/v1/holdings/summary
- GET        /api/v1/holdings/analysis
- POST       /api/v1/holdings/analysis/refresh
- GET        /api/v1/holdings/prices/refresh

## All API calls from frontend use apiFetch() from @/lib/auth
## This automatically adds x-auth-token header to every request

## Database Tables
### Existing — DO NOT TOUCH
owners, accounts, balance_snapshots, net_worth_snapshots,
transactions, spend_categories, retirement_fund_holdings,
insurance_policies, hsa_snapshots, income_entries, reviews

### New Holdings Island — self-contained, no FK to existing tables
holdings, price_cache, holdings_analysis

## Critical Separation — Holdings vs Balances
These are two completely independent systems. Never confuse them.

BALANCES / NET WORTH:
- Driven by balance_snapshots table
- Entered manually on /balances page (one number per account)
- Powers all existing pages: dashboard, /networth, /accounts, category pages
- This is the core of the app — always accurate, always manual entry

HOLDINGS:
- Driven by holdings, price_cache, holdings_analysis tables
- Imported via CSV/PDF on /holdings page
- Powers only /holdings and /holdings/analysis pages
- Completely additive — zero impact on balances or net worth
- Can be messy, incomplete, or missing — does not matter
- Importing holdings never updates a balance snapshot
- Deleting holdings never affects net worth

RULE: Holdings and Balances never read from or write to each other. Ever.

## Holdings Island — Key Rules
- holdings.account_id is a plain string — NO ForeignKey constraint, NO ORM relationship
- Holdings NEVER writes to existing tables
- Existing pages NEVER read from holdings tables
- Holdings is its own feature — balance snapshots and net worth unaffected
- The only files touched in existing code: main.py (2 lines) + Sidebar.tsx (1 item)

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
- Holdings: /holdings, /holdings/analysis (NEW — not yet added to sidebar)
- System: /backup, /settings
- Footer: Lock button (clears token, redirects to /login)

## What is NOT Built Yet (planned)
- /insurance    — Insurance policy tracker
- /spending     — Transaction entry + category breakdown
- /reviews      — Monthly/quarterly/yearly review cards
- Future planning — projections, budget vs actual
- DB encryption — DB_PASSPHRASE + SQLCipher (deferred, needs fresh DB)
- Alembic migrations — schema versioning (TODO)

## Holdings Feature — Build Status
### DONE
- Step 1: models.py — Holding, PriceCache, HoldingsAnalysis tables appended
- Step 2: pyproject.toml — yfinance, pdfplumber, anthropic, httpx, python-multipart added
- Step 3: holdings_import.py — All broker parsers complete and tested
  - Betterment CSV (lot-level, aggregates by ticker)
  - Fidelity CSV (all variants: standard, Dell nontickered, SNPS CUSIP mix)
  - M1 Finance CSV
  - Empower PDF (pdfplumber table extraction)
  - Robinhood PDF (text extraction, multi-account, skips $0 accounts)
- Step 4: price_service.py — yfinance wrapper with 24h TTL cache (written, NOT yet tested)

### TODO (next session)
- Step 4 test: verify price_service.py works with real tickers
- Step 5: analysis_service.py — Claude API wrapper
- Step 6: holdings.py — API routes
- Step 7: main.py — register holdings router (2 lines)
- Step 8: Sidebar.tsx — add Holdings nav item (1 item)
- Step 9: frontend/app/holdings/page.tsx — import UI + positions table
- Step 10: frontend/app/holdings/analysis/page.tsx — AI analysis view

## Broker CSV/PDF Parser Notes
- detect_broker() auto-detects from headers
- parse_holdings(filename, bytes) is the single entry point
- Betterment: lot-level, must aggregate by ticker, no as_of_date in file
- Fidelity: BOM strip, footer disclaimer rows stop at first quoted line
- Fidelity Dell: no ticker symbols, stored as fund_nontickered, yf_ticker=None
- Fidelity SNPS: BROKERAGELINK row skipped (dup with brok_link file)
- Fidelity SNPS: CUSIPs detected by ^[A-Z0-9]{9}$ regex, stored as fund_cusip
- Empower PDF: pdfplumber table extraction, as_of from "As of Date" header
- Robinhood PDF: NO tables, raw text parsing, multi-account aware
- Robinhood IRA PDF: contains Traditional ($0, skipped) + Roth (7 holdings)
- M1: BRK.B stored as-is, yfinance_ticker=BRK-B

## Price Service Notes (price_service.py)
- get_prices(tickers, db, asset_types, force_refresh) is main entry point
- Skips fund_nontickered and fund_cusip asset types
- TTL = 24 hours, checked against price_cache.updated_at
- Batch fetches via yf.download() then individual yf.Ticker().info for metadata
- _classify(info) maps yfinance quoteType to our asset_type enum

## Git Workflow
- main — stable (tagged, pushed to GitHub)
- dev  — active development
- feature/holdings — current branch
- Latest tag: v0.6.3-pre-holdings (safe revert point)

## Key Decisions (do not revisit)
- No Plaid, no cloud, no auth server
- Manual balance entry, snapshot-based history
- Localhost only, single user
- LOGIN_PASSPHRASE = app login, DB_PASSPHRASE = DB encryption (separate)
- Holdings = isolated island, zero coupling to existing balance/account system
- yfinance only for prices (no CoinGecko) — crypto via BTC-USD suffix
- Empower: no cost basis available in their reports
- Robinhood: no cost basis available in monthly PDFs
- Dell 401k: nontickered funds kept, marked fund_nontickered, no yfinance lookup
- SNPS BrokerageLink row skipped to avoid double-counting with brok_link file

## Developer Preferences
- Always use bash/terminal commands to write files, never artifacts or file downloads
- Write code directly to the filesystem using cat, heredoc, or python3 patch scripts
- No file attachments — everything goes through the terminal

## Resuming in a New Conversation
Say: "I am building FinanceOS. Here is the context:" then paste this file.
Next step: Step 4 test (price_service.py), then Steps 5-10.

Before writing any code, always confirm branch:
  git branch  # must show * feature/holdings
  git log --oneline -3
If not on feature/holdings: git checkout feature/holdings
