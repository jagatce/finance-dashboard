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
- Latest tag: v0.9.2-spending-complete (safe revert point)

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

## Next Areas — Prioritized

## Cash Flow Feature — Complete (v0.9.0) ✅
- /cashflow page: 4 tabs — Spending, Income, Savings Rate, Monthly Review
- Sidebar: Planning > Cash Flow (replaces unbuilt /spending)
- Month picker shared across all tabs

### Spending Tab
- CSV import: Chase, Amex, BofA parsers (cashflow_import.py)
- Account picker dropdown (credit_card + checking accounts only)
- Stack multiple CSVs before saving
- Claude auto-categorize (batch, one API call per upload)
- Save As-Is or Categorize first — two separate buttons
- Manual add/edit/delete transactions
- Inline category override on imported rows
- BofA: auto-splits into spending + income, skips CC payments (double-count prevention)
- BofA: income signals (PAYROLL, DEPOSIT, SRECTRADE etc), skip signals (AMEX, CHASE payments)
- BofA: owner auto-detected from INDN: field (PAREKH=JP, KANSARA=RK), editable in preview

### Income Tab
- Manual line-item income entry (salary, bonus, freelance, dividend, rental, other)
- Per-person (owner) tracking
- income_transactions table (new island, zero FK to existing tables)

### Savings Rate Tab
- Full year bar chart (Recharts) — savings rate % with 20% target line
- Toggle: savings rate % view vs income/spending amounts view
- Monthly breakdown table, current month highlighted
- Summary cards: avg rate, total income, spending, saved

### Monthly Review Tab
- On-demand Claude synthesis (click Generate)
- Pulls from 4 sources: transactions, income_transactions, net_worth_snapshots, ticker_analysis
- Saved to reviews table (upsert by month)
- Stats row: income, spending, saved, savings rate
- Markdown rendered review with sections: Summary, Cash Flow, Net Worth, Portfolio, Action Items

### New DB changes
- transactions: ALTER ADD owner_id, source, is_recurring
- income_transactions: new table (island)
- reviews: reused existing table

### New backend files
- backend/app/api/v1/cashflow.py — 11 routes
- backend/app/services/cashflow_import.py — Chase/Amex/BofA parsers

### Test harness
- backend/test_import.py — 10 CSV files, 10/10 passing
- backend/test_categorize.py — Claude categorization against real data
- backend/test_data/spending/ — real CSV files (gitignored)

### Spending Tab — Additional Features (this session)
- Category breakdown panel (pie + horizontal bar chart, Recharts)
- Click category to filter transaction list — chip shown in summary bar
- Monthly trends panel — grouped bar chart per account, full year
- Import History panel — shows all import batches (filename, account, bank, count, date)
- Filter by batch — BarChart2 icon per row filters transaction list to that batch
- Delete by batch — removes all transactions for that file regardless of month span
- import_batches table — reusable pattern for holdings/401k/HSA future imports
- transactions.batch_id — FK to import_batches, set on every imported row
- GET /api/v1/cashflow/imports — returns import_batches records
- DELETE /api/v1/cashflow/imports/{batch_id} — deletes batch + all transactions
- GET /api/v1/cashflow/trends — monthly spend per account for full year

## New Features (this session)

### Recurring Transaction Manager — /cashflow Recurring tab
- Auto-detects transactions appearing in 2+ months (candidates)
- Confirmed recurring list with YTD total, months seen, one-click unmark
- Summary cards: count, est. monthly cost, est. yearly cost
- Mark/unmark via POST /api/v1/cashflow/recurring/mark
- GET /api/v1/cashflow/recurring — returns confirmed + candidates

### Cash Flow Forecast — /forecast page
- 12-month projection based on avg income + avg spending from all imported months
- Area chart: liquid balance over time (solid = actual, dashed = projected)
- Override controls — user can manually adjust income/spending assumptions
- Data quality warning when < 3 complete months available
- Monthly table with actual vs projected vs partial status badges
- GET /api/v1/cashflow/forecast — returns assumptions + 12 projections

### Net Worth Projection Widget — Dashboard
- Added to main dashboard below Assets/Liabilities cards
- Area chart: historical NW (from balance_snapshots) + 12-month projected
- Next milestone card (e.g. "Reach $1M in X months")
- Avg monthly savings assumption shown
- GET /api/v1/cashflow/projection — computes NW from balance_snapshots (no net_worth_snapshots needed)
- Note: net_worth_snapshots table exists but is never written to — projection uses balance_snapshots directly

### Product Backlog Added
- #2 Recurring manager ✅
- #3 Net worth projection widget ✅
- #5 Tax efficiency score (pending)
- #7 Cash flow forecast ✅
- #8 Alerts & anomaly detection (pending)

### Known issues / TODO
- npm run build has a Recharts tickFormatter type warning (non-blocking, works in dev)
- spend_categories table is empty — using hardcoded default categories
- Existing transactions imported before batch_id was added have no batch_id (fixed by reimport)

### Priority 1: /spending → now /cashflow (DONE)

### Priority 2: /reviews (next session)
IMPORTANT — check existing tables before creating new ones:
  - spend_categories table already exists (check schema before using)
  - reviews table already exists (check schema before using)
  - transactions table already exists (check schema before using)
  - income_entries table already exists (check schema before using)
  Run: SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name;
  to see all existing tables and their columns before designing new schema.


Manual transaction entry + bank CSV import + Claude auto-categorization.
No Plaid — privacy first. Banks export CSVs (Chase, Amex, BofA, Citi).

Data model:
  transactions: id, date, amount, description, category, account_id, owner, notes, is_recurring
  spend_categories already exists in DB (check before creating)

How it works:
  - Upload bank CSV → Claude auto-categorizes in one API call
  - Manual add/edit transactions
  - Monthly view: income, spending, savings rate, breakdown by category
  - Detect recurring transactions (Netflix, rent, etc.)

Bank CSV parsers needed (similar to holdings_import.py):
  - Chase: Date, Description, Amount (negative = expense)
  - Amex: Date, Description, Amount (positive = expense)
  - BofA: Date, Description, Amount
  - Citi: Date, Description, Debit, Credit

Claude's role: batch auto-categorize on import. One call per upload.
Returns [{description, suggested_category}] for user to confirm/override.

Pages:
  /spending — month picker, upload CSV, add manually, category breakdown, transaction list

### Priority 2: /reviews (session after spending)
Auto-generated monthly/quarterly review cards from ALL data sources.
Claude synthesizes net worth + cash flow + holdings + sensor signals.

Data model:
  reviews: id, period (2026-03), period_type (monthly|quarterly|yearly),
           review_json, notes, reviewed_at, generated_at

Review card sections:
  - Net worth delta (from balance_snapshots)
  - Cash flow: income, spending, savings rate (from transactions)
  - Holdings performance: best/worst performers (from holdings + price_cache)
  - Sensor alerts: buy/sell signals (from ticker_analysis)
  - Claude summary + action items
  - Manual notes field

/reviews is the page that makes FinanceOS sticky — answers "so what?" for all data.

### Priority 3: Deferred
- Price chart on /sensor/[ticker] (6m OHLCV via Recharts)
- /insurance — policy tracker (low complexity, low priority)
- DB encryption (SQLCipher + DB_PASSPHRASE)
- Natural language query on dashboard
- Retirement readiness projections
- Tax efficiency score (asset location analysis)

## Resuming in a New Conversation
Say: "I am building FinanceOS. Here is the context:" then paste this file.

Before writing any code, always confirm branch and create a feature branch:
  git checkout main
  git pull origin main
  git checkout -b feature/<name>   # e.g. feature/insurance, feature/spending
  git log --oneline -3

Current stable base: feature/recurring-forecast (to be merged)
Holdings + Claude Sensor + Cash Flow (spending, income, savings rate, monthly review,
import history, category breakdown, trends) are complete and merged to main.
All new features should branch from main.
