"""Routes for the profile, the saved plan, cooking, the daily log, and store deals."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel

from app import tracker
from app.api import WRITE_REQUESTS_PER_MINUTE, Envelope
from app.deals import store_deals
from app.ratelimit import rate_limit
from app.schemas import (
    CookRequest,
    DaySummary,
    InventoryItem,
    LogRequest,
    Profile,
    Progress,
    SavedPlan,
    StoreDeals,
    WaterRequest,
)
from app.services import Services, get_services

DAY_PATTERN = r"^\d{4}-\d{2}-\d{2}$"
MIN_YEAR = 2000
MAX_YEAR = 2100

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


@router.get("/stores", response_model=Envelope[list[StoreDeals]])
def list_stores(services: Services = Depends(get_services)) -> Envelope[list[StoreDeals]]:
    return Envelope(data=[store_deals(store, services.catalog) for store in services.stores])
