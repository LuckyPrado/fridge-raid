"""Changing a saved plan on request: the Chef swaps one dinner for another and the cart is rebuilt."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Sequence

from app import tracker
from app.agents.base import Party, RaidContext, Rejection
from app.catalog import Catalog
from app.deals import Store, store_catalog
from app.llm import LLMError
from app.optimizer import at_risk_items, build_cart, cart_total, rescued, stock_of
from app.repository import Repository
from app.schemas import Dish, Goals

logger = logging.getLogger(__name__)

SWAP_REASON = "The player asked for something different."


@dataclass(frozen=True)
class Swap:
    removed: str
    added: str


def _next_id(dishes: Sequence[Dish]) -> str:
    numbers = [int(dish.id[1:]) for dish in dishes if dish.id[:1] == "d" and dish.id[1:].isdigit()]
    return f"d{max(numbers, default=0) + 1}"


async def swap_next_dish(
    repository: Repository, catalog: Catalog, stores: Sequence[Store], party: Party, backup: Party, goals: Goals
) -> Swap | None:
    """Replace the next uncooked dinner with a new one from the Chef. None when there is nothing to swap or offer."""
    saved = tracker.load_plan(repository)
    target = tracker.next_dish(saved)
    if saved.plan is None or target is None:
        return None
    plan = saved.plan
    inventory = tuple(repository.list_items())
    ctx = RaidContext(inventory=inventory, arena_names=(), goals=goals, catalog=catalog)
    rejection = Rejection(dish=target, reason=SWAP_REASON)
    taken = tuple(dish.name for dish in plan.dishes)
    try:
        offered = await party.chef.revise(ctx, [rejection], taken)
    except LLMError:
        logger.warning("The live Chef could not offer a swap; using the recipe book.")
        offered = await backup.chef.revise(ctx, [rejection], taken)
    if not offered:
        return None

    fresh = offered[0].model_copy(update={"id": _next_id(plan.dishes)})
    dishes = tuple(fresh if dish.id == target.id else dish for dish in plan.dishes)
    still_to_cook = [dish for dish in dishes if dish.id not in saved.cooked]
    store = next((entry for entry in stores if plan.store and entry.info.id == plan.store.id), None)
    shop = store_catalog(store, catalog) if store else catalog
    cart = build_cart(still_to_cook, stock_of(inventory), shop, regular=catalog)
    saved_value, names = rescued(still_to_cook, at_risk_items(inventory, catalog))
    updated = plan.model_copy(
        update={
            "dishes": dishes,
            "cart": cart,
            "total_cost": cart_total(cart),
            "rescued": names,
            "waste_value_saved": min(saved_value, plan.waste_value_total),
        }
    )
    repository.put_doc(tracker.PLAN_KEY, saved.model_copy(update={"plan": updated}).model_dump_json())
    return Swap(removed=target.name, added=fresh.name)
