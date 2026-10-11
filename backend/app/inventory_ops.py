"""Pure inventory transformations. Every function returns a new list."""

from __future__ import annotations

import uuid
from typing import Sequence

from app.catalog import normalize_name
from app.optimizer import total_needs
from app.schemas import Dish, InventoryItem

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


def cook_dish(inventory: Sequence[InventoryItem], dish: Dish) -> list[InventoryItem]:
    """Inventory after cooking one dish. Ingredients that are not in stock are assumed bought and used up."""
    needs = {key: need.quantity for key, need in total_needs([dish]).items()}
    return _consume(inventory, needs)
