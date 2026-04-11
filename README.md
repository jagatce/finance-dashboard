# FinanceOS

A local-first personal finance dashboard. Track net worth, investments,
retirement accounts, insurance, and spending — all stored privately on
your own machine.

## Features
- Net worth tracking over time with charts
- Household support (self, spouse, children)
- All account types: cash, taxable, retirement, HSA, alternatives
- Liabilities: credit cards, loans
- Insurance tracker (coming soon)
- Spending breakdown (coming soon)
- No cloud, no subscriptions, no ads

## Quick Start

### Prerequisites
- macOS or Linux
- Python 3.12+
- Node.js 18+
- SQLCipher
- uv

### Install everything at once

    git clone https://github.com/YOUR_USERNAME/finance-dashboard.git
    cd finance-dashboard
    bash setup.sh

### Run the app

**Terminal 1 — Backend:**

    cd backend
    uv run uvicorn main:app --reload --port 8000

**Terminal 2 — Frontend:**

    cd frontend
    npm run dev

Open **http://localhost:3000**

## Moving to a New Machine
1. Clone the repo on the new machine
2. Run `bash setup.sh`
3. Copy your `backend/finance.db` file manually — this is your data
4. Run the app

## Privacy & Security
- All data lives in `backend/finance.db` on your machine
- The database file is excluded from git
- Nothing is ever sent to any server
- Optional encryption: set `DB_PASSPHRASE` in `backend/.env`

## Project Structure

    finance-dashboard/
    ├── backend/          # Python / FastAPI
    │   ├── app/
    │   │   ├── api/v1/   # API endpoints
    │   │   ├── models/   # Database models
    │   │   └── core/     # Config, DB connection
    │   ├── main.py
    │   └── .env.example
    ├── frontend/         # Next.js / React
    │   ├── app/          # Pages
    │   └── components/   # Shared components
    ├── setup.sh          # One-command setup
    ├── CLAUDE.md         # AI context file
    └── README.md

## Tech Stack
- **Backend:** Python 3.12, FastAPI, SQLAlchemy, SQLite
- **Frontend:** Next.js 16, TypeScript, Tailwind CSS, Recharts
- **Database:** SQLite (SQLCipher for encryption)

## Development

    # Create a feature branch
    git checkout dev
    git checkout -b feature/my-feature

    # After building and testing
    git checkout dev
    git merge feature/my-feature
    git checkout main
    git merge dev
    git tag v0.x.0
