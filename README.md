# FinanceOS

> A local-first personal finance dashboard powered by Claude AI. Track net worth, investments, retirement accounts, cash flow, futures trading, and mortgage — all stored privately on your own machine.

**[▶ Live Demo](https://jagatce.github.io/finance-dashboard/)** · [GitHub](https://github.com/jagatce/finance-dashboard)

---

## What it does

| Feature | Description |
|---|---|
| **Net Worth** | Track balances across all accounts over time — charts, per-owner breakdown, projection |
| **Holdings** | Import broker CSVs/PDFs — Betterment, Fidelity, M1, Empower, Robinhood, and more |
| **AI Portfolio Analysis** | Claude analyzes your full portfolio — concentration flags, allocation, action items |
| **Claude Sensor** | Per-ticker technicals (RSI, MACD, EMA200, Bollinger Bands) + buy/sell/watch signal |
| **Cash Flow** | Income, spending, savings rate. Upload bank/credit card CSVs. Monthly AI review |
| **Futures Trading** | Import Robinhood Derivatives monthly PDFs — P&L analytics, top trades, psychology coaching |
| **Mortgage** | Multi-property tracker — loans, amortization, payoff calculator, payment history |
| **Projections** | 10-year net worth projection across 3 scenarios. 12-month cash flow forecast |
| **Backup & Restore** | One-click SQLite backup. Restore from any previous snapshot |

---

## Privacy first

- All data lives in `backend/finance.db` on your machine
- Nothing is sent to any server except Anthropic API calls for AI features
- No cloud sync, no accounts, no subscriptions, no ads
- Optional passphrase login

---

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- [uv](https://github.com/astral-sh/uv)

### Backend

```bash
cd backend
uv sync
cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY for AI features
.venv/bin/uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**

---

## Environment Variables

`backend/.env`:

```
LOGIN_PASSPHRASE=your-passphrase   # gates /login. Empty = auto-login (dev)
DB_PASSPHRASE=                     # DB encryption (not yet implemented)
ANTHROPIC_API_KEY=sk-ant-...       # required for AI features
```

Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com)

---

## Supported Imports

### Holdings
| Broker | Format | Cost Basis | Notes |
|---|---|---|---|
| Betterment | CSV | Yes | Lot-level, auto-aggregated by ticker |
| Fidelity | CSV | Yes | All variants including 401k nontickered funds |
| M1 Finance | CSV | Yes | |
| Empower | PDF | No | Price and market value extracted from PDF |
| Robinhood Individual | PDF + CSV | Yes | Monthly statement + cost basis patch |
| Robinhood IRA | PDF | No | Cost basis patch available via curl |
| Vanguard | CSV | No | Taxable and Roth IRA |

### Spending credit cards
| Source | Format |
|---|---|
| Chase  | CSV |
| American Express  | CSV |
| Checking accounts | CSV |

### Futures
| Broker | Format | Notes |
|---|---|---|
| Robinhood Derivatives | PDF | Monthly statement — MNQ, SIL, MCL, MGC, MBT |

---

## Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy, SQLite
- **Frontend:** Next.js 16, TypeScript, Tailwind CSS, Recharts
- **AI:** Anthropic Claude — portfolio analysis, sensor signals, cash flow review
- **Prices:** yfinance with 24h cache
- **Package managers:** uv (Python), npm (Node)

---

## Project Structure

```
finance-dashboard/
├── backend/
│   ├── app/
│   │   ├── api/v1/          — REST endpoints (accounts, cashflow, futures, holdings, mortgage, sensor...)
│   │   ├── models/          — SQLAlchemy models
│   │   ├── services/        — holdings, prices, sensor, analysis, futures parser
│   │   └── core/            — config, database, auth
│   └── main.py
├── frontend/
│   ├── app/                 — Next.js pages
│   └── components/          — Sidebar, AuthGuard, LayoutShell
├── docs/
│   └── index.html           — Interactive demo (GitHub Pages)
├── migrations/              — DB migration scripts
└── CLAUDE.md                — AI context file for resuming development sessions
```

---

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard — net worth projection widget |
| `/networth` | NW history chart + allocation pie |
| `/balances` | Bulk balance entry |
| `/holdings` | Holdings table + price refresh |
| `/holdings/analysis` | Claude AI portfolio analysis |
| `/holdings/review` | 1Y performance vs S&P 500 |
| `/holdings/tax-efficiency` | Asset location score |
| `/sensor` | Claude Sensor — portfolio + research tabs |
| `/cashflow` | 5 tabs: Spending, Income, Savings Rate, Recurring, Monthly Review |
| `/futures` | 5 tabs: Summary, Daily, Top Trades, Psychology, Import |
| `/forecast` | 12-month cash flow projection |
| `/projections` | 10-year NW projection (3 scenarios) |
| `/mortgage` | Property list + 5 tabs per property |
| `/import` | Folder scan + CSV/PDF import |
| `/backup` | Download and restore finance.db |
| `/settings` | Household members + account management |

---

## Version History

| Tag | Description |
|---|---|
| `v1.1.0-futures` | Futures trading dashboard — PDF import, P&L analytics, psychology coaching |
| `v1.0.5-sensor-timestamps` | NaN/CUSIP fixes, refresh timestamps across all pages |
| `v1.0.4-sensor-fix` | Sensor Refresh All, route ordering, CUSIP guard |
| `v1.0.3-cost-basis` | Robinhood cost basis patch endpoint |
| `v1.0.2-holdings-live` | Live price_cache across all holdings endpoints |
| `v1.0.1-parsers` | All PDF parsers complete |
| `v1.0.0-folder-import` | Folder import, /import page, auto-categorize |
| `v0.9.9-holdings-review` | Holdings review + tax efficiency |

---

## Development workflow

```bash
git checkout main
git pull origin main
# make changes
git add -A
git commit -m "feat: description"
git tag vX.Y.Z-feature-name
git push origin main --tags
```

## Moving to a new machine

1. Clone the repo
2. Run backend and frontend setup above
3. Copy `backend/finance.db` from your old machine — this is all your data
4. Set up `backend/.env` with your passphrase and API key
