"""Shared types for the party of agents."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence

from pydantic import ValidationError

from app.catalog import Catalog
from app.schemas import Dish, DishDraft, Goals, Ingredient, InventoryItem, Verdict, WeekPlan

SERVINGS = 2


@dataclass(frozen=True)
class RaidContext:
    inventory: tuple[InventoryItem, ...]
    arena_names: tuple[str, ...]
    goals: Goals
    catalog: Catalog


@dataclass(frozen=True)
class Rejection:
    dish: Dish
    reason: str


class Chef(Protocol):
    async def propose(self, ctx: RaidContext, count: int) -> tuple[Dish, ...]: ...

    async def revise(
        self, ctx: RaidContext, rejections: Sequence[Rejection], taken_names: Sequence[str]
    ) -> tuple[Dish, ...]: ...


class Nutritionist(Protocol):
    async def review(self, dishes: Sequence[Dish], goals: Goals) -> tuple[Verdict, ...]: ...


class BargainHunter(Protocol):
    async def narrate(self, plan: WeekPlan, goals: Goals) -> str: ...


@dataclass(frozen=True)
class Party:
    name: str
    chef: Chef
    nutritionist: Nutritionist
    bargain_hunter: BargainHunter


def inventory_lines(items: Sequence[InventoryItem]) -> str:
    return "\n".join(
        f"- {item.name}: {item.quantity:g} {item.unit}, {item.days_left} day(s) left" for item in items
    )


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def dish_from_draft(draft: DishDraft) -> Dish | None:
    """Convert model output into a validated Dish, or None if it is unusable."""
    ingredients = tuple(
        Ingredient(name=entry.name.strip()[:60], quantity=min(entry.quantity, 1000), unit=entry.unit.strip()[:20])
        for entry in draft.ingredients
        if entry.name.strip() and entry.quantity > 0
    )
    if not draft.name.strip() or not ingredients:
        return None
    try:
        return Dish(
            name=draft.name.strip()[:80],
            pitch=draft.pitch.strip(),
            description=draft.description.strip(),
            ingredients=ingredients,
            calories=_clamp(draft.calories, 0, 5000),
            protein_g=_clamp(draft.protein_g, 0, 500),
            sodium_mg=_clamp(draft.sodium_mg, 0, 20000),
            minutes=_clamp(draft.minutes, 0, 600),
        )
    except ValidationError:
        return None
