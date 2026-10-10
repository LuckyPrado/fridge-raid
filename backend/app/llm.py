"""Thin wrapper around the Gemini SDK. The one place to swap model provider."""

from __future__ import annotations

import asyncio
import logging
from typing import Protocol, TypeVar

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

REQUEST_TIMEOUT_SECONDS = 45
DEFAULT_TEMPERATURE = 0.8


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


class GeminiLLM:
    def __init__(self, api_key: str, model: str) -> None:
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self._model = model

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
        try:
            response = await asyncio.wait_for(
                self._client.aio.models.generate_content(model=self._model, contents=parts, config=config),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            raise LLMError("Gemini request timed out.") from exc
        except Exception as exc:  # SDK raises several unrelated error types
            logger.exception("Gemini request failed")
            raise LLMError("Gemini request failed.") from exc
        return parse_structured(response.text, schema)
