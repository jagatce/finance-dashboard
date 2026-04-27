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

### Projections Page — /projections
- 3 scenarios: Conservative, Base, Optimistic
- Each scenario: configurable cash/investment/retirement return rates
- 10-year net worth projection chart (3 lines)
- Asset breakdown at year 10 per scenario (cash, investments, retirement)
- FIRE number: 25x annual spending (overridable)
- Milestone dates per scenario ($500k, $750k, $1M, $1.5M, $2M)
- Return rate assumptions saved to DB via user_settings table
- GET/PUT /api/v1/cashflow/settings/{key} — generic key-value settings API
- GET /api/v1/cashflow/projections/inputs — current balances by bucket + avg savings

### Bug Fix — BofA Mortgage Payment
- UNFCU DES:CK-WTH was incorrectly in BOFA_SKIP_SIGNALS
- Mortgage payment (~$8,854/month) was being silently dropped on import
- Fixed: only AMERICAN EXPRESS and CHASE CREDIT CRD payments are skipped
- Reimported all 3 BofA statements to capture correct data

### New DB Tables
- user_settings: key-value store for app preferences (projection scenarios, future settings)

## Mortgage Tracker — /mortgage (v0.9.5)

### Overview
Pure audit trail — zero coupling to networth/cashflow/projections.
Tracks full history: original purchase + each refinance + monthly payments.

### Data Model (new tables — isolated island)
- mortgages: property record (name, address, purchase price/date)
- mortgage_loans: one row per loan event (purchase/refinance/payoff)
  - Fields: loan_type (fixed/arm), original_balance, rate, term_months,
    start_date, end_date, monthly_escrow, monthly_extra_principal,
    closing_costs, down_payment, ARM fields (initial_period, cap, lifetime_cap)
  - Editable: rate, escrow, extra_principal, notes
  - On refinance: previous active loan auto-closed
- mortgage_payments: actual payment log (principal, interest, escrow, extra_principal, balance_after)

### Pages
- /mortgage — property list, add property
- /mortgage/[id] — 5 tabs:
  - Overview: active loan summary cards
  - Loans: full history timeline, add loan/refi, inline edit, delete
  - Amortization: full schedule (scrollable), extra payments highlighted green
  - Payoff Calculator: enter extra monthly payment → months saved + interest saved
  - Payments: log actual payments with principal/interest/escrow/extra split

### Backend (app/api/v1/mortgage.py — 9 routes)
- GET/POST /api/v1/mortgage/ — list/create properties
- GET/DELETE /api/v1/mortgage/{id} — get with loans / delete cascade
- POST /api/v1/mortgage/loan/add — add loan or refi
- PUT/DELETE /api/v1/mortgage/loan/{id} — edit (rate/escrow/extra/notes) / delete
- GET /api/v1/mortgage/loan/{id}/amortization — full schedule + payoff stats
- GET /api/v1/mortgage/loan/{id}/payments — payment history
- POST /api/v1/mortgage/payment/add — log payment
- DELETE /api/v1/mortgage/payment/{id} — delete payment

### Amortization math
- Standard amortization formula with optional extra payments
- One-time extras pulled from mortgage_payments table
- Recurring extra from monthly_extra_principal field
- Base vs with-extras comparison for payoff calculator
- ARM support: fixed initial period, then rate steps by arm_cap (capped at lifetime_cap)

## Home Equity in Net Worth (v0.9.6)
- New `real_estate` asset category — amber color (#f59e0b)
- Market value entered on /mortgage page (Set Value / Update Value button)
- Equity = market value - latest UNFCU mortgage balance snapshot
- Auto-included in net worth summary + category breakdown
- Shows in dashboard Assets section and /networth allocation pie
- mortgages table: added estimated_market_value + market_value_date columns
- PUT /api/v1/mortgage/{id} — update market value + other fields
- GET /api/v1/mortgage/equity — returns equity per property
- Fixed: /equity route ordering (must be before /{mortgage_id} in FastAPI)
- Loan management: Close Loan button sets is_active=0 + end_date
- On refinance: previous active loan auto-closed

## Tax Efficiency — /holdings/tax-efficiency (v0.9.7)

### Overview
Standalone page under Holdings sidebar. Zero coupling to existing systems.
Analyzes asset location across tax-advantaged vs taxable accounts.

### How it works
- Loads all holdings with current_value > 0
- User maps each holding account_id to a tax treatment type
- Mapping saved to user_settings table (key: holdings_account_types)
- Each position classified by tax efficiency: high/medium/low
- Score = 100 minus weighted deductions for misplaced high-tax assets
- Grade: A (≥90), B (≥75), C (≥60), D (<60)

### Asset Classification
- High tax: bonds, target date funds (20XX pattern), YieldMax/covered call ETFs, dividend ETFs
- Medium: international funds (foreign tax credit benefit in taxable), mutual funds
- Low: broad index ETFs, stocks
- Best locations: high-tax → traditional_401k/roth/hsa, international → taxable, low → anywhere

### Account Types
- traditional_401k, roth, taxable, hsa, unknown
- Mapping editable inline on the page, persisted to DB

### Pages & API
- /holdings/tax-efficiency — standalone page
- GET /api/v1/holdings/tax-efficiency — compute score + matrix + recommendations
- POST /api/v1/holdings/tax-efficiency/mapping — save account type mapping

## Holdings Review — /holdings/review (v0.9.8-9)

### Overview
Standalone page under Holdings. Zero coupling to networth/cashflow.
1-year performance vs S&P 500 + 200 EMA trend analysis per position.

### How it works
- Fetches 1-year price history via yfinance for all tickered positions
- Computes 1-year return + 200 EMA per ticker
- Compares vs SPY 1-year return → status flag
- Results cached in holdings_review_cache table (instant page load)
- Refresh button triggers fresh yfinance fetch (~30-60 sec)

### Status Flags
- Outperform: position return > SPY + 5%
- In-line: within ±5% of SPY
- Underperform: position return < SPY - 5%
- Watch: price below 200 EMA regardless of return
- N/A: non-tickered/cusip funds (use proxy)

### Proxy Mapping for N/A Funds
- Auto-assign proxy ETF from fund name keywords (no config needed)
- Keywords: "large cap"→SPY, "small/mid"→VXF, "international"→VXUS, "bond"→AGG, etc.
- Manual override per fund stored in user_settings (key: fund_proxy_mapping)
- Proxy mapping editor in UI — shows auto-assigned proxy, allows override

### Summary Cards (top of page)
- Portfolio 1Y: weighted avg return across all positions with data
- S&P 500 1Y: SPY benchmark return
- Per status: count + weighted avg return % + total $ value

### New DB Tables
- holdings_review_cache: caches full review result (id='latest')

### Backend
- GET /api/v1/holdings/review?refresh=bool — returns cached or fresh
- GET/POST /api/v1/holdings/review/proxy-mapping — manage proxy overrides
- app/services/holdings_review.py — yfinance fetch, EMA, status logic, proxy rules

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

Current stable base: main (v0.9.9-holdings-review)
Holdings + Claude Sensor + Cash Flow (spending, income, savings rate, monthly review,
import history, category breakdown, trends) are complete and merged to main.
All new features should branch from main.

## Folder-Based Import — feature/folder-import (v1.0.0)

### Overview
Replaces browser upload UI with a folder-watching strategy.
Drop CSVs/PDFs into the right folder, hit Scan on /import page, import.
Zero change to isolation boundaries — router is a delivery mechanism only.

### Folder Structure
~/finance-dashboard/data/
  spending/
    american_express_blue_jp/
    american_express_blue_rk/
    american_express_delta_jp/
    american_express_delta_rk/
    bank_of_america_checking/
    chase_amazon_jp/
    chase_freedom_jp/
    chase_freedom_rk/
  holdings/
    ally_roth_ira/
    betterment_kids_fund/
    blackduck_401k/
    dell_401k/
    empower_aegis_401k/
    etrade_snps/
    fidelity_enhance_therapy/
    fidelity_hsa/
    fidelity_individual_investment/
    jetaka_llc/
    m1_finance/
    nepc_bpas_403/
    personal_capital_sip/
    robinhood_backdoor_roth_ira/
    robinhood_individual_investment/
    snps_401k/
    timberland_rental_income_fund/
    vanguard_roth_ira/
    vanguard_taxable/

### Folder Naming Convention
Folder name = _normalize(account.name):
  - strip(), lowercase
  - remove apostrophes, dashes, dots
  - all non-alphanumeric runs -> underscore
  - strip leading/trailing underscores
Example: 'Fidelity - Individual Investment' -> 'fidelity_individual_investment'
         'American Express Blue JP'         -> 'american_express_blue_jp'
This is mechanical — folder names are always derived from DB account names, never invented.

### Dedup Strategy
File identity = SHA256 hash of file bytes stored in import_batches.file_hash.
Same file dropped again = status "imported" on scan, not re-imported unless forced.
Filename alone is NOT used for dedup (same name, different content = new import).

### New Files
- backend/app/services/folder_scanner.py — scan_all(db) returns spending+holdings file statuses
- backend/app/api/v1/import_router.py    — GET /scan, POST /run, GET /batches, POST /batches/{id}/rerun
- backend/migrate_folder_import.py       — adds file_hash + folder_path to import_batches (already run)
- frontend/app/import/page.tsx           — /import page, scan + select + import UI

### DB Changes
import_batches table: two new columns (already migrated)
  file_hash   TEXT   — SHA256 of file bytes
  folder_path TEXT   — absolute path to subfolder on disk
No other tables touched.

### ImportBatch SQLAlchemy Model
Added to app/models/models.py (was missing — table existed but no ORM class).
Maps to existing import_batches table exactly.

### Isolation — Absolute Rules (do not revisit)

HOLDINGS island — writes only to: holdings, price_cache, holdings_analysis, import_batches
  Powers only: /holdings, /holdings/analysis, /holdings/tax-efficiency, /holdings/review
  NEVER touches: balance_snapshots, net_worth_snapshots, accounts balances, dashboard NW,
                 transactions, income_transactions, spend_categories

CASH FLOW island — writes only to: transactions, income_transactions, reviews, import_batches
  Powers only: /cashflow (Spending/Income/Savings Rate/Recurring/Monthly Review tabs),
               /forecast, /projections
  NEVER touches: holdings tables, price_cache, balance_snapshots, dashboard NW number,
                 accounts page balances

BALANCES / NET WORTH — driven by balance_snapshots only
  Entered manually on /balances page
  Powers: dashboard, /networth, /accounts, /accounts/category/*
  NEVER reads from holdings or transactions tables

FOLDER IMPORT ROUTER — delivery mechanism only
  Calls existing parsers: cashflow_import.py (spending) and holdings_import.py (holdings)
  Adds zero new coupling between islands
  Isolation that existed before this feature is fully preserved after it

### Resuming This Feature
Branch: feature/folder-import
Status at last session: scanner verified all-OK, ImportBatch model added to models.py,
  migration run, folders created. Next: write import_router.py, register in main.py,
  build /import frontend page, add sidebar entry.
Before writing router, confirm: cashflow_import.py parse_csv/detect_bank signatures,
  holdings_import.py parse_holdings signature, import_batches id format (UUID vs int).

## Data Backup — Pre Folder-Import Migration

Before wiping live data to start fresh with folder-based import, all four
tables were backed up to _bak_ tables in the same DB. Counts at backup time:
  transactions:   78 rows
  income_entries: 0 rows
  import_batches: 10 rows
  holdings:       162 rows

### Restore command (if needed)
sqlite3 ~/finance-dashboard/backend/finance.db << 'SQL'
INSERT INTO transactions   SELECT * FROM _bak_transactions;
INSERT INTO income_entries SELECT * FROM _bak_income_entries;
INSERT INTO import_batches SELECT * FROM _bak_import_batches;
INSERT INTO holdings       SELECT * FROM _bak_holdings;
SQL

### Drop backups (once folder import is verified stable)
sqlite3 ~/finance-dashboard/backend/finance.db << 'SQL'
DROP TABLE _bak_transactions;
DROP TABLE _bak_income_entries;
DROP TABLE _bak_import_batches;
DROP TABLE _bak_holdings;
SQL

### Additional tables wiped during folder-import migration
  price_cache:           131 rows (holdings prices — repopulated on next price refresh)
  holdings_analysis:     1 row   (Claude analysis — repopulated on next analysis run)
  holdings_review_cache: 1 row   (1Y review cache — repopulated on next review refresh)
  ticker_analysis:       18 rows (sensor analysis — repopulated on next sensor refresh)
  income_entries:        0 rows  (BofA income rows go to transactions, not income_entries)

  income_transactions:   27 rows (BofA income split rows — separate table from income_entries)
  Note: income_transactions is the Cash Flow > Income tab source, backed up to _bak_income_transactions

## Folder Import — Debug Status (current session end)

### What works
- Scanner: scan_all() correctly finds files, matches accounts, deduplicates by SHA256
- Router: POST /api/v1/import/run reaches backend, parse_transactions returns 10 rows
- Batch created in DB session (flush succeeds, id generated)
- commit() called but "DEBUG commit done" never prints — silent failure on commit

### Root cause hypothesis
Transaction model has account_id = Column(String, ForeignKey("accounts.id"), nullable=False)
The router sets row["account_id"] = str(f.account_id) where f.account_id is an int from DB.
FK constraint may be failing silently — accounts.id is VARCHAR (UUID), not int.
Need to verify: what does f.account_id actually contain vs what accounts.id looks like.

### Fix to try next session
1. Check accounts.id format:
   sqlite3 finance.db "SELECT id, name FROM accounts WHERE name LIKE '%Chase Freedom JP%';"

2. Check what parse_transactions returns for each row's keys:
   Print first row from parsed["transactions"] to see all keys and values

3. Likely fix: the Transaction model FK or a column mismatch is causing rollback on commit.
   Try wrapping commit in try/except to surface the real error:

In _do_spending(), replace:
    db.commit()
with:
    try:
        db.commit()
        print('DEBUG commit done')
    except Exception as e:
        print(f'DEBUG commit FAILED: {e}')
        db.rollback()
        raise

### Files written this session
- backend/app/services/folder_scanner.py        DONE
- backend/app/api/v1/import_router.py           DONE (has debug logs, clean before tagging)
- backend/app/models/models.py                  DONE (ImportBatch, batch_id on Transaction/Holding/IncomeEntry)
- backend/migrate_folder_import.py              DONE (already run)
- frontend/app/import/page.tsx                  DONE (has debug logs, clean before tagging)
- frontend/components/Sidebar.tsx               DONE (Import entry added with Upload icon)
- main.py                                       DONE (import_router registered)

### Next session start checklist
1. git status — confirm on feature/folder-import branch
2. Apply the commit try/except fix above
3. Run import, confirm commit error surfaces
4. Fix root cause (likely FK or column mismatch)
5. Verify transactions appear in DB after import
6. Test BofA CSV (spending + income split)
7. Test a holdings CSV (Fidelity or Betterment)
8. Remove all DEBUG print statements
9. git commit + tag v1.0.0-folder-import
10. Update CLAUDE.md with final stable state

## Folder Import — Session 2 Progress

### What works end-to-end
- Chase CSV: parses, auto-categorizes via Claude, inserts to transactions ✅
- BofA CSV: splits correctly — spending → transactions, income → income_transactions ✅
- Holdings CSV: parses and inserts to holdings table ✅
- Dedup: same file hash = "imported" on rescan, no double import ✅
- Re-import: force_reimport=True wipes old batch and re-runs ✅

### Key fixes made this session
1. Transaction model was missing owner_id, source, is_recurring, batch_id — added
2. Holding + IncomeEntry models missing batch_id — added + migrated
3. date columns from parse_transactions come as strings — convert with strptime before ORM insert
4. datetime name collision inside loop — use `import datetime as dt` inside loop
5. BofA income rows are transaction-shaped — must go to income_transactions via raw SQL
   NOT into transactions table and NOT into income_entries table
   Uses same SQL pattern as cashflow.py lines 235-255
6. Unknown keys from parse_transactions (e.g. full_description, owner_hint) must be
   stripped before Transaction(**row) — use valid_cols allowlist
7. Auto-categorize: _auto_categorize() calls Claude API (claude-opus-4-5) in one batch
   per file, applied to spending transactions only, non-fatal if API fails

### income_transactions insert shape (must match exactly)
    (id, owner_id, date, source_name, income_type, amount, notes, created_at)
    owner_id = inc.get("owner_id") or inc.get("owner_hint") or "unknown"
    date     = inc.get("transaction_date", "")   # string YYYY-MM-DD
    notes    = inc.get("full_description")

### valid_cols for Transaction insert
    "id", "account_id", "transaction_date", "posted_date", "description",
    "amount", "category", "subcategory", "merchant", "notes", "created_at",
    "owner_id", "source", "is_recurring", "batch_id"

### Outstanding issues to fix next session
1. Holdings page shows account_id (UUID) instead of account name
   Fix: JOIN holdings with accounts table in GET /api/v1/holdings/ endpoint
   OR store account_name on the holding row at import time (simpler)
2. Need to batch-test all CSV/PDF files together before marking feature complete
   JP will provide all files — test import flow for each bank/broker
3. Remove all remaining debug prints from import_router.py
4. git commit + tag v1.0.0-folder-import once all files tested

### Files changed this session (all on feature/folder-import branch)
- backend/app/api/v1/import_router.py   — income fix, auto-categorize, date conversion
- backend/app/models/models.py          — Transaction 4 cols, Holding+IncomeEntry batch_id
- backend/app/services/folder_scanner.py — complete
- frontend/app/import/page.tsx          — complete (minor defensive fixes)
- frontend/components/Sidebar.tsx       — Import entry with Upload icon

### Next session start
1. git status — confirm on feature/folder-import
2. Fix holdings account name display (see issue #1 above)
3. Receive all CSV/PDF files from JP, drop into folders, batch test
4. Fix any parser errors that surface
5. Clean debug prints, commit, tag
