from app.core import config  # noqa: F401 — loads .env via load_dotenv()
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.core.database import engine, Base
from app.core.auth import require_auth
import app.models.models
from app.api.v1 import owners, accounts, networth, auth, backup, holdings, sensor, cashflow, mortgage, import_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Finance Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public routes — no auth needed
app.include_router(auth.router,   prefix="/api/v1/auth",    tags=["Auth"])

# Protected routes — require auth token
app.include_router(owners.router,   prefix="/api/v1/owners",   tags=["Owners"],    dependencies=[Depends(require_auth)])
app.include_router(accounts.router, prefix="/api/v1/accounts", tags=["Accounts"],  dependencies=[Depends(require_auth)])
app.include_router(networth.router, prefix="/api/v1/networth", tags=["Net Worth"], dependencies=[Depends(require_auth)])
app.include_router(backup.router,   prefix="/api/v1/backup",   tags=["Backup"],    dependencies=[Depends(require_auth)])
app.include_router(holdings.router)
app.include_router(sensor.router)
app.include_router(cashflow.router)
app.include_router(mortgage.router)
app.include_router(import_router.router)

@app.get("/health")
def health():
    return {"status": "ok"}
