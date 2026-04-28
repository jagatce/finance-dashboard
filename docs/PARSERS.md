# FinanceOS — Parser Reference

## Entry Points

- `holdings_import.py` — `parse_holdings(filename: str, file_bytes: bytes) -> list[dict]`
- `cashflow_import.py` — `parse_csv(filename: str, file_bytes: bytes, bank: str) -> dict`
- `folder_scanner.py` — `scan_all(db) -> dict` — finds files in `data/` and matches to accounts

---

## Spending Parsers (cashflow_import.py)

### Chase
- Format: CSV, standard
- Columns: Date, Description, Amount (negative = expense)
- No header skip needed

### Amex
- Format: CSV, standard
- Columns: Date, Description, Amount (positive = expense)

### BofA
- Format: CSV, 5-line header skip
- Splits into spending → `transactions` and income → `income_transactions`
- Income signals: PAYROLL, DIRECT DEP, DEPOSIT, SRECTRADE, TRANSFER FROM, ZELLE
- Skip signals: AMERICAN EXPRESS, CHASE CREDIT CRD (CC payments — double-count prevention)
- Owner auto-detected from `INDN:` field: PAREKH → JP, KANSARA → RK
- Income rows go to `income_transactions` via raw SQL (NOT `transactions`, NOT `income_entries`)

### income_transactions insert shape (must match exactly)
```python
(id, owner_id, date, source_name, income_type, amount, notes, created_at)
owner_id = inc.get("owner_id") or inc.get("owner_hint") or "unknown"
date     = inc.get("transaction_date", "")   # string YYYY-MM-DD
notes    = inc.get("full_description")
```

### valid_cols for Transaction insert
Strip unknown keys (full_description, owner_hint) before `Transaction(**row)`:
```python
VALID_COLS = {
    "id", "account_id", "transaction_date", "posted_date", "description",
    "amount", "category", "subcategory", "merchant", "notes", "created_at",
    "owner_id", "source", "is_recurring", "batch_id"
}
```

---

## Holdings Parsers (holdings_import.py)

### detect_broker() — auto-detection from file headers

| Broker | Format | Notes |
|--------|--------|-------|
| Betterment | CSV | Lot-level — must aggregate by ticker. No `as_of_date` in file |
| Fidelity | CSV | BOM strip required. Footer disclaimer rows stop at first quoted line |
| Fidelity Dell 401k | CSV | No ticker symbols — stored as `fund_nontickered`, `yf_ticker=None` |
| Fidelity SNPS | CSV | BROKERAGELINK row skipped (dup with brok_link file). CUSIPs via `^[A-Z0-9]{9}$` → `fund_cusip` |
| M1 Finance | CSV | BRK.B stored as-is, `yfinance_ticker=BRK-B` |
| Vanguard | CSV | Two-section file (positions + transactions) — only positions section parsed |
| Empower (JP monthly) | PDF | pdfplumber table extraction. `as_of` from "As of Date" header. 26 positions |
| Empower Aegis (RK 401k) | PDF | Quarterly report, 4 funds, handles split fund name lines |
| Apex Clearing (Ally IRA) | PDF | Equities section only, 3 positions. Cash balance not captured |
| BPAS NEPC 403b | PDF | 1 fund (FCNTX). `ticker_map` hardcoded for known funds |
| Robinhood taxable | PDF | NO tables — raw text parsing. 18 positions |
| Robinhood IRA | PDF | Multi-account aware — skips Traditional ($0 balance), parses Roth (7 holdings) |

### PDF Routing in parse_holdings()
```python
if "robinhood" in fname:         → parse_robinhood_pdf
elif "empower" or "aegis" or "401k" in fname: → parse_empower_pdf
elif "bpas" or "nepc" or "403" in fname:      → parse_bpas_pdf
elif "ally" or "apex" or "statement" in fname: → parse_apex_clearing_pdf
else:                            → parse_empower_pdf  # fallback
```

### Parser current_value source
- Betterment: aggregate `MarketValue` column per ticker (lot-level CSV)
- M1: `Value` column
- All others: set correctly at parse time

---

## Price Service (price_service.py)

- `get_prices(tickers, db, asset_types, force_refresh)` — main entry point
- Skips `fund_nontickered` and `fund_cusip` asset types
- TTL = 24 hours, checked against `price_cache.updated_at`
- Batch fetch via `yf.download(threads=False)` then `yf.Ticker().info` per ticker for metadata
  - `threads=False` required — `threads=True` crashes uvicorn on macOS (ECONNRESET)
- `_classify(info)` maps yfinance `quoteType` to our `asset_type` enum
- `_extract_price()` returns `None` (not NaN) for missing data

### is_valid_ticker() — shared between price_service.py and sensor.py
Rejects junk values stored in `yfinance_ticker` column (fund display names, CUSIPs):
- No spaces (filters "S&P 500 Index Fund", "BOND FUND")
- Not 9-char alphanumeric CUSIP (filters `31617E745`)
- Max 6 characters
- Regex: `^[A-Z]{1,5}(-[A-Z]{1,2})?$|^[A-Z]{5}X$`
  - Covers standard tickers, BRK-B style, and 5-letter mutual funds ending in X

---

## Folder Import (folder_scanner.py)

### Folder Naming Convention
Folder name = `_normalize(account.name)`:
```python
name.strip().lower()
# remove apostrophes, dashes, dots
# all non-alphanumeric runs → underscore
# strip leading/trailing underscores
```
Examples:
- `'Fidelity - Individual Investment'` → `'fidelity_individual_investment'`
- `'American Express Blue JP'` → `'american_express_blue_jp'`

Folder names are always derived mechanically from DB account names — never invented.

### Dedup Strategy
File identity = SHA256 of file bytes stored in `import_batches.file_hash`.
Same file dropped again → status "imported" on scan, not re-imported unless `force_reimport=True`.
Filename alone is NOT used for dedup.

---

## Parser Status — v1.0.5 (all 22 files tested)

### Spending (cashflow_import.py)
| File | Bank | Status |
|------|------|--------|
| chase_freedom_jp / chase_amazon_jp / chase_freedom_rk | chase | ✅ |
| american_express_blue_jp / delta_jp / blue_rk / delta_rk | amex | ✅ |
| bank_of_america_checking | bofa | ✅ |

### Holdings (holdings_import.py)
| Account folder | Format | Status |
|----------------|--------|--------|
| betterment_kids_fund | CSV | ✅ |
| fidelity_* (5 accounts) | CSV | ✅ |
| m1_finance | CSV | ✅ |
| vanguard_taxable | CSV | ✅ |
| empower (JP monthly) | PDF | ✅ |
| empower_aegis_401k (RK) | PDF | ✅ |
| ally_roth_ira | PDF | ✅ |
| nepc_bpas_403 | PDF | ✅ |
| robinhood_individual_investment | PDF | ✅ |
| robinhood_backdoor_roth_ira | PDF | ✅ |

### Known Gaps
- `etrade_snps`, `personal_capital_sip` — folders exist, no files provided yet
- `vanguard_roth_ira` — no CSV export available from Vanguard
- Ally IRA: cash balance ($7,305) not captured (equities only)
- Empower Aegis fund names truncated (acceptable)
- BPAS NEPC: `ticker_map` hardcoded — unknown funds use truncated name
