# FinanceOS — Open Items

Last updated: 2026-04-24

## 🔴 High Priority

### Holdings double-count risk
- When reimporting a broker CSV/PDF for the same account, does it append or replace?
- There is a DELETE /holdings/account/{account_id} endpoint — need to verify if import
  auto-deletes before inserting or if user must manually delete first
- Action: check holdings import endpoint logic, document correct reimport procedure
- Risk: if user reimports same account next month without deleting first, qty doubles

### Spend categories table empty
- spend_categories table exists but has no data
- Claude categorization uses hardcoded default list
- Inline category dropdowns show hardcoded list, not DB values
- Action: populate with standard categories (Groceries, Dining, Gas, etc.)
- Action: consider seeding on app startup if table is empty

## 🟡 Medium Priority

### /reviews page not built
- reviews table exists and Monthly Review tab generates + saves reviews
- But standalone /reviews page (Priority 2 from roadmap) not built yet
- Should show all past monthly/quarterly reviews in one place
- Claude synthesis: net worth + cashflow + holdings + sensor signals

### BofA mobile deposit owner assignment
- Mobile deposits (BKOFAMERICA MOBILE DEPOSIT) have no INDN: field
- Saved as owner_id = "unknown" — requires manual reassignment in Income tab
- Workaround exists (amber dropdown in Income tab)
- Action: consider adding a "default owner for unmatched deposits" config setting

### Income tab — missing months
- If BofA not imported for a month, income tab is empty for that month
- No warning or indicator that income data may be incomplete
- Action: add indicator when income is $0 for a month

## 🟢 Low Priority / Nice to Have

### npm run build Recharts type warning
- tickFormatter type error in SavingsRateTab (non-blocking, works in dev)
- Action: fix TypeScript cast during next cleanup pass

### Consolidated retirement performance view
- Balance history per account exists on /accounts/category/retirement
- No single chart showing all retirement accounts combined growth over time
- All data already in balance_snapshots — pure visualization work
- Action: add aggregate chart to /accounts/category/retirement or new /retirement page

### Watched folder for CSV auto-import
- Monthly manual download of 8 CSV files is manageable but could be automated
- Approach: local file watcher (Python watchdog) + auto-import on file drop
- Keeps privacy-first, no third party
- Action: design and build if manual import becomes friction point

### Citi credit card parser
- Citi CSV format not yet implemented in cashflow_import.py
- Format: Date, Description, Debit, Credit
- Action: add when Citi statement available for testing

## ✅ Resolved
- BofA owner_hint mapped to real owner UUIDs (PAREKH→JP, KANSARA→RK)
- Import batch tracking — delete entire file import, not by month
- Holdings and balances correctly isolated (no double counting between systems)
- OFX/Direct Connect evaluated — dead for all major banks by 2024, not viable
