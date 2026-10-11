"""Routes for the profile, the saved plan, cooking, the daily log, and store deals."""

from __future__ import annotations

import asyncio
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel

from app import tracker
from app.chat import converse
from app.api import WRITE_REQUESTS_PER_MINUTE, Envelope
from app.deals import store_deals
from app.places import PlacesError, find_stores
from app.ratelimit import rate_limit
from app.schemas import (
    ChatReply,
    ChatRequest,
    CookRequest,
    DaySummary,
    InventoryItem,
    LogRequest,
    Nearby,
    Origin,
    Profile,
    Progress,
    SavedPlan,
    StoreBoard,
    WaterRequest,
)
from app.services import Services, get_services

DAY_PATTERN = r"^\d{4}-\d{2}-\d{2}$"
MIN_YEAR = 2000
MAX_YEAR = 2100
NEARBY_REQUESTS_PER_MINUTE = 6
CHAT_REQUESTS_PER_MINUTE = 20
RESET_REQUESTS_PER_MINUTE = 6

router = APIRouter(prefix="/api")
write_limit = Depends(rate_limit(WRITE_REQUESTS_PER_MINUTE))


class CookResult(BaseModel):
    items: list[InventoryItem]
    saved: SavedPlan
    day: DaySummary
    rescued: list[str]
    xp: int


def _checked_day(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That is not a real calendar day.") from exc
    if not MIN_YEAR <= parsed.year <= MAX_YEAR:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That day is out of range.")
    return value


def day_in_path(day: str = Path(pattern=DAY_PATTERN)) -> str:
    return _checked_day(day)


def day_in_query(today: str = Query(pattern=DAY_PATTERN)) -> str:
    return _checked_day(today)


@router.get("/profile", response_model=Envelope[Profile])
def get_profile(services: Services = Depends(get_services)) -> Envelope[Profile]:
    return Envelope(data=tracker.load_profile(services.repository))


@router.put("/profile", response_model=Envelope[Profile], dependencies=[write_limit])
def put_profile(profile: Profile, services: Services = Depends(get_services)) -> Envelope[Profile]:
    cleaned = profile.model_copy(update={"name": " ".join(profile.name.split())})
    return Envelope(data=tracker.save_profile(services.repository, cleaned))


@router.post("/reset", response_model=Envelope[Profile], dependencies=[Depends(rate_limit(RESET_REQUESTS_PER_MINUTE))])
def reset_everything(services: Services = Depends(get_services)) -> Envelope[Profile]:
    """Start over: erase the fridge, plan, food log, progress, location, and preferences."""
    services.repository.reset()
    return Envelope(data=tracker.load_profile(services.repository))


@router.get("/plan", response_model=Envelope[SavedPlan])
def get_plan(services: Services = Depends(get_services)) -> Envelope[SavedPlan]:
    return Envelope(data=tracker.load_plan(services.repository))


@router.post("/cook", response_model=Envelope[CookResult], dependencies=[write_limit])
def cook(request: CookRequest, services: Services = Depends(get_services)) -> Envelope[CookResult]:
    day = _checked_day(request.day)
    try:
        outcome = tracker.cook(services.repository, services.catalog, request.dish_id, day)
    except tracker.UnknownDish as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That recipe is not in your current plan.") from exc
    except tracker.AlreadyCooked as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already cooked and logged that recipe.") from exc
    return Envelope(
        data=CookResult(
            items=outcome.items, saved=outcome.saved, day=outcome.summary,
            rescued=list(outcome.rescued), xp=outcome.xp,
        )
    )


@router.get("/day/{day}", response_model=Envelope[DaySummary])
def get_day(day: str = Depends(day_in_path), services: Services = Depends(get_services)) -> Envelope[DaySummary]:
    return Envelope(data=tracker.day_summary(services.repository, day))


@router.post("/day/{day}/log", response_model=Envelope[DaySummary], dependencies=[write_limit])
def post_log(
    request: LogRequest, day: str = Depends(day_in_path), services: Services = Depends(get_services)
) -> Envelope[DaySummary]:
    return Envelope(data=tracker.log_food(services.repository, day, request))


@router.put("/day/{day}/water", response_model=Envelope[DaySummary], dependencies=[write_limit])
def put_water(
    request: WaterRequest, day: str = Depends(day_in_path), services: Services = Depends(get_services)
) -> Envelope[DaySummary]:
    return Envelope(data=tracker.set_water(services.repository, day, request.glasses))


@router.get("/progress", response_model=Envelope[Progress])
def get_progress(today: str = Depends(day_in_query), services: Services = Depends(get_services)) -> Envelope[Progress]:
    return Envelope(data=tracker.progress(services.repository, today))


def _store_board(services: Services) -> StoreBoard:
    nearby = tracker.load_nearby(services.repository)
    stores = tracker.active_stores(services.repository, services.stores)
    return StoreBoard(
        origin=nearby.origin if nearby and nearby.stores else None,
        stores=tuple(store_deals(store, services.catalog) for store in stores),
    )


@router.get("/stores", response_model=Envelope[StoreBoard])
def list_stores(services: Services = Depends(get_services)) -> Envelope[StoreBoard]:
    return Envelope(data=_store_board(services))


@router.post(
    "/nearby",
    response_model=Envelope[StoreBoard],
    dependencies=[Depends(rate_limit(NEARBY_REQUESTS_PER_MINUTE))],
)
async def set_location(origin: Origin, services: Services = Depends(get_services)) -> Envelope[StoreBoard]:
    """Look up real grocery stores around the player and make the Shopper use them."""
    # Keep the location coarse: about 100 m is plenty to center a map.
    coarse = Origin(lat=round(origin.lat, 3), lon=round(origin.lon, 3))
    places = await asyncio.to_thread(tracker.cached_places, services.repository, coarse.lat, coarse.lon)
    if not places:
        try:
            places = await find_stores(origin.lat, origin.lon)
        except PlacesError as exc:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, "The map service did not answer. Try again in a moment."
            ) from exc
        if not places:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No grocery stores were found within 2.5 miles of you.")
        await asyncio.to_thread(tracker.cache_places, services.repository, Nearby(origin=coarse, stores=places))
    await asyncio.to_thread(tracker.save_nearby, services.repository, Nearby(origin=coarse, stores=places))
    return Envelope(data=await asyncio.to_thread(_store_board, services))


@router.delete("/nearby", response_model=Envelope[StoreBoard], dependencies=[write_limit])
def forget_location(services: Services = Depends(get_services)) -> Envelope[StoreBoard]:
    tracker.save_nearby(services.repository, None)
    return Envelope(data=_store_board(services))


@router.post(
    "/chat",
    response_model=Envelope[ChatReply],
    dependencies=[Depends(rate_limit(CHAT_REQUESTS_PER_MINUTE))],
)
async def chat(request: ChatRequest, services: Services = Depends(get_services)) -> Envelope[ChatReply]:
    """Tell an agent what you want. It answers and updates your saved preferences."""
    profile = await asyncio.to_thread(tracker.load_profile, services.repository)
    reply, updated, changes = await converse(services.llm, request.agent, request.message, profile)
    if changes:
        await asyncio.to_thread(tracker.save_profile, services.repository, updated)
    return Envelope(data=ChatReply(agent=request.agent, reply=reply, profile=updated, changes=tuple(changes)))
