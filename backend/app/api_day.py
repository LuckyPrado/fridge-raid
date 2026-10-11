"""Routes for the profile, the saved plan, cooking, the daily log, and store deals."""

from __future__ import annotations

import asyncio
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel

from app import demo, grocery, tracker
from app.chat import ChatFacts, converse_full
from app.agents.chef import matches_favorite
from app.catalog import normalize_name
from app.optimizer import at_risk_items
from app.inventory_ops import stock_purchase
from app.replan import PlanFull, add_dish, remove_dish
from app.api import WRITE_REQUESTS_PER_MINUTE, Envelope
from app.deals import store_deals
from app.places import PlacesError, find_stores
from app.ratelimit import rate_limit
from app.schemas import (
    MAX_WATER_GLASSES,
    BoughtRequest,
    BoughtResult,
    ChatReply,
    ChatRequest,
    CookRequest,
    DemoState,
    DemoSwitch,
    GroceryAdd,
    GroceryList,
    Quote,
    QuoteRequest,
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


@router.delete("/plan/dish/{dish_id}", response_model=Envelope[SavedPlan], dependencies=[write_limit])
def delete_dish(
    dish_id: str = Path(min_length=1, max_length=16), services: Services = Depends(get_services)
) -> Envelope[SavedPlan]:
    """Take one recipe out of the plan and re-price the shopping list."""
    stores = tracker.active_stores(services.repository, services.stores)
    updated = remove_dish(services.repository, services.catalog, stores, dish_id)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That recipe is not in your current plan.")
    return Envelope(data=updated)


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


def _chat_facts(services: Services, day: str | None) -> ChatFacts:
    repository = services.repository
    saved = tracker.load_plan(repository)
    upcoming = tracker.next_dish(saved)
    stores = tracker.active_stores(repository, services.stores)
    risky = at_risk_items(repository.list_items(), services.catalog)
    summary = tracker.day_summary(repository, day) if day else None

    def price_of(name: str) -> str | None:
        quote = grocery.best_quote(name, stores, services.catalog)
        if quote is None or not quote.known:
            return None
        deal = f", down from ${quote.list_price:.2f}" if quote.price < quote.list_price else ""
        return f"{quote.name.capitalize()} is cheapest at {quote.store}: ${quote.price:.2f} for {grocery.pack_label(quote)}{deal}."

    return ChatFacts(
        next_dish=upcoming.name if upcoming else "",
        next_dish_minutes=upcoming.minutes if upcoming else 0,
        use_soon=tuple(sorted(entry.name for entry in risky.values())),
        calories=summary.calories if summary else 0,
        protein_g=summary.protein_g if summary else 0,
        plan_cost=saved.plan.total_cost if saved.plan else None,
        store=saved.plan.store.name if saved.plan and saved.plan.store else "",
        price_of=price_of,
    )


def _chat_turn(services: Services, request: ChatRequest, day: str | None) -> tuple[Profile, ChatFacts]:
    return tracker.load_profile(services.repository), _chat_facts(services, day)


def _add_to_grocery(services: Services, names: list[str]) -> list[str]:
    """Put the asked-for items on the grocery list. Returns one line per item added."""
    stores = tracker.active_stores(services.repository, services.stores)
    lines = []
    for name in names:
        _, item = grocery.add_item(services.repository, name, stores, services.catalog)
        if item is not None:
            where = f" · ${item.price:.2f} at {item.store}" if item.store else ""
            lines.append(f"On your list: {item.name}{where}")
    return lines


def _remove_from_grocery(services: Services, names: list[str]) -> list[str]:
    current = grocery.load_list(services.repository)
    unwanted = {normalize_name(name) for name in names}
    kept = tuple(item for item in current.items if normalize_name(item.name) not in unwanted)
    if len(kept) == len(current.items):
        return []
    grocery.save_list(services.repository, GroceryList(items=kept))
    return [f"Off your list: {item.name}" for item in current.items if item not in kept]


def _add_water(services: Services, day: str, glasses: int) -> int:
    current = tracker.day_summary(services.repository, day).water
    return tracker.set_water(services.repository, day, min(MAX_WATER_GLASSES, current + glasses)).water


@router.post(
    "/chat",
    response_model=Envelope[ChatReply],
    dependencies=[Depends(rate_limit(CHAT_REQUESTS_PER_MINUTE))],
)
async def chat(
    request: ChatRequest, today: str | None = Query(default=None, pattern=DAY_PATTERN),
    services: Services = Depends(get_services),
) -> Envelope[ChatReply]:
    """Tell an agent what you want, or ask it a question. It answers and updates your saved preferences."""
    day = _checked_day(today) if today else None
    profile, facts = await asyncio.to_thread(_chat_turn, services, request, day)
    is_demo = await asyncio.to_thread(demo.is_on, services.repository)
    outcome = await converse_full(None if is_demo else services.llm, request.agent, request.message, profile, facts)
    if outcome.changes:
        await asyncio.to_thread(tracker.save_profile, services.repository, outcome.profile)
    added = await asyncio.to_thread(_add_to_grocery, services, outcome.grocery) if outcome.grocery else []
    reply = outcome.reply
    if outcome.grocery and not added:
        reply = f"{reply} That is already on your list."
    done = [*outcome.changes, *added]
    if outcome.ungrocery:
        done += await asyncio.to_thread(_remove_from_grocery, services, outcome.ungrocery)
    if outcome.swap_recipe:
        stores = await asyncio.to_thread(tracker.active_stores, services.repository, services.stores)
        try:
            fresh = await add_dish(
                services.repository, services.catalog, stores, services.recipe_chef, outcome.profile.goals
            )
        except PlanFull:
            fresh = None
        if fresh is None:
            reply = "I have no new dinner that fits your goals right now. Scan your fridge or loosen a goal."
        else:
            loved = [food for food in outcome.profile.goals.favorites if matches_favorite(fresh, [food])]
            because = f" You love {loved[0]}, so this one is for you." if loved else ""
            reply = f"How about {fresh.name}?{because} I added it and kept everything else."
            done.append(f"New recipe: {fresh.name}")
    if outcome.water and day:
        summary = await asyncio.to_thread(_add_water, services, day, outcome.water)
        done.append(f"Water: {summary} glasses today")
    return Envelope(data=ChatReply(agent=request.agent, reply=reply, profile=outcome.profile, changes=tuple(done)))


@router.post("/quote", response_model=Envelope[list[Quote]])
def quote(request: QuoteRequest, services: Services = Depends(get_services)) -> Envelope[list[Quote]]:
    """The best store and price for each named item, among the stores the Shopper is using."""
    stores = tracker.active_stores(services.repository, services.stores)
    return Envelope(data=grocery.quotes_for(request.names, stores, services.catalog))


@router.get("/grocery", response_model=Envelope[GroceryList])
def get_grocery(services: Services = Depends(get_services)) -> Envelope[GroceryList]:
    return Envelope(data=grocery.load_list(services.repository))


@router.put("/grocery", response_model=Envelope[GroceryList], dependencies=[write_limit])
def put_grocery(payload: GroceryList, services: Services = Depends(get_services)) -> Envelope[GroceryList]:
    return Envelope(data=grocery.save_list(services.repository, payload))


@router.post("/grocery", response_model=Envelope[GroceryList], dependencies=[write_limit])
def add_grocery(payload: GroceryAdd, services: Services = Depends(get_services)) -> Envelope[GroceryList]:
    """Price one item at the best store and add it to the list."""
    stores = tracker.active_stores(services.repository, services.stores)
    updated, _ = grocery.add_item(services.repository, payload.name, stores, services.catalog)
    return Envelope(data=updated)


@router.post("/plan/bought", response_model=Envelope[BoughtResult], dependencies=[write_limit])
def plan_bought(request: BoughtRequest, services: Services = Depends(get_services)) -> Envelope[BoughtResult]:
    """The player bought these shopping lines: stock the fridge so recipes see the ingredients."""
    items, saved = tracker.mark_bought(services.repository, services.catalog, request.names)
    return Envelope(data=BoughtResult(items=tuple(items), saved=saved, grocery=grocery.load_list(services.repository)))


@router.post("/grocery/bought", response_model=Envelope[BoughtResult], dependencies=[write_limit])
def grocery_bought(payload: GroceryAdd, services: Services = Depends(get_services)) -> Envelope[BoughtResult]:
    """The player bought one item from their own grocery list: stock the fridge and take it off the list."""
    repository = services.repository
    current = grocery.load_list(repository)
    wanted = normalize_name(payload.name)
    kept = tuple(item for item in current.items if normalize_name(item.name) != wanted)
    items = repository.list_items()
    if len(kept) < len(current.items):
        items = stock_purchase(items, services.catalog, payload.name)
        repository.replace_items(items)
        current = grocery.save_list(repository, GroceryList(items=kept))
    return Envelope(data=BoughtResult(items=tuple(items), saved=tracker.load_plan(repository), grocery=current))


@router.get("/demo", response_model=Envelope[DemoState])
def get_demo(services: Services = Depends(get_services)) -> Envelope[DemoState]:
    return Envelope(data=demo.state(services.repository))


@router.put("/demo", response_model=Envelope[DemoState], dependencies=[write_limit])
def put_demo(switch: DemoSwitch, services: Services = Depends(get_services)) -> Envelope[DemoState]:
    """Turn demo mode on or off. On: no live model calls, and scans replay the latest recording."""
    demo.set_on(services.repository, switch.on)
    return Envelope(data=demo.state(services.repository))
