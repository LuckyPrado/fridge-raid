"""Thin wrapper around the Gemini SDK. The one place to swap model provider."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol, Sequence, TypeVar

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

REQUEST_TIMEOUT_SECONDS = 30
DEFAULT_TEMPERATURE = 0.8
TRANSIENT_STATUS_CODES = frozenset({429, 500, 502, 503, 504})


class LLMError(Exception):
    """The model call failed or returned something that does not match the schema."""


class LLM(Protocol):
    async def generate(
        self,
        *,
        system: str,
        prompt: str,
        schema: type[T],
        image: tuple[bytes, str] | None = None,
        temperature: float = DEFAULT_TEMPERATURE,
    ) -> T: ...


def parse_structured(text: str | None, schema: type[T]) -> T:
    """Validate raw model output against the expected schema."""
    if not text or not text.strip():
        raise LLMError("Model returned an empty response.")
    try:
        return schema.model_validate_json(text)
    except ValidationError as exc:
        raise LLMError(f"Model output did not match {schema.__name__}.") from exc


def is_transient(error: Exception) -> bool:
    """True for errors worth retrying on another model: overload, rate limits, and timeouts."""
    if isinstance(error, asyncio.TimeoutError):
        return True
    return getattr(error, "code", None) in TRANSIENT_STATUS_CODES


class GeminiLLM:
    """Calls Gemini with structured output. A busy or rate-limited model falls through to the next one."""

    def __init__(self, api_key: str, model: str, fallback_models: Sequence[str] = (), client: Any = None) -> None:
        if client is None:
            from google import genai

            client = genai.Client(api_key=api_key)
        self._client = client
        self._models = tuple(dict.fromkeys((model, *fallback_models)))

    async def generate(
        self,
        *,
        system: str,
        prompt: str,
        schema: type[T],
        image: tuple[bytes, str] | None = None,
        temperature: float = DEFAULT_TEMPERATURE,
    ) -> T:
        from google.genai import types

        parts = []
        if image is not None:
            data, mime_type = image
            parts.append(types.Part.from_bytes(data=data, mime_type=mime_type))
        parts.append(types.Part.from_text(text=prompt))
        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_schema=schema,
            temperature=temperature,
        )
        for model in self._models:
            try:
                response = await asyncio.wait_for(
                    self._client.aio.models.generate_content(model=model, contents=parts, config=config),
                    timeout=REQUEST_TIMEOUT_SECONDS,
                )
            except Exception as exc:  # SDK raises several unrelated error types
                if is_transient(exc):
                    logger.warning("Gemini model %s is busy (%s); trying the next model.", model, type(exc).__name__)
                    continue
                logger.exception("Gemini request failed on %s", model)
                raise LLMError("Gemini request failed.") from exc
            return parse_structured(response.text, schema)
        raise LLMError("Every Gemini model was busy.")
