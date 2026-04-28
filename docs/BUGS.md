# FinanceOS — Known Bugs & Workarounds

Patterns that have burned us before. Check here before debugging a mysterious failure.

---

## Backend Won't Start / curl-cffi ImportError

**Symptom:** `ImportError: dlopen(.../_wrapper.abi3.so): symbol not found in flat namespace (_SCDynamicStoreCopyProxies)`

**Cause:** Latest curl-cffi build is broken on macOS with Homebrew Python.

**Fix:**
```bash
cd ~/finance-dashboard/backend
.venv/bin/pip install "curl-cffi==0.7.4"
```

**Permanent pin** — add to `backend/pyproject.toml`:
```toml
[tool.uv.overrides]
curl-cffi = "==0.7.4"
```

Must be re-applied after any `uv sync` or `uv pip install` that upgrades curl-cffi.

---

## Always Start Backend with venv Python Directly

**Wrong:** `uv run uvicorn main:app --reload --port 8000`

**Correct:** `cd ~/finance-dashboard/backend && .venv/bin/uvicorn main:app --reload --port 8000`

`uv run` may resolve to system Python which doesn't have the pinned curl-cffi.

---

## Next.js Proxy Not Configured → 404 on All API Calls

**Symptom:** All `/api/v1/*` calls return 404 from Next.js (not FastAPI).

**Fix:** `frontend/next.config.ts` must contain:
```ts
async rewrites() {
  return [{ source: "/api/:path*", destination: "http://localhost:8000/api/:path*" }]
}
```

---

## ANTHROPIC_API_KEY is None at Runtime

**Symptom:** Holdings analysis, sensor, auto-categorize silently fail.

**Cause:** `.env` not loaded before routers initialize.

**Fix:** `backend/main.py` line 1 must be:
```python
from app.core import config  # noqa: F401
```
`config.py` calls `load_dotenv()`. If this import is missing or reordered, `ANTHROPIC_API_KEY` is `None`.

---

## Long-Running Calls Killed by Next.js 30s Proxy Timeout

**Affected:** Sensor Refresh All (~10–20 min), Holdings Refresh Prices (~5–10 min).

**Fix:** Call FastAPI directly, bypassing Next.js proxy:
```ts
const token = sessionStorage.getItem("fineos_token");
const res = await fetch("http://localhost:8000/api/v1/...", {
  headers: { "x-auth-token": token },
  signal: AbortSignal.timeout(N * 60 * 1000),
});
```

---

## FastAPI Route Shadowing (Specific Order Required)

**Symptom:** `POST /sensor/refresh/all` matched by `POST /sensor/{ticker}/refresh` with `ticker="refresh"`.

**Fix:** Declare `/refresh/all` above `/{ticker}/refresh` in `sensor.py`.

Same pattern for `/mortgage/equity` — must be declared before `/{mortgage_id}`.

**Rule:** In FastAPI, fixed-path routes must come before parameterized routes in the same router.

---

## Anthropic() Client at Module Level

**Symptom:** `ANTHROPIC_API_KEY` is `None` even though `.env` is set.

**Cause:** `Anthropic()` instantiated at module import time, before `load_dotenv()` runs.

**Fix:** Instantiate inside the function that uses it:
```python
def analyze_ticker(ticker):
    client = Anthropic()  # inside function, not at module level
    ...
```

Applied to: `sensor_service.py`.

---

## NaN / Infinity Floats in FastAPI JSON Response

**Symptom:** `500 Internal Server Error` on `/sensor/tickers` or similar endpoints.

**Cause:** `json.dumps` rejects `NaN` and `Infinity`; these can come from yfinance for money market funds (e.g. VMFXX, VMRXX — price always $1.00, RSI calc division by zero).

**Fixes:**
1. `technicals_service.py`: RSI NaN → 50 (neutral default)
2. `sensor.py`: `clean()` helper — returns `None` for any NaN or Infinity float before serialization
3. `price_service.py`: `_extract_price()` returns `None` (not NaN) for missing data

---

## yfinance threads=True Crashes uvicorn on macOS

**Symptom:** `ECONNRESET` errors, uvicorn crashes during price refresh.

**Fix:** `price_service.py` uses `yf.download(threads=False)`.

---

## BofA Import: Mortgage Payment Silently Dropped

**Symptom:** UNFCU mortgage payment (~$8,854/month) disappears from spending data.

**Cause:** `UNFCU DES:CK-WTH` was in `BOFA_SKIP_SIGNALS`.

**Fix:** Only AMERICAN EXPRESS and CHASE CREDIT CRD payments are skipped. Do not add other payment strings to the skip list without careful review.

---

## Folder Import: Date Strings Not Converted Before ORM Insert

**Symptom:** SQLAlchemy type error on commit.

**Cause:** `parse_transactions` returns date columns as strings (`"2026-01-15"`), but SQLAlchemy `Date` columns expect `datetime.date` objects.

**Fix:** Convert with `strptime` before constructing ORM objects:
```python
import datetime as dt  # use alias — avoid collision with `datetime` attribute name
row["transaction_date"] = dt.datetime.strptime(row["transaction_date"], "%Y-%m-%d").date()
```

---

## Folder Import: Unknown Keys Cause Transaction(**row) to Fail

**Symptom:** `TypeError: __init__() got unexpected keyword argument 'full_description'`

**Fix:** Strip unknown keys before ORM construction using `VALID_COLS` allowlist (see `docs/PARSERS.md`).

---

## CUSIP Values Passed to Sensor Endpoints → 500

**Symptom:** `/sensor/{ticker}/refresh` returns 500 for tickers like `31617E745`.

**Cause:** Some Fidelity/Empower funds store CUSIPs in `holdings.yfinance_ticker`.

**Fix:** `is_valid_ticker()` guard on all sensor endpoints (see `docs/PARSERS.md` for rules).
Applied in both `sensor.py` and `price_service.py`.
