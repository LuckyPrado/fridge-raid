"""Environment-driven settings. Secrets come from backend/.env, never from code."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"

DEFAULT_MODEL = "gemini-3.8-flash"
# Tried in order when the main model is overloaded or rate limited.
DEFAULT_FALLBACK_MODELS = "gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite"
DEFAULT_CORS_ORIGINS = "http://localhost:5173"
DEFAULT_SQLITE_PATH = BACKEND_DIR / "fridge_raid.sqlite3"
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str | None
    gemini_model: str
    database_url: str | None
    sqlite_path: Path
    cors_origins: tuple[str, ...]
    gemini_fallback_models: tuple[str, ...] = ()

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key)


def _clean(value: str | None) -> str | None:
    stripped = (value or "").strip()
    return stripped or None


def load_settings() -> Settings:
    load_dotenv(BACKEND_DIR / ".env")
    origins = _clean(os.getenv("CORS_ORIGINS")) or DEFAULT_CORS_ORIGINS
    fallbacks = _clean(os.getenv("GEMINI_FALLBACK_MODELS")) or DEFAULT_FALLBACK_MODELS
    settings = Settings(
        gemini_api_key=_clean(os.getenv("GEMINI_API_KEY")),
        gemini_model=_clean(os.getenv("GEMINI_MODEL")) or DEFAULT_MODEL,
        database_url=_clean(os.getenv("DATABASE_URL")),
        sqlite_path=Path(_clean(os.getenv("SQLITE_PATH")) or DEFAULT_SQLITE_PATH),
        cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        gemini_fallback_models=tuple(m.strip() for m in fallbacks.split(",") if m.strip()),
    )
    if not settings.gemini_enabled:
        logger.warning("GEMINI_API_KEY is not set: running in offline mode with rule-based agents.")
    return settings
