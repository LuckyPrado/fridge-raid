from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from app.llm import GeminiLLM, LLMError, is_transient
from app.schemas import Quip

pytestmark = pytest.mark.unit


class _ApiError(Exception):
    def __init__(self, code: int) -> None:
        super().__init__(f"status {code}")
        self.code = code


class _FakeClient:
    """Stands in for the Gemini SDK client. Each model name maps to a reply or an error to raise."""

    def __init__(self, outcomes: dict[str, Any]) -> None:
        self.calls: list[str] = []
        self._outcomes = outcomes
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self._generate))

    async def _generate(self, *, model: str, contents: Any, config: Any) -> Any:
        self.calls.append(model)
        outcome = self._outcomes[model]
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(text=outcome)


def _llm(client: _FakeClient, *fallbacks: str) -> GeminiLLM:
    return GeminiLLM("unused", "main", fallbacks, client=client)


async def _ask(llm: GeminiLLM) -> Quip:
    return await llm.generate(system="s", prompt="p", schema=Quip)


@pytest.mark.parametrize(
    ("error", "expected"),
    [(_ApiError(503), True), (_ApiError(429), True), (asyncio.TimeoutError(), True), (_ApiError(404), False), (ValueError("x"), False)],
)
def test_only_overload_rate_limit_and_timeouts_are_transient(error: Exception, expected: bool) -> None:
    assert is_transient(error) is expected


async def test_uses_the_main_model_when_it_answers() -> None:
    client = _FakeClient({"main": '{"text": "hi"}'})

    quip = await _ask(_llm(client, "backup"))

    assert quip.text == "hi"
    assert client.calls == ["main"]


async def test_falls_through_to_the_next_model_when_the_main_one_is_busy() -> None:
    client = _FakeClient({"main": _ApiError(503), "backup": '{"text": "from backup"}'})

    quip = await _ask(_llm(client, "backup"))

    assert quip.text == "from backup"
    assert client.calls == ["main", "backup"]


async def test_fails_when_every_model_is_busy() -> None:
    client = _FakeClient({"main": _ApiError(503), "backup": _ApiError(429)})

    with pytest.raises(LLMError, match="busy"):
        await _ask(_llm(client, "backup"))


async def test_does_not_retry_a_permanent_error() -> None:
    client = _FakeClient({"main": _ApiError(404), "backup": '{"text": "never"}'})

    with pytest.raises(LLMError):
        await _ask(_llm(client, "backup"))

    assert client.calls == ["main"]


async def test_repeated_model_names_are_tried_once() -> None:
    client = _FakeClient({"main": _ApiError(503)})

    with pytest.raises(LLMError):
        await _ask(_llm(client, "main", "main"))

    assert client.calls == ["main"]
