"""Small in-memory sliding-window rate limiter, keyed by client address."""

from __future__ import annotations

import time
from collections import deque
from threading import Lock
from typing import Callable

from fastapi import HTTPException, Request, status

WINDOW_SECONDS = 60.0


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: float = WINDOW_SECONDS) -> None:
        self._max = max_requests
        self._window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        moment = time.monotonic() if now is None else now
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and moment - hits[0] >= self._window:
                hits.popleft()
            if len(hits) >= self._max:
                return False
            hits.append(moment)
            return True


def rate_limit(max_requests: int) -> Callable[[Request], None]:
    """Build a FastAPI dependency that rejects clients exceeding max_requests per minute."""
    limiter = RateLimiter(max_requests)

    def dependency(request: Request) -> None:
        client = request.client.host if request.client else "unknown"
        if not limiter.allow(client):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Wait a minute and try again.",
            )

    return dependency
