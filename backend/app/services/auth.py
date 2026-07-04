from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException
import jwt
from jwt import ExpiredSignatureError, InvalidTokenError


_SINGLE_USER_ID = os.getenv("SINGLE_USER_ID", "orad")
_SINGLE_USER_PASSWORD = os.getenv("SINGLE_USER_PASSWORD", "braude2026")
_JWT_SECRET = os.getenv("JWT_SECRET", "change-this-secret-in-production")
_JWT_ALGORITHM = "HS256"
_JWT_ISSUER = "exam-optimizer"
_JWT_EXPIRATION_MINUTES = int(os.getenv("JWT_EXPIRATION_MINUTES", "10080"))


def _issue_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iss": _JWT_ISSUER,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=_JWT_EXPIRATION_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALGORITHM)


def login_user(user_id: str, password: str) -> str:
    if user_id != _SINGLE_USER_ID or password != _SINGLE_USER_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    return _issue_token(user_id)


def require_authenticated_user(authorization: str | None = Header(default=None)) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization token.")

    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        raise HTTPException(status_code=401, detail="Invalid authorization header.")

    try:
        payload = jwt.decode(
            value,
            _JWT_SECRET,
            algorithms=[_JWT_ALGORITHM],
            issuer=_JWT_ISSUER,
        )
    except ExpiredSignatureError as error:
        raise HTTPException(status_code=401, detail="Invalid or expired token.") from error
    except InvalidTokenError as error:
        raise HTTPException(status_code=401, detail="Invalid or expired token.") from error

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    return user_id
