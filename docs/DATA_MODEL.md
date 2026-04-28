# FinanceOS — Data Model Reference

---

## Isolation Boundaries (Critical — Never Cross These)

### BALANCES / NET WORTH island
- **Source of truth:** `balance_snapshots` table
- **Written by:** manual entry on `/balances` page only
- **Powers:** Dashboard, `/networth`, `/accounts`, `/accounts/category/*`
- **Never reads from:** `holdings`, `transactions`, `income_transactions`

### HOLDINGS island
- **Tables:** `holdings`, `price_cache`, `holdings_analysis`, `holdings_review_cache`
- **Written by:** `/import` page (CSV/PDF) + price refresh + analysis
- **Powers:** `/holdings`, `/holdings/analysis`, `/holdings/review`, `/holdings/tax-efficiency`
- **Never touches:** `balance_snapshots`, `net_worth_snapshots`, `accounts` balances, `transactions`
- **`holdings.account_id`** is a plain `String` — NO ForeignKey, NO ORM relationship

### CASH FLOW island
- **Tables:** `transactions`, `income_transactions`, `reviews`, `import_batches`
- **Written by:** `/import` page (CSV) + manual entry on `/cashflow`
- **Powers:** `/cashflow`, `/forecast`, `/projections`
- **Never touches:** `holdings`, `price_cache`, `balance_snapshots`, dashboard NW number

### SENSOR island
- **Tables:** `watchlist`, `ticker_analysis`
- **Written by:** `/sensor` page (analyze + refresh)
- **Note:** sensor upserts `price_cache` (ticker/name/price/updated_at only) — never overwrites fields owned by `price_service.py`

### MORTGAGE island
- **Tables:** `mortgages`, `mortgage_loans`, `mortgage_payments`
- **Written by:** `/mortgage` page
- **Equity** feeds into net worth summary via `GET /api/v1/mortgage/equity` — read-only join, no writes to balance tables

### SETTINGS
- **Table:** `user_settings` — key-value store
- **Current keys:** `holdings_account_types` (tax efficiency mapping), `fund_proxy_mapping` (review proxies), projection scenario rates

---

## All Tables

### Existing — DO NOT TOUCH
| Table | Purpose |
|-------|---------|
| `owners` | Household members (self, spouse, child, joint) |
| `accounts` | Financial accounts with category + owner |
| `balance_snapshots` | Append-only balance history per account |
| `net_worth_snapshots` | Unused — never written to (projection uses balance_snapshots directly) |
| `transactions` | Spending transactions (Chase, Amex, BofA import + manual) |
| `spend_categories` | Category list — currently empty, hardcoded defaults used |
| `retirement_fund_holdings` | Legacy — not used by new holdings system |
| `insurance_policies` | Unused (page not built) |
| `hsa_snapshots` | Unused |
| `income_entries` | Unused — BofA income goes to `income_transactions`, not here |
| `reviews` | Monthly review cards (upsert by month) |

### Holdings island
| Table | Purpose |
|-------|---------|
| `holdings` | Individual positions (ticker, shares, cost_basis, current_value, account_id string) |
| `price_cache` | Live prices from yfinance (TTL 24h) |
| `holdings_analysis` | Claude portfolio analysis blob |
| `holdings_review_cache` | 1Y performance review cache (id='latest') |

### Cash Flow island
| Table | Purpose |
|-------|---------|
| `income_transactions` | Income rows from BofA + manual entry |
| `import_batches` | One row per imported file (file_hash, folder_path, batch metadata) |

### Sensor island
| Table | Purpose |
|-------|---------|
| `watchlist` | Manual research tickers |
| `ticker_analysis` | Claude technicals+fundamentals analysis per ticker |

### Mortgage island
| Table | Purpose |
|-------|---------|
| `mortgages` | Property record (name, address, purchase price/date, market value) |
| `mortgage_loans` | One row per loan event (purchase/refi/payoff) |
| `mortgage_payments` | Actual payment log |

### Settings
| Table | Purpose |
|-------|---------|
| `user_settings` | Key-value store for app preferences |

### Backup tables (safe to drop)
`_bak_transactions`, `_bak_income_entries`, `_bak_import_batches`, `_bak_holdings`, `_bak_income_transactions`

---

## Key Schema Details

### accounts
- `id` — VARCHAR (UUID format)
- `category` — cash | taxable | retirement | hsa | alternative | manual | real_estate | credit_card | loan
- `owner` — self | spouse | child | joint

### balance_snapshots
- Append-only — same account + same date = upsert (no duplicates)
- Net worth = latest snapshot per account, assets minus liabilities

### import_batches
- `id` — UUID (string)
- `file_hash` — SHA256 of file bytes (dedup key)
- `folder_path` — absolute path to subfolder on disk

### holdings
- `account_id` — plain string (normalized account name), NO FK constraint
- `yfinance_ticker` — may be None (fund_nontickered), CUSIP (fund_cusip), or valid ticker
- `asset_type` — fund_nontickered | fund_cusip | stock | etf | mutual_fund | crypto | etc.

### Holdings value priority (all endpoints consistent)
1. `price_cache.price × holdings.shares` (live, most accurate)
2. `holdings.current_value` (import-time value)
3. `holdings.total_cost_basis` (last resort)

### income_transactions
- Separate from `income_entries` (which is unused)
- BofA income split rows + manual entry on Cash Flow > Income tab
- Fields: `id, owner_id, date, source_name, income_type, amount, notes, created_at`

### mortgage_loans
- `is_active` — 0 or 1; only one loan active per property at a time
- On refinance: previous active loan auto-closed (`is_active=0`, `end_date` set)
- ARM fields: `initial_period`, `cap` (per-adjustment), `lifetime_cap`

---

## Data Backup / Restore

Pre-folder-import migration backup (still in DB, safe to drop when confident):

### Restore (if needed)
```sql
INSERT INTO transactions   SELECT * FROM _bak_transactions;
INSERT INTO income_entries SELECT * FROM _bak_income_entries;
INSERT INTO import_batches SELECT * FROM _bak_import_batches;
INSERT INTO holdings       SELECT * FROM _bak_holdings;
INSERT INTO income_transactions SELECT * FROM _bak_income_transactions;
```

### Drop backups (once verified stable)
```sql
DROP TABLE _bak_transactions;
DROP TABLE _bak_income_entries;
DROP TABLE _bak_import_batches;
DROP TABLE _bak_holdings;
DROP TABLE _bak_income_transactions;
```

Run against: `sqlite3 ~/finance-dashboard/backend/finance.db`

---

## Schema Inspection

```bash
sqlite3 ~/finance-dashboard/backend/finance.db \
  "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name;"
```
Always run this before designing new schema — check existing tables first.
