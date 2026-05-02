# FinanceOS — Project Context for Claude

## What This Is
A local-first personal finance dashboard. All data stored on-device in SQLite.
No cloud, no external services.

## Tech Stack
- Backend: Python 3.12, FastAPI, SQLAlchemy, SQLite
- Frontend: Next.js 16, TypeScript, Tailwind CSS, Recharts
- Package managers: uv (Python), npm (Node)
- Location: ~/finance-dashboard/
- GitHub: https://github.com/jagatce/finance-dashboard

## Running the App
```
Terminal 1 — Backend:
  cd ~/finance-dashboard/backend
  .venv/bin/uvicorn main:app --reload --port 8000   # venv directly — NOT uv run

Terminal 2 — Frontend:
  cd ~/finance-dashboard/frontend
  npm run dev
```
Open http://localhost:3000

## Auth
- `LOGIN_PASSPHRASE` in `backend/.env` gates the login screen. Empty = auto-login (dev mode)
- Token stored in `sessionStorage` as `fineos_token`, cleared on browser close
- `DB_PASSPHRASE` — separate, not yet implemented, leave empty

## Environment Variables (backend/.env)
```
LOGIN_PASSPHRASE=...         # gates /login. Empty = auto-login
DB_PASSPHRASE=               # DB encryption (not yet implemented)
ANTHROPIC_API_KEY=sk-ant-... # required for sensor, analysis, auto-categorize
```
`load_dotenv()` is called in `backend/app/core/config.py`.
`config.py` MUST be imported at line 1 of `main.py` before any routers:
```python
from app.core import config  # noqa: F401
```

## Architecture
```
backend/main.py                        — FastAPI entry, all routers registered
backend/app/models/models.py           — All SQLAlchemy models
backend/app/api/v1/
  accounts.py, auth.py, backup.py, cashflow.py,
  holdings.py, import_router.py, mortgage.py,
  networth.py, owners.py, sensor.py
backend/app/core/
  config.py (load_dotenv), database.py, auth.py (require_auth)
backend/app/services/
  cashflow_import.py, folder_scanner.py, holdings_import.py,
  holdings_review.py, price_service.py, sensor_service.py,
  technicals_service.py, analysis_service.py
frontend/app/                          — Next.js pages
frontend/components/                   — Sidebar.tsx, LayoutShell.tsx, AuthGuard.tsx
frontend/lib/auth.ts                   — getToken, setToken, clearToken, apiFetch
```
All frontend API calls use `apiFetch()` — automatically adds `x-auth-token` header.

## API Endpoints (http://localhost:8000)

### Core — DO NOT CHANGE
```
GET/POST   /api/v1/owners/
GET/POST/PUT/DELETE /api/v1/accounts/
POST       /api/v1/accounts/snapshots/     (upsert by account+date)
GET        /api/v1/accounts/{id}/snapshots/
GET        /api/v1/auth/status
POST       /api/v1/auth/login
GET        /api/v1/networth/summary
GET        /api/v1/networth/history
GET        /api/v1/backup/download
POST       /api/v1/backup/restore
```

### Holdings
```
POST       /api/v1/holdings/import
GET        /api/v1/holdings/
GET        /api/v1/holdings/summary
GET        /api/v1/holdings/analysis
POST       /api/v1/holdings/analysis/refresh
GET        /api/v1/holdings/prices/refresh
DELETE     /api/v1/holdings/account/{account_id}
GET        /api/v1/holdings/review               (?refresh=bool)
GET/POST   /api/v1/holdings/review/proxy-mapping
GET        /api/v1/holdings/tax-efficiency
POST       /api/v1/holdings/tax-efficiency/mapping
POST       /api/v1/holdings/cost-basis/patch
```

### Sensor
```
GET        /api/v1/sensor/tickers
GET        /api/v1/sensor/{ticker}
POST       /api/v1/sensor/refresh/all            (must be before /{ticker}/refresh)
POST       /api/v1/sensor/{ticker}/refresh
GET/POST   /api/v1/sensor/watchlist
DELETE     /api/v1/sensor/watchlist/{ticker}
```

### Cash Flow
```
GET/POST   /api/v1/cashflow/transactions
PUT/DELETE /api/v1/cashflow/transactions/{id}
GET/POST   /api/v1/cashflow/income
GET        /api/v1/cashflow/summary
GET        /api/v1/cashflow/imports
DELETE     /api/v1/cashflow/imports/{batch_id}
GET        /api/v1/cashflow/trends
GET        /api/v1/cashflow/recurring
POST       /api/v1/cashflow/recurring/mark
GET        /api/v1/cashflow/forecast
GET        /api/v1/cashflow/projection
GET        /api/v1/cashflow/projections/inputs
GET/PUT    /api/v1/cashflow/settings/{key}
POST       /api/v1/cashflow/review/generate
```

### Mortgage
```
GET/POST   /api/v1/mortgage/
GET        /api/v1/mortgage/equity               (must be before /{id})
GET/DELETE /api/v1/mortgage/{id}
PUT        /api/v1/mortgage/{id}
POST       /api/v1/mortgage/loan/add
PUT/DELETE /api/v1/mortgage/loan/{id}
GET        /api/v1/mortgage/loan/{id}/amortization
GET        /api/v1/mortgage/loan/{id}/payments
POST       /api/v1/mortgage/payment/add
DELETE     /api/v1/mortgage/payment/{id}
```

### Futures
```
GET/POST   /api/v1/futures/import
GET        /api/v1/futures/imports
DELETE     /api/v1/futures/imports/{id}
GET        /api/v1/futures/summary
GET        /api/v1/futures/daily
GET        /api/v1/futures/instruments
GET        /api/v1/futures/top-trades
GET        /api/v1/futures/psychology
```

### Import
```
GET        /api/v1/import/scan
POST       /api/v1/import/run
GET        /api/v1/import/batches
POST       /api/v1/import/batches/{id}/rerun
```

## Database Tables

See `docs/DATA_MODEL.md` for full schema details and isolation rules.

**Existing (DO NOT TOUCH):** owners, accounts, balance_snapshots, net_worth_snapshots,
transactions, spend_categories, retirement_fund_holdings, insurance_policies,
hsa_snapshots, income_entries, reviews

**Holdings island:** holdings, price_cache, holdings_analysis, holdings_review_cache

**Cash Flow island:** income_transactions, import_batches

**Futures island:** futures_trades, futures_import_batches, futures_daily_summary, futures_monthly_summary

**Sensor island:** watchlist, ticker_analysis

**Mortgage island:** mortgages, mortgage_loans, mortgage_payments

**Settings:** user_settings

**Backup (safe to drop):** _bak_transactions, _bak_income_entries, _bak_import_batches,
_bak_holdings, _bak_income_transactions

## Isolation Rule (Critical)
Holdings, Cash Flow, Balances, and Mortgage are independent islands. They never
read from or write to each other's tables. See `docs/DATA_MODEL.md` for details.

## Data Model Key Points
- Every balance update is a snapshot (append-only, never overwrite)
- Same account + same date = upsert (no duplicates)
- Net worth = latest snapshot per account, assets minus liabilities
- Asset categories: cash, taxable, retirement, hsa, alternative, manual, real_estate
- Liability categories: credit_card, loan
- Owners: self | spouse | child | joint

## Pages Built
```
/                             — Dashboard (NW projection widget)
/networth                     — NW history chart + allocation pie
/balances                     — Bulk balance entry
/accounts/[id]                — Account detail, history chart, snapshot table
/accounts/category/[category] — All accounts in a category
/settings                     — Household members + account management
/login                        — Passphrase login
/backup                       — Download and restore finance.db
/holdings                     — Holdings table + price refresh
/holdings/analysis            — Claude portfolio analysis
/holdings/review              — 1Y performance vs S&P 500
/holdings/tax-efficiency      — Asset location score
/sensor                       — Claude Sensor (Portfolio + Research tabs)
/sensor/[ticker]              — Ticker drill-down
/futures                     — 5 tabs: Summary, Daily, Top Trades, Psychology, Import
/cashflow                     — 5 tabs: Spending, Income, Savings Rate, Recurring, Monthly Review
/forecast                     — 12-month cash flow projection
/projections                  — 10-year NW projection (3 scenarios)
/mortgage                     — Property list
/mortgage/[id]                — 5 tabs: Overview, Loans, Amortization, Payoff Calc, Payments
/import                       — Folder scan + import
```

## Sidebar Routes
- Overview: `/`, `/networth`, `/balances`
- Assets: `/accounts/category/cash|taxable|retirement|hsa|alternative|manual|real_estate`
- Liabilities: `/accounts/category/credit_card|loan`
- Holdings: `/holdings`, `/holdings/analysis`, `/holdings/review`, `/holdings/tax-efficiency`
- Planning: `/futures`, `/cashflow`, `/forecast`, `/projections`, `/mortgage`
- Claude Sensor: `/sensor`
- System: `/import`, `/backup`, `/settings`
- Footer: Lock button (clears token, redirects to `/login`)

## Import Folder Structure
```
~/finance-dashboard/data/
  spending/
    american_express_blue_jp/   american_express_blue_rk/
    american_express_delta_jp/  american_express_delta_rk/
    bank_of_america_checking/
    chase_amazon_jp/  chase_freedom_jp/  chase_freedom_rk/
  holdings/
    ally_roth_ira/        betterment_kids_fund/   blackduck_401k/
    dell_401k/            empower_aegis_401k/     etrade_snps/
    fidelity_enhance_therapy/  fidelity_hsa/      fidelity_individual_investment/
    jetaka_llc/           m1_finance/             nepc_bpas_403/
    personal_capital_sip/ robinhood_backdoor_roth_ira/
    robinhood_individual_investment/  snps_401k/
    timberland_rental_income_fund/    vanguard_roth_ira/  vanguard_taxable/
```
Folder name = `_normalize(account.name)`. See `docs/PARSERS.md`.

## Key Decisions (do not revisit)
- No Plaid, no cloud, no auth server — localhost only, single user
- Manual balance entry, snapshot-based history
- LOGIN_PASSPHRASE = app login, DB_PASSPHRASE = DB encryption (separate)
- Holdings = isolated island, zero coupling to balance/account system
- yfinance only for prices (no CoinGecko) — crypto via BTC-USD suffix
- Empower: no cost basis in their reports
- Robinhood: no cost basis in monthly PDFs — patch via separate CSV
- Dell 401k: nontickered funds kept, marked `fund_nontickered`, no yfinance lookup
- SNPS BrokerageLink row skipped to avoid double-counting with brok_link file

## Developer Preferences
- Always use bash/terminal commands to write files, never artifacts or file downloads
- Write code directly to the filesystem using cat, heredoc, or python3 patch scripts
- No file attachments — everything goes through the terminal

## Current Stable State — v1.1.0
- Branch: main | Tag: v1.1.0-futures | Remote: in sync
- All 22 files importing: 10 spending + 15 holdings files
- 78 transactions, 27 income rows, 185 holdings positions across 15 accounts
- Live price_cache on all holdings endpoints
- Cost basis: Fidelity ✅, Betterment ✅, M1 ✅, Robinhood Individual ✅ (patched)

### Tag history
```
v1.1.0-futures            — Futures trading dashboard (PDF import, summary, daily, top trades, psychology)
v1.0.5-sensor-timestamps  — NaN/CUSIP fixes, refresh timestamps all pages
v1.0.4-sensor-fix         — sensor Refresh All, route ordering, CUSIP guard
v1.0.3-cost-basis         — Robinhood cost basis patch endpoint
v1.0.2-holdings-live      — live price_cache across all holdings endpoints
v1.0.1-parsers            — all PDF parsers complete
v1.0.0-folder-import      — folder import, /import page, auto-categorize
v0.9.9-holdings-review    — holdings review + tax efficiency
```

## Known Gaps
- Etrade SNPS, Personal Capital SIP — no files provided yet
- Vanguard Roth IRA — no CSV export available from Vanguard
- Ally IRA: cash balance ($7,305) not imported (equities only)
- Robinhood IRA (7 positions) — cost basis not patched yet
- Cost basis patch not wired into /import UI — requires curl currently
- _bak_ tables in finance.db — safe to drop when ready

## Backlog
- Wire cost basis patch into /import UI
- Robinhood IRA cost basis (same process as individual)
- Drop _bak_ tables
- Alerts & anomaly detection
- Price chart on /sensor/[ticker] (6m OHLCV)
- /insurance — policy tracker
- DB encryption (SQLCipher + DB_PASSPHRASE)

## What is NOT Built Yet
- /insurance — policy tracker
- DB encryption (SQLCipher + DB_PASSPHRASE)
- Alembic migrations (schema versioning)
- Citi CSV parser

## Session Start Protocol
1. `git status` — confirm branch, no uncommitted changes
2. Read this file top to bottom before writing any code
3. Read the relevant file before patching it — never patch blind
4. One file at a time, verify in browser after each change
5. Full file rewrites over str.replace patches
6. `git commit` after each logical fix, not at end of session

## Docs
- `docs/PARSERS.md` — broker quirks, PDF routing, price service, is_valid_ticker, folder naming
- `docs/FEATURES.md` — complete feature summaries (sensor, cashflow, mortgage, holdings, import)
- `docs/BUGS.md` — known gotchas: curl-cffi, venv start, proxy timeout, NaN, route ordering
- `docs/DATA_MODEL.md` — full table schema, isolation boundaries, backup/restore commands
