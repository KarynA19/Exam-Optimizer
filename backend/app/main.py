import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.api.routes.auth import router as auth_router
from app.api.routes.projects import router as projects_router
from app.api.routes.saved_setups import router as saved_setups_router


# Load local backend/.env for development; explicit env vars still take precedence.
load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")


def create_app() -> FastAPI:
    app = FastAPI(title="Exam Optimizer API", version="0.1.0")
    allowed_origins = [
        origin.strip()
        for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
        if origin.strip()
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_router, prefix="/api")
    app.include_router(projects_router, prefix="/api")
    app.include_router(saved_setups_router, prefix="/api")
    return app


app = create_app()
