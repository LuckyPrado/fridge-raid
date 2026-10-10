"""Pure inventory transformations. Every function returns a new list."""

from __future__ import annotations

import uuid
from typing import Iterable, Sequence

from app.catalog import Catalog, normalize_name
from app.optimizer import total_needs
from app.schemas import CATEGORIES, InventoryItem, WeekPlan

_EPSILON = 1e-9


def new_item_id() -> str:
    return uuid.uuid4().hex[:12]


def _consume(inventory: Sequence[InventoryItem], needs: dict[str, float]) -> list[InventoryItem]:
    """Use up needed quantities, taking from the soonest-to-expire items first."""
    remaining = dict(needs)
    kept: list[InventoryItem] = []
    for item in sorted(inventory, key=lambda entry: entry.days_left):
        key = normalize_name(item.name)
        wanted = remaining.get(key, 0.0)
        used = min(wanted, item.quantity)
        remaining[key] = wanted - used
        left = round(item.quantity - used, 3)
        if left > _EPSILON:
            kept.append(item.model_copy(update={"quantity": left}))
    return kept


def _leftover_purchases(plan: WeekPlan, shortfalls: dict[str, float], catalog: Catalog) -> Iterable[InventoryItem]:
    for line in plan.cart:
        key = normalize_name(line.name)
        leftover = round(line.packs * line.pack_size - shortfalls.get(key, 0.0), 3)
        if leftover <= _EPSILON:
            continue
        entry = catalog.resolve(line.name, line.unit)
        category = entry.category if entry.category in CATEGORIES else "other"
        yield InventoryItem(
            id=new_item_id(),
            name=entry.name,
            category=category,
            quantity=leftover,
            unit=entry.unit,
            days_left=entry.shelf_life_days,
        )


def apply_plan(inventory: Sequence[InventoryItem], plan: WeekPlan, catalog: Catalog) -> list[InventoryItem]:
    """Inventory after cooking the plan and unpacking the groceries it bought."""
    needs = {key: need.quantity for key, need in total_needs(plan.dishes).items()}
    stock: dict[str, float] = {}
    for item in inventory:
        key = normalize_name(item.name)
        stock[key] = stock.get(key, 0.0) + item.quantity
    shortfalls = {key: max(0.0, quantity - stock.get(key, 0.0)) for key, quantity in needs.items()}
    after_cooking = _consume(inventory, needs)
    return [*after_cooking, *_leftover_purchases(plan, shortfalls, catalog)]
