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

## Environment Variables (backend/.env)
Required — app will start but features will fail silently without these:
  LOGIN_PASSPHRASE=...         # gates /login screen. Empty = auto-login (dev mode)
  DB_PASSPHRASE=               # DB encryption key (not yet implemented, leave empty)
  ANTHROPIC_API_KEY=sk-ant-... # required for /holdings/analysis — get from console.anthropic.com

How .env is loaded:
  - load_dotenv() is called in backend/app/core/config.py
  - config.py MUST be imported at the top of main.py BEFORE any routers
  - main.py line 1: from app.core import config  # noqa: F401
  - If this import is missing, ANTHROPIC_API_KEY will be None at runtime and analysis will fail

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

### Holdings (live)
- POST       /api/v1/holdings/import
- GET        /api/v1/holdings/
- GET        /api/v1/holdings/summary
- GET        /api/v1/holdings/analysis
- POST       /api/v1/holdings/analysis/refresh
- GET        /api/v1/holdings/prices/refresh
- DELETE     /api/v1/holdings/account/{account_id}

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

## Known Issues & Fixes

### curl-cffi on macOS (yfinance dependency)
Symptom: ImportError: dlopen(.../_wrapper.abi3.so): symbol not found in flat namespace (_SCDynamicStoreCopyProxies)
Cause: Latest curl-cffi build is broken on macOS with Homebrew Python
Fix: uv pip install "curl-cffi==0.7.4"
Must be re-applied after any uv sync or uv pip install that upgrades curl-cffi.
To pin permanently add to pyproject.toml:
  [tool.uv.overrides]
  curl-cffi = "==0.7.4"

### Always start backend with venv Python directly (not uv run)
Reason: uv run may resolve to system Python which doesn't have the pinned curl-cffi
Correct: cd ~/finance-dashboard/backend && .venv/bin/uvicorn main:app --reload --port 8000
Wrong:   uv run uvicorn main:app --reload --port 8000

### Next.js API proxy (next.config.ts)
All frontend API calls use relative URLs (/api/v1/...) via apiFetch().
Next.js must proxy these to FastAPI on port 8000.
next.config.ts must contain:
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://localhost:8000/api/:path*" }]
  }
Without this all /api/v1/* calls return 404 from Next.js.

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

## Claude Sensor Feature — Complete ✅
- /sensor page: two tabs (Portfolio from holdings, Research manual watchlist)
- Wafer rows: ticker, price, EMA200, delta, RSI, signal badge, health bar, timestamp, Analyze button
- /sensor/[ticker] drill-down: technicals panel, fundamentals panel, Claude analysis panel
- Signal: buy | sell | watch — Claude judgment based on technicals + fundamentals
- Health score: 0-100, on-demand analysis only — manual Analyze per ticker or Refresh All
- New DB tables: watchlist, ticker_analysis
- New services: technicals_service.py, sensor_service.py
- New API: /api/v1/sensor/* (7 routes)
- Sidebar: Claude Sensor with Radio icon
- Safe revert tag: v0.8.0-sensor

## Next Areas
- /insurance — insurance policy tracker
- /spending — transaction entry + category breakdown
- /reviews — monthly/quarterly review cards
- Price chart on /sensor/[ticker] (6m OHLCV via Recharts)
- DB encryption (SQLCipher + DB_PASSPHRASE)

## Resuming in a New Conversation
Say: "I am building FinanceOS. Here is the context:" then paste this file.

Before writing any code, always confirm branch and create a feature branch:
  git checkout main
  git pull origin main
  git checkout -b feature/<name>   # e.g. feature/insurance, feature/spending
  git log --oneline -3

Current stable base: main (v0.8.0)
Holdings + Claude Sensor are complete and merged to main.
All new features should branch from main.
