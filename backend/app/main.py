"""Application factory. Run with: uvicorn app.main:app --reload"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import router
from app.config import Settings, load_settings
from app.llm import LLM
from app.repository import Repository
from app.services import build_services

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def _failure(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"success": False, "data": None, "error": message})


def create_app(
    settings: Settings | None = None, repository: Repository | None = None, llm: LLM | None = None
) -> FastAPI:
    settings = settings or load_settings()
    app = FastAPI(title="Fridge Raid", version="0.1.0")
    app.state.services = build_services(settings, repository=repository, llm=llm)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return _failure(exc.status_code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
        return _failure(422, f"Invalid request: {where} {first.get('msg', '')}".strip())

    @app.exception_handler(Exception)
    async def unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error", exc_info=exc)
        return _failure(500, "Something went wrong on the server.")

    app.include_router(router)
    return app


app = create_app()
