"""HTTP routes. Thin: validation and wiring only, logic lives in the modules they call."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator, Generic, TypeVar

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from app import tracker
from app.config import MAX_UPLOAD_BYTES
from app.llm import LLMError
from app.negotiation import run_raid
from app.optimizer import at_risk_items, waste_value_total
from app.ratelimit import rate_limit
from app.schemas import InventoryPayload, RaidRequest, RaidStat, WeekPlan
from app.scout import scout_fridge
from app.services import DemoFridge, Services, get_services

logger = logging.getLogger(__name__)

T = TypeVar("T")

ALLOWED_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
MULTIPART_OVERHEAD_BYTES = 64 * 1024
SCOUT_REQUESTS_PER_MINUTE = 6
RAID_REQUESTS_PER_MINUTE = 10
WRITE_REQUESTS_PER_MINUTE = 60


class Envelope(BaseModel, Generic[T]):
    success: bool = True
    data: T | None = None
    error: str | None = None


class StatusInfo(BaseModel):
    mode: str
    model: str | None
    database: str


class ThreatInfo(BaseModel):
    waste_value_total: float
    at_risk: list[str]


router = APIRouter(prefix="/api")


@router.get("/status", response_model=Envelope[StatusInfo])
def get_status(services: Services = Depends(get_services)) -> Envelope[StatusInfo]:
    live = services.live_party is not None
    return Envelope(
        data=StatusInfo(
            mode="gemini" if live else "offline",
            model=services.settings.gemini_model if live else None,
            database=services.repository.name,
        )
    )


@router.get("/demo-fridges", response_model=Envelope[list[DemoFridge]])
def list_demo_fridges(services: Services = Depends(get_services)) -> Envelope[list[DemoFridge]]:
    return Envelope(data=list(services.demo_fridges))


@router.get("/inventory", response_model=Envelope[InventoryPayload])
def get_inventory(services: Services = Depends(get_services)) -> Envelope[InventoryPayload]:
    return Envelope(data=InventoryPayload(items=services.repository.list_items()))


@router.post("/threat", response_model=Envelope[ThreatInfo])
def get_threat(payload: InventoryPayload, services: Services = Depends(get_services)) -> Envelope[ThreatInfo]:
    """Dollar value of food about to expire, and which items it is."""
    risky = at_risk_items(payload.items, services.catalog)
    return Envelope(
        data=ThreatInfo(
            waste_value_total=waste_value_total(risky),
            at_risk=sorted(entry.name for entry in risky.values()),
        )
    )


@router.put(
    "/inventory",
    response_model=Envelope[InventoryPayload],
    dependencies=[Depends(rate_limit(WRITE_REQUESTS_PER_MINUTE))],
)
def put_inventory(
    payload: InventoryPayload, services: Services = Depends(get_services)
) -> Envelope[InventoryPayload]:
    services.repository.replace_items(payload.items)
    return Envelope(data=payload)


def reject_oversized_body(request: Request) -> None:
    """Refuse a too-large upload from its declared size, before the body is read."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Photo is too large. The limit is 8 MB.")


@router.post(
    "/scout",
    response_model=Envelope[InventoryPayload],
    dependencies=[Depends(rate_limit(SCOUT_REQUESTS_PER_MINUTE)), Depends(reject_oversized_body)],
)
async def scout(
    photo: UploadFile = File(...), services: Services = Depends(get_services)
) -> Envelope[InventoryPayload]:
    if services.llm is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The Scout needs a Gemini API key. Pick a demo fridge or add items by hand.",
        )
    if photo.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a JPEG, PNG, or WebP photo.")
    data = await photo.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Photo is too large. The limit is 8 MB.")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The uploaded photo is empty.")
    try:
        items = await scout_fridge(services.llm, data, photo.content_type, services.catalog)
    except LLMError as exc:
        logger.warning("Scout failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "The Scout could not read that photo. Try again or add items by hand."
        ) from exc
    return Envelope(data=InventoryPayload(items=items))


def _remember_plan(event: dict, services: Services) -> None:
    """Save the settled plan so the Chef and Shop tabs survive a reload."""
    try:
        tracker.save_plan(services.repository, WeekPlan.model_validate(event["plan"]))
    except (ValidationError, KeyError):
        logger.exception("The settled plan could not be saved.")


async def _sse(request: RaidRequest, services: Services) -> AsyncIterator[str]:
    party = services.party_for(request.offline)
    try:
        async for event in run_raid(request, party, services.offline_party, services.catalog, services.stores):
            if event["type"] == "plan":
                await asyncio.to_thread(_remember_plan, event, services)
            yield f"data: {json.dumps(event)}\n\n"
    except Exception:
        logger.exception("Raid failed")
        failure = {"type": "error", "text": "The raid fell apart. Please try again."}
        yield f"data: {json.dumps(failure)}\n\n"


@router.post("/raid", dependencies=[Depends(rate_limit(RAID_REQUESTS_PER_MINUTE))])
async def raid(request: RaidRequest, services: Services = Depends(get_services)) -> StreamingResponse:
    return StreamingResponse(
        _sse(request, services),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/stats", response_model=Envelope[list[RaidStat]])
def get_stats(services: Services = Depends(get_services)) -> Envelope[list[RaidStat]]:
    return Envelope(data=services.repository.list_stats())
