# FinanceOS — Completed Features

All features below are merged to `main` and fully working.

---

## Claude Sensor — /sensor (v0.8.0)

**Pages:** `/sensor` (Portfolio + Research tabs), `/sensor/[ticker]` (drill-down)

**What it does:** Technical + fundamental analysis per ticker. On-demand Claude Haiku synthesis → signal (buy/sell/watch) + health score (0–100).

**Wafer row fields:** ticker, price, EMA200, delta, RSI, signal badge, health bar, timestamp, Analyze button

**Drill-down panels:** technicals, fundamentals, Claude analysis

**API:** `GET /api/v1/sensor/tickers`, `GET /api/v1/sensor/{ticker}`, `POST /api/v1/sensor/{ticker}/refresh`, `POST /api/v1/sensor/refresh/all`, `GET/POST /api/v1/sensor/watchlist`, `DELETE /api/v1/sensor/watchlist/{ticker}`

**DB tables:** `watchlist`, `ticker_analysis`

**Services:** `sensor_service.py`, `technicals_service.py`

**Refresh All behavior:**
- Calls `get_all_valid_tickers(db)` — union of `holdings.yfinance_ticker` + `watchlist`
- Each ticker: `fetch_technicals()` → Claude Haiku → upsert `ticker_analysis` + `price_cache`
- Failed tickers logged, don't abort run
- Expected runtime: 10–20 min for full portfolio (139 tickers)
- Frontend calls `http://localhost:8000` directly (bypasses Next.js 30s proxy limit) with 20-min timeout

**Sensor upserts `price_cache`** after each analyze — writes only `ticker/name/price/updated_at`. Never overwrites `day_change_pct`, `prev_close`, `sector`, `asset_type`, `currency` (owned by `price_service.py`).

---

## Cash Flow — /cashflow (v0.9.0)

**Page:** `/cashflow` — 5 tabs: Spending, Income, Savings Rate, Recurring, Monthly Review

**Month picker** shared across all tabs.

### Spending Tab
- CSV import: Chase, Amex, BofA via `cashflow_import.py`
- Account picker (credit_card + checking accounts only)
- Claude auto-categorize — one API call per upload, non-fatal if fails
- Manual add/edit/delete transactions
- Category breakdown panel (pie + horizontal bar, Recharts)
- Click category → filter transaction list (chip in summary bar)
- Monthly trends panel — grouped bar chart per account, full year
- Import History panel — filename, account, bank, count, date; filter/delete by batch

### Income Tab
- Manual line-item entry (salary, bonus, freelance, dividend, rental, other)
- Per-owner tracking
- `income_transactions` table (island — zero FK to existing tables)

### Savings Rate Tab
- Full year bar chart — savings rate % with 20% target line
- Toggle: % view vs income/spending amounts view
- Monthly breakdown table, current month highlighted

### Recurring Tab
- Auto-detects transactions appearing in 2+ months (candidates)
- Mark/unmark confirmed recurring; YTD total, months seen
- API: `GET /api/v1/cashflow/recurring`, `POST /api/v1/cashflow/recurring/mark`

### Monthly Review Tab
- On-demand Claude synthesis (click Generate)
- Pulls from: `transactions`, `income_transactions`, `net_worth_snapshots`, `ticker_analysis`
- Saved to `reviews` table (upsert by month)
- Rendered as markdown with sections: Summary, Cash Flow, Net Worth, Portfolio, Action Items

**API (cashflow.py — 15+ routes):** transactions CRUD, income CRUD, summary, imports, trends, recurring, forecast, projection, projections/inputs, settings, review/generate

**DB tables touched:** `transactions`, `income_transactions`, `import_batches`, `reviews`

---

## Cash Flow Forecast — /forecast (v0.9.x)

12-month projection based on avg income + avg spending from imported months.

- Area chart: liquid balance (solid = actual, dashed = projected)
- Override controls for income/spending assumptions
- Data quality warning when < 3 complete months available
- Monthly table with actual/projected/partial badges
- API: `GET /api/v1/cashflow/forecast`

---

## Projections — /projections (v0.9.x)

10-year net worth projection with 3 scenarios (Conservative, Base, Optimistic).

- Configurable return rates: cash, investments, retirement per scenario
- 10-year NW chart (3 lines, Recharts)
- Asset breakdown at year 10 per scenario
- FIRE number: 25× annual spending (overridable)
- Milestone dates: $500k, $750k, $1M, $1.5M, $2M per scenario
- Return rate assumptions stored in `user_settings` (key: projection scenarios)
- API: `GET/PUT /api/v1/cashflow/settings/{key}`, `GET /api/v1/cashflow/projections/inputs`

**Net Worth Projection Widget** also appears on main Dashboard — area chart with historical NW + 12-month projected, next milestone card.
- API: `GET /api/v1/cashflow/projection` — uses `balance_snapshots` directly (not `net_worth_snapshots`)

---

## Mortgage Tracker — /mortgage (v0.9.5)

Pure audit trail — zero coupling to networth/cashflow/projections.

**Pages:** `/mortgage` (property list), `/mortgage/[id]` (5 tabs: Overview, Loans, Amortization, Payoff Calculator, Payments)

**What it tracks:** original purchase + each refinance + monthly payments

**DB tables:** `mortgages`, `mortgage_loans`, `mortgage_payments`

**mortgage_loans fields:** `loan_type` (fixed/arm), `original_balance`, `rate`, `term_months`, `start_date`, `end_date`, `monthly_escrow`, `monthly_extra_principal`, `closing_costs`, `down_payment`, ARM fields (`initial_period`, `cap`, `lifetime_cap`)

**On refinance:** previous active loan auto-closed (`is_active=0`, `end_date` set)

**Amortization math:** standard formula + optional extra payments. One-time extras from `mortgage_payments`. ARM: fixed initial period, rate steps by `arm_cap` (capped at `lifetime_cap`).

**API (mortgage.py — 10 routes):**
- `GET/POST /api/v1/mortgage/` — list/create
- `GET/DELETE /api/v1/mortgage/{id}` — get with loans / delete cascade
- `PUT /api/v1/mortgage/{id}` — update market value + fields
- `GET /api/v1/mortgage/equity` — equity per property (must be before `/{id}` in router)
- `POST /api/v1/mortgage/loan/add`, `PUT/DELETE /api/v1/mortgage/loan/{id}`
- `GET /api/v1/mortgage/loan/{id}/amortization`, `GET /api/v1/mortgage/loan/{id}/payments`
- `POST /api/v1/mortgage/payment/add`, `DELETE /api/v1/mortgage/payment/{id}`

---

## Home Equity in Net Worth (v0.9.6)

- `real_estate` asset category — amber color `#f59e0b`
- Market value entered on `/mortgage` page (Set Value / Update Value button)
- Equity = market value − latest UNFCU mortgage balance snapshot
- Auto-included in net worth summary + category breakdown + dashboard Assets + `/networth` pie
- `mortgages` table: added `estimated_market_value` + `market_value_date` columns

---

## Tax Efficiency — /holdings/tax-efficiency (v0.9.7)

Standalone page. Zero coupling to existing systems.

**What it does:** Analyzes asset location across tax-advantaged vs taxable accounts. Scores placement of high/medium/low tax-efficiency assets.

**Classification:**
- High tax: bonds, target date funds (20XX pattern), YieldMax/covered call ETFs, dividend ETFs
- Medium: international funds (foreign tax credit benefit in taxable), mutual funds
- Low: broad index ETFs, stocks
- Best locations: high-tax → `traditional_401k`/`roth`/`hsa`, international → `taxable`, low → anywhere

**Score:** 100 minus weighted deductions for misplaced assets. Grade: A≥90, B≥75, C≥60, D<60

**Account type mapping** saved to `user_settings` (key: `holdings_account_types`), editable inline.

**API:** `GET /api/v1/holdings/tax-efficiency`, `POST /api/v1/holdings/tax-efficiency/mapping`

---

## Holdings Review — /holdings/review (v0.9.8)

Standalone page. 1-year performance vs S&P 500 + 200 EMA trend per position.

**Status flags:** Outperform (>SPY+5%), In-line (±5%), Underperform (<SPY-5%), Watch (below 200 EMA), N/A (non-tickered)

**Proxy mapping for N/A funds:** auto-assigned from fund name keywords ("large cap"→SPY, "small/mid"→VXF, "international"→VXUS, "bond"→AGG). Manual override stored in `user_settings` (key: `fund_proxy_mapping`).

**Summary cards:** Portfolio 1Y weighted avg, S&P 500 1Y, per-status count + avg + value

**Results cached** in `holdings_review_cache` table. Refresh button triggers fresh yfinance fetch (~30–60s).

**Service:** `holdings_review.py`

**API:** `GET /api/v1/holdings/review?refresh=bool`, `GET/POST /api/v1/holdings/review/proxy-mapping`

---

## Folder-Based Import — /import (v1.0.0)

Replaces browser upload UI. Drop CSVs/PDFs into `data/spending/` or `data/holdings/` subfolders, hit Scan, import.

**Zero change to isolation boundaries** — router is delivery mechanism only.

**Dedup:** SHA256 of file bytes in `import_batches.file_hash`. Same file = "imported" on rescan.

**Auto-categorize:** `_auto_categorize()` calls Claude API (claude-opus-4-5) in one batch per spending file. Non-fatal if API fails.

**Files:**
- `backend/app/services/folder_scanner.py` — `scan_all(db)`
- `backend/app/api/v1/import_router.py` — `GET /scan`, `POST /run`, `GET /batches`, `POST /batches/{id}/rerun`
- `frontend/app/import/page.tsx` — scan + select + import UI

**DB changes:** `import_batches` gained `file_hash TEXT` + `folder_path TEXT` columns.

---

## Holdings Value Consistency (v1.0.2)

All holdings endpoints now use the same value priority:
1. Live price from `price_cache` × shares
2. `current_value` from `holdings` table (import-time value)
3. `total_cost_basis` (last resort)

Endpoints fixed: `/holdings/tax-efficiency`, `/holdings/review`.

---

## Robinhood Cost Basis — /holdings/cost-basis/patch (v1.0.3)

Robinhood PDFs don't include cost basis. This endpoint patches existing holdings.

**API:** `POST /api/v1/holdings/cost-basis/patch` — accepts `account_id` + CSV (`Symbol, Shares, Average Cost`). Updates `cost_basis_per_share` + `total_cost_basis` on existing rows. Never inserts or deletes.

**CSV location:** `data/holdings/robinhood_individual_investment/robinhood_cost_basis.csv`

**Positions with unavailable cost basis (transferred in):** AAPL, GOOG, GOOGL, BAC — show null cost_basis, no gain/loss displayed.

**Robinhood IRA cost basis** — not yet patched (same process, pending).
