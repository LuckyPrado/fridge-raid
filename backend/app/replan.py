"""Changing a saved plan on request: add a dinner the player will like, or drop one. The cart is rebuilt."""

from __future__ import annotations

import logging
from typing import Sequence

from app import tracker
from app.agents.base import RaidContext
from app.agents.chef import OfflineChef, matches_favorite
from app.catalog import Catalog
from app.deals import Store, store_catalog
from app.optimizer import at_risk_items, build_cart, cart_total, rescued, stock_of
from app.repository import Repository
from app.schemas import MAX_PLAN_DISHES, Dish, Goals, SavedPlan

logger = logging.getLogger(__name__)


class PlanFull(ValueError):
    """The plan already holds as many dinners as it can."""


def _next_id(dishes: Sequence[Dish]) -> str:
    numbers = [int(dish.id[1:]) for dish in dishes if dish.id[:1] == "d" and dish.id[1:].isdigit()]
    return f"d{max(numbers, default=0) + 1}"


def _save_with(
    repository: Repository, catalog: Catalog, stores: Sequence[Store], saved: SavedPlan, dishes: tuple[Dish, ...]
) -> SavedPlan:
    """Store the plan with a new set of dishes, re-pricing the cart for what is still to cook."""
    plan = saved.plan
    inventory = tuple(repository.list_items())
    kept_ids = {dish.id for dish in dishes}
    cooked = tuple(dish_id for dish_id in saved.cooked if dish_id in kept_ids)
    still_to_cook = [dish for dish in dishes if dish.id not in cooked]
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
    result = SavedPlan(plan=updated, cooked=cooked)
    repository.put_doc(tracker.PLAN_KEY, result.model_dump_json())
    return result


async def add_dish(
    repository: Repository, catalog: Catalog, stores: Sequence[Store], chef: OfflineChef, goals: Goals
) -> Dish | None:
    """Add one more dinner to the plan, a favorite of the player when the recipe book has one that fits.

    Nothing already planned is removed. Returns the new dish, or None with no plan or no fitting recipe.
    """
    saved = tracker.load_plan(repository)
    if saved.plan is None:
        return None
    if len(saved.plan.dishes) >= MAX_PLAN_DISHES:
        raise PlanFull()
    ctx = RaidContext(inventory=tuple(repository.list_items()), arena_names=(), goals=goals, catalog=catalog)
    ideas = chef.ideas(ctx, exclude=tuple(dish.name for dish in saved.plan.dishes))
    if not ideas:
        return None
    # Stable sort: favorites first, and within each group the recipe book's own ranking holds.
    pick = sorted(ideas, key=lambda dish: not matches_favorite(dish, goals.favorites))[0]
    fresh = pick.model_copy(update={"id": _next_id(saved.plan.dishes)})
    _save_with(repository, catalog, stores, saved, (*saved.plan.dishes, fresh))
    return fresh


def remove_dish(repository: Repository, catalog: Catalog, stores: Sequence[Store], dish_id: str) -> SavedPlan | None:
    """Take one dinner out of the plan. None when the plan has no such dish."""
    saved = tracker.load_plan(repository)
    if saved.plan is None or all(dish.id != dish_id for dish in saved.plan.dishes):
        return None
    kept = tuple(dish for dish in saved.plan.dishes if dish.id != dish_id)
    return _save_with(repository, catalog, stores, saved, kept)
