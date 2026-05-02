"""
Migration: Add futures trading tables
Run from backend/: python ../migrations/001_add_futures_tables.py
"""
import sqlite3
import os

DB_PATH = os.path.expanduser("~/finance-dashboard/backend/finance.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS futures_import_batches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    filename    TEXT NOT NULL,
    account_num TEXT,
    period_start DATE,
    period_end   DATE,
    imported_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    leg_count    INTEGER DEFAULT 0,
    UNIQUE(filename)
);

CREATE TABLE IF NOT EXISTS futures_trades (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id      INTEGER NOT NULL REFERENCES futures_import_batches(id),
    trade_date    DATE NOT NULL,
    symbol        TEXT NOT NULL,          -- MNQ, SIL, MCL, MGC, MBT
    side          TEXT NOT NULL,          -- L (long/buy) or S (short/sell)
    qty           REAL NOT NULL DEFAULT 1,
    price         REAL NOT NULL,
    contract_year INTEGER,
    contract_month INTEGER,
    exchange      TEXT,
    exp_date      DATE,
    currency      TEXT DEFAULT 'USD',
    trade_type    TEXT DEFAULT 'Trade',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS futures_daily_summary (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id      INTEGER NOT NULL REFERENCES futures_import_batches(id),
    trade_date    DATE NOT NULL,
    symbol        TEXT NOT NULL,
    total_long    REAL DEFAULT 0,
    total_short   REAL DEFAULT 0,
    avg_long      REAL,
    avg_short     REAL,
    gross_pnl     REAL DEFAULT 0,
    commission    REAL DEFAULT 0,
    exchange_fees REAL DEFAULT 0,
    nfa_fees      REAL DEFAULT 0,
    total_fees    REAL DEFAULT 0,
    net_pnl       REAL DEFAULT 0,
    UNIQUE(batch_id, trade_date, symbol)
);

CREATE TABLE IF NOT EXISTS futures_monthly_summary (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id        INTEGER NOT NULL REFERENCES futures_import_batches(id),
    symbol          TEXT NOT NULL,
    gross_pnl       REAL DEFAULT 0,
    total_fees      REAL DEFAULT 0,
    net_pnl         REAL DEFAULT 0,
    round_trips     INTEGER DEFAULT 0,
    UNIQUE(batch_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_futures_trades_date   ON futures_trades(trade_date);
CREATE INDEX IF NOT EXISTS idx_futures_trades_symbol ON futures_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_futures_daily_date    ON futures_daily_summary(trade_date);
"""

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    for stmt in SCHEMA.strip().split(";"):
        s = stmt.strip()
        if s:
            cur.execute(s)
    conn.commit()
    conn.close()
    print(f"Migration complete: {DB_PATH}")

if __name__ == "__main__":
    migrate()
