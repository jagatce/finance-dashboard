# FinanceOS

> A local-first personal finance dashboard powered by Claude AI. Track net worth, investments, retirement accounts, insurance, and spending — all stored privately on your own machine.

**[▶ Live Demo](https://jagatce.github.io/finance-dashboard/)** · [GitHub](https://github.com/jagatce/finance-dashboard)

---

## What it does

| Feature | Description |
|---------|-------------|
| **Net Worth** | Track balances across all accounts over time with charts and per-owner breakdown |
| **Holdings** | Import broker CSVs/PDFs — Betterment, Fidelity, M1, Empower, Robinhood |
| **AI Portfolio Analysis** | Claude analyzes your full portfolio — concentration flags, allocation, action items |
| **Claude Sensor** | Per-ticker technicals (RSI, MACD, EMA200, Bollinger Bands) + buy/sell/watch signal |
| **Cash Flow** | Income, spending, savings rate. Upload bank/credit card CSVs. Monthly AI review |
| **Insurance** | Track all policies — life, health, auto. Coverage summary and renewal alerts |
| **Backup & Restore** | One-click SQLite backup. Restore from any previous snapshot |

---

## Privacy first

- All data lives in `backend/finance.db` on your machine
- Nothing is sent to any server except Anthropic API calls for AI features
- No cloud sync, no accounts, no subscriptions, no ads
- Optional passphrase login and DB encryption

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
uv pip install "curl-cffi==0.7.4"
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
LOGIN_PASSPHRASE=your-passphrase
DB_PASSPHRASE=
ANTHROPIC_API_KEY=sk-ant-...

Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com)

---

## Supported Broker Imports

| Broker | Format | Cost Basis | Notes |
|--------|--------|------------|-------|
| Betterment | CSV | Yes | Lot-level, auto-aggregated by ticker |
| Fidelity | CSV | Yes | All variants including 401k nontickered funds |
| M1 Finance | CSV | Yes | |
| Empower | PDF | No | Price and market value extracted from PDF |
| Robinhood | PDF | No | Monthly statement, multi-account aware |

---

## Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy, SQLite
- **Frontend:** Next.js 16, TypeScript, Tailwind CSS, Recharts
- **AI:** Anthropic Claude Haiku — portfolio analysis and per-ticker signals
- **Prices:** yfinance with 24h cache

---

## Project Structure
finance-dashboard/
├── backend/
│   ├── app/
│   │   ├── api/v1/        — REST endpoints
│   │   ├── models/        — SQLAlchemy models
│   │   ├── services/      — holdings, prices, sensor, analysis
│   │   └── core/          — config, database, auth
│   └── main.py
├── frontend/
│   ├── app/               — Next.js pages
│   └── components/        — Sidebar, AuthGuard, LayoutShell
├── docs/
│   └── index.html         — Interactive demo (GitHub Pages)
└── CLAUDE.md              — AI context file for resuming development

---

## Roadmap

- [x] Net worth tracking with history and charts
- [x] Holdings import — 5 brokers
- [x] AI portfolio analysis
- [x] Claude Sensor — per-ticker technicals and signals
- [ ] Cash Flow — income, spending, savings rate
- [ ] Monthly AI review
- [ ] Insurance tracker
- [ ] Retirement projections
- [ ] DB encryption with SQLCipher

Current version: **v0.8.0**

---

## Development

```bash
git checkout main
git pull origin main
git checkout -b feature/my-feature
# build and test
git checkout main
git merge feature/my-feature
git tag v0.x.0
git push origin main --tags
```

## Moving to a New Machine

1. Clone the repo
2. Run backend and frontend setup above
3. Copy `backend/finance.db` from your old machine — this is all your data
4. Set up `backend/.env` with your passphrase and API key
