from __future__ import annotations

import os
from uuid import uuid4

from fastapi import Header, HTTPException


_SINGLE_USER_ID = os.getenv("SINGLE_USER_ID", "orad")
_SINGLE_USER_PASSWORD = os.getenv("SINGLE_USER_PASSWORD", "braude2026")
_TOKENS: dict[str, str] = {}


def login_user(user_id: str, password: str) -> str:
    if user_id != _SINGLE_USER_ID or password != _SINGLE_USER_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    token = uuid4().hex
    _TOKENS[token] = user_id
    return token


def require_authenticated_user(authorization: str | None = Header(default=None)) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization token.")

    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        raise HTTPException(status_code=401, detail="Invalid authorization header.")

    user_id = _TOKENS.get(value)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    return user_id
