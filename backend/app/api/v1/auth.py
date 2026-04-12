from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.config import LOGIN_PASSPHRASE
import secrets

router = APIRouter()
_sessions: set[str] = set()
NO_AUTH = not bool(LOGIN_PASSPHRASE)

class LoginRequest(BaseModel):
    passphrase: str

class LoginResponse(BaseModel):
    token: str
    no_auth: bool = False

@router.get("/status")
def auth_status():
    return {"requires_auth": bool(LOGIN_PASSPHRASE)}

@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest):
    if NO_AUTH:
        return {"token": "no-auth", "no_auth": True}
    if req.passphrase != LOGIN_PASSPHRASE:
        raise HTTPException(status_code=401, detail="Invalid passphrase")
    token = secrets.token_hex(32)
    _sessions.add(token)
    return {"token": token, "no_auth": False}

@router.post("/logout")
def logout(token: str):
    _sessions.discard(token)
    return {"ok": True}

def is_valid_token(token: str) -> bool:
    if NO_AUTH:
        return True
    return token in _sessions
