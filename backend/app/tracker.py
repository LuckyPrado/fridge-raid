"""The Nutritionist's ledger: the daily food log, water, cooking a planned dish, and progress.

All state lives in the repository. Functions here read it, apply one change, and write it back.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Sequence

from pydantic import ValidationError

from app.catalog import Catalog, normalize_name
from app.deals import Store, stores_from_places
from app.inventory_ops import cook_dish, new_item_id, stock_purchase
from app.optimizer import at_risk_items, rescued
from app.repository import PLACES_CACHE_PREFIX, Repository, utc_now_iso
from app.schemas import (
    DaySummary,
    Dish,
    Goals,
    InventoryItem,
    LogEntry,
    LogRequest,
    Nearby,
    Profile,
    Progress,
    RaidStat,
    SavedPlan,
    StoreInfo,
    WeekPlan,
)

logger = logging.getLogger(__name__)

PROFILE_KEY = "profile"
PLAN_KEY = "plan"
NEARBY_KEY = "nearby"
XP_PER_MEAL = 20
XP_PER_RESCUE = 20
XP_PER_LEVEL = 100

# One cook at a time, so a double tap cannot log and consume the same dish twice.
_cook_lock = threading.Lock()


class UnknownDish(LookupError):
    """The dish is not in the current plan."""


class AlreadyCooked(ValueError):
    """The dish was already cooked and logged."""


@dataclass(frozen=True)
class CookOutcome:
    items: list[InventoryItem]
    saved: SavedPlan
    summary: DaySummary
    rescued: tuple[str, ...]
    xp: int


def _water_key(day: str) -> str:
    return f"water:{day}"


def load_profile(repository: Repository) -> Profile:
    raw = repository.get_doc(PROFILE_KEY)
    if raw is None:
        return Profile()
    try:
        return Profile.model_validate_json(raw)
    except ValidationError:
        logger.warning("Stored profile is unreadable; using defaults.")
        return Profile()


def save_profile(repository: Repository, profile: Profile) -> Profile:
    repository.put_doc(PROFILE_KEY, profile.model_dump_json())
    return profile


def load_plan(repository: Repository) -> SavedPlan:
    raw = repository.get_doc(PLAN_KEY)
    if raw is None:
        return SavedPlan()
    try:
        return SavedPlan.model_validate_json(raw)
    except ValidationError:
        logger.warning("Stored plan is unreadable; starting without one.")
        return SavedPlan()


def save_plan(repository: Repository, plan: WeekPlan) -> SavedPlan:
    saved = SavedPlan(plan=plan)
    repository.put_doc(PLAN_KEY, saved.model_dump_json())
    return saved


def load_nearby(repository: Repository) -> Nearby | None:
    raw = repository.get_doc(NEARBY_KEY)
    if not raw:
        return None
    try:
        return Nearby.model_validate_json(raw)
    except ValidationError:
        logger.warning("Stored nearby stores are unreadable; using the sample stores.")
        return None


def save_nearby(repository: Repository, nearby: Nearby | None) -> None:
    repository.put_doc(NEARBY_KEY, nearby.model_dump_json() if nearby else "")


def active_stores(repository: Repository, samples: Sequence[Store]) -> tuple[Store, ...]:
    """Real nearby stores when the player has shared a location and some were found, otherwise the samples."""
    nearby = load_nearby(repository)
    if nearby is None or not nearby.stores:
        return tuple(samples)
    return stores_from_places(nearby.stores, samples)


def _places_key(lat: float, lon: float) -> str:
    """Cache key for a store search. Two decimals is about a kilometer, so one venue shares one entry."""
    return f"{PLACES_CACHE_PREFIX}{lat:.2f},{lon:.2f}"


def cached_places(repository: Repository, lat: float, lon: float) -> tuple[StoreInfo, ...]:
    """Stores found earlier around this spot, so a slow or busy map server is only needed once."""
    raw = repository.get_doc(_places_key(lat, lon))
    if not raw:
        return ()
    try:
        return Nearby.model_validate_json(raw).stores
    except ValidationError:
        return ()


def cache_places(repository: Repository, nearby: Nearby) -> None:
    repository.put_doc(_places_key(nearby.origin.lat, nearby.origin.lon), nearby.model_dump_json())


def next_dish(saved: SavedPlan) -> Dish | None:
    """The first planned dish that has not been cooked yet."""
    if saved.plan is None:
        return None
    return next((dish for dish in saved.plan.dishes if dish.id not in saved.cooked), None)


def coach_message(goals: Goals, calories: int, protein_g: int, upcoming: Dish | None) -> str:
    """One line from the Nutritionist about today, always citing the player's own numbers."""
    over = calories - goals.daily_calories
    if over > 0:
        return f"You are {over} kcal past today's {goals.daily_calories} kcal goal. Keep the next plate light."
    protein_left = goals.daily_protein_g - protein_g
    if protein_left <= 0:
        return f"Protein goal met at {protein_g} g. {goals.daily_calories - calories} kcal still open today."
    if upcoming is None:
        return f"{protein_left} g of protein to go. Scan your fridge and I will line up a dinner that helps."
    after = max(0, protein_left - upcoming.protein_g)
    if after == 0:
        return f"{upcoming.name} adds {upcoming.protein_g} g of protein. That closes today's goal."
    return f"{protein_left} g of protein to go. {upcoming.name} adds {upcoming.protein_g} g and leaves {after} g."


def _water(repository: Repository, day: str) -> int:
    raw = repository.get_doc(_water_key(day)) or "0"
    return int(raw) if raw.isdigit() else 0


def day_summary(repository: Repository, day: str) -> DaySummary:
    entries = tuple(repository.list_log(day))
    calories = sum(entry.calories for entry in entries)
    protein_g = sum(entry.protein_g for entry in entries)
    goals = load_profile(repository).goals
    return DaySummary(
        day=day,
        entries=entries,
        water=_water(repository, day),
        calories=calories,
        protein_g=protein_g,
        sodium_mg=sum(entry.sodium_mg for entry in entries),
        coach=coach_message(goals, calories, protein_g, next_dish(load_plan(repository))),
    )


def log_food(repository: Repository, day: str, request: LogRequest) -> DaySummary:
    repository.add_log(
        LogEntry(
            id=new_item_id(), ts=utc_now_iso(), day=day, name=" ".join(request.name.split()),
            calories=request.calories, protein_g=request.protein_g, sodium_mg=request.sodium_mg, kind="manual",
        )
    )
    return day_summary(repository, day)


def set_water(repository: Repository, day: str, glasses: int) -> DaySummary:
    repository.put_doc(_water_key(day), str(glasses))
    return day_summary(repository, day)


def cook(repository: Repository, catalog: Catalog, dish_id: str, day: str) -> CookOutcome:
    """Cook one planned dish: use up its ingredients, log one serving, and record what was rescued."""
    with _cook_lock:
        return _cook(repository, catalog, dish_id, day)


def _cook(repository: Repository, catalog: Catalog, dish_id: str, day: str) -> CookOutcome:
    saved = load_plan(repository)
    dish = next((entry for entry in (saved.plan.dishes if saved.plan else ()) if entry.id == dish_id), None)
    if dish is None:
        raise UnknownDish(dish_id)
    if dish_id in saved.cooked:
        raise AlreadyCooked(dish_id)

    inventory = repository.list_items()
    value, names = rescued([dish], at_risk_items(inventory, catalog))
    items = cook_dish(inventory, dish)
    now = utc_now_iso()
    updated = saved.model_copy(update={"cooked": (*saved.cooked, dish_id)})

    # Mark the dish cooked first: if a later write fails, a retry cannot consume the food twice.
    repository.put_doc(PLAN_KEY, updated.model_dump_json())
    repository.replace_items(items)
    repository.add_log(
        LogEntry(
            id=new_item_id(), ts=now, day=day, name=dish.name, calories=dish.calories,
            protein_g=dish.protein_g, sodium_mg=dish.sodium_mg, kind="meal",
        )
    )
    repository.add_stat(RaidStat(ts=now, meals=1, spend=0.0, waste_value_saved=value, items_rescued=len(names)))
    return CookOutcome(
        items=items,
        saved=updated,
        summary=day_summary(repository, day),
        rescued=names,
        xp=XP_PER_MEAL + XP_PER_RESCUE * len(names),
    )


def mark_bought(repository: Repository, catalog: Catalog, names: Sequence[str]) -> tuple[list[InventoryItem], SavedPlan]:
    """Put bought shopping lines into the fridge and tick them off the plan. A line is only stocked once."""
    saved = load_plan(repository)
    inventory = repository.list_items()
    if saved.plan is None:
        return inventory, saved
    wanted = {normalize_name(name) for name in names}
    newly = [
        line for line in saved.plan.cart if normalize_name(line.name) in wanted and line.name not in saved.bought
    ]
    if not newly:
        return inventory, saved
    for line in newly:
        inventory = stock_purchase(inventory, catalog, line.name, line.packs)
    updated = saved.model_copy(update={"bought": (*saved.bought, *(line.name for line in newly))})
    repository.replace_items(inventory)
    repository.put_doc(PLAN_KEY, updated.model_dump_json())
    return inventory, updated


def _streak(days: list[str], today: str) -> int:
    """Consecutive logged days ending today, or ending yesterday if today has no entry yet."""
    logged = set(days)
    cursor = date.fromisoformat(today)
    if cursor.isoformat() not in logged:
        cursor -= timedelta(days=1)
    streak = 0
    while cursor.isoformat() in logged:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def progress(repository: Repository, today: str) -> Progress:
    stats = repository.list_stats()
    meals = sum(stat.meals for stat in stats)
    items = sum(stat.items_rescued for stat in stats)
    xp = XP_PER_MEAL * meals + XP_PER_RESCUE * items
    return Progress(
        xp=xp,
        level=xp // XP_PER_LEVEL + 1,
        streak=_streak(repository.logged_days(), today),
        meals_cooked=meals,
        items_rescued=items,
    )
