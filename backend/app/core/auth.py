from fastapi import Header, HTTPException
from app.api.v1.auth import is_valid_token

async def require_auth(x_auth_token: str = Header(default="")):
    if not is_valid_token(x_auth_token):
        raise HTTPException(status_code=401, detail="Unauthorized")
