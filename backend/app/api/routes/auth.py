from __future__ import annotations

from pydantic import BaseModel, Field
from fastapi import APIRouter

from app.services.auth import login_user

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    user_id: str = Field(min_length=1)
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    token: str
    user_id: str


@router.post("/auth/login", response_model=LoginResponse)
def login(request: LoginRequest) -> LoginResponse:
    token = login_user(request.user_id, request.password)
    return LoginResponse(token=token, user_id=request.user_id)
