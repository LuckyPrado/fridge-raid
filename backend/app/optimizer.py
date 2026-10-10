"""Bargain Hunter's brain: pick the dishes and the cheapest cart that unlock the most meals.

Buying one pack can unlock several dishes, so dishes cannot be costed one at a time.
The candidate list is small, so every subset is checked exactly.
Ranking is lexicographic: most meals, then most at-risk food rescued, then lowest cost.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import combinations
from typing import Iterable, Mapping, Sequence

from app.catalog import Catalog, is_staple, normalize_name
from app.schemas import CartLine, Dish, InventoryItem, WeekPlan

RISK_DAYS = 3
MAX_EXACT_CANDIDATES = 12
_EPSILON = 1e-9


@dataclass(frozen=True)
class Need:
    name: str
    unit: str
    quantity: float


@dataclass(frozen=True)
class AtRisk:
    name: str
    quantity: float
    value: float


def stock_of(inventory: Iterable[InventoryItem]) -> dict[str, float]:
    stock: dict[str, float] = {}
    for item in inventory:
        key = normalize_name(item.name)
        stock[key] = stock.get(key, 0.0) + item.quantity
    return stock


def total_needs(dishes: Iterable[Dish]) -> dict[str, Need]:
    needs: dict[str, Need] = {}
    for dish in dishes:
        for ingredient in dish.ingredients:
            if is_staple(ingredient.name):
                continue
            key = normalize_name(ingredient.name)
            previous = needs.get(key)
            quantity = ingredient.quantity + (previous.quantity if previous else 0.0)
            needs[key] = Need(name=ingredient.name, unit=ingredient.unit, quantity=quantity)
    return needs


def build_cart(dishes: Iterable[Dish], stock: Mapping[str, float], catalog: Catalog) -> tuple[CartLine, ...]:
    lines = []
    for key, need in sorted(total_needs(dishes).items()):
        shortfall = need.quantity - stock.get(key, 0.0)
        if shortfall <= _EPSILON:
            continue
        entry = catalog.resolve(need.name, need.unit)
        packs = math.ceil(shortfall / entry.pack_size - _EPSILON)
        lines.append(
            CartLine(
                name=entry.name,
                packs=packs,
                pack_size=entry.pack_size,
                unit=entry.unit,
                cost=round(packs * entry.pack_price, 2),
            )
        )
    return tuple(lines)


def cart_total(cart: Iterable[CartLine]) -> float:
    return round(sum(line.cost for line in cart), 2)


def at_risk_items(inventory: Iterable[InventoryItem], catalog: Catalog) -> dict[str, AtRisk]:
    """Food that will be wasted soon, with its dollar value. This is the boss's health."""
    risky: dict[str, AtRisk] = {}
    for item in inventory:
        if item.days_left > RISK_DAYS or is_staple(item.name):
            continue
        key = normalize_name(item.name)
        value = item.quantity * catalog.resolve(item.name, item.unit).unit_price
        previous = risky.get(key)
        risky[key] = AtRisk(
            name=item.name,
            quantity=item.quantity + (previous.quantity if previous else 0.0),
            value=value + (previous.value if previous else 0.0),
        )
    return risky


def waste_value_total(risky: Mapping[str, AtRisk]) -> float:
    return round(sum(entry.value for entry in risky.values()), 2)


def rescued(dishes: Iterable[Dish], risky: Mapping[str, AtRisk]) -> tuple[float, tuple[str, ...]]:
    """Dollar value and names of at-risk food that the given dishes use up."""
    needs = total_needs(dishes)
    value = 0.0
    names = []
    for key, entry in risky.items():
        need = needs.get(key)
        if need is None:
            continue
        value += entry.value * min(1.0, need.quantity / entry.quantity)
        names.append(entry.name)
    return round(value, 2), tuple(sorted(names))


def _shortlist(candidates: Sequence[Dish], risky: Mapping[str, AtRisk]) -> list[Dish]:
    if len(candidates) <= MAX_EXACT_CANDIDATES:
        return list(candidates)
    ranked = sorted(candidates, key=lambda dish: rescued([dish], risky)[0], reverse=True)
    return ranked[:MAX_EXACT_CANDIDATES]


def optimize_plan(
    candidates: Sequence[Dish],
    inventory: Sequence[InventoryItem],
    catalog: Catalog,
    budget: float,
    max_meals: int,
) -> WeekPlan:
    stock = stock_of(inventory)
    risky = at_risk_items(inventory, catalog)
    pool = _shortlist(candidates, risky)

    best: tuple[Dish, ...] = ()
    best_key: tuple[int, float, float] = (0, 0.0, 0.0)
    for size in range(1, min(max_meals, len(pool)) + 1):
        for subset in combinations(pool, size):
            cost = cart_total(build_cart(subset, stock, catalog))
            if cost > budget + _EPSILON:
                continue
            key = (size, rescued(subset, risky)[0], -cost)
            if key > best_key:
                best, best_key = subset, key

    ordered = tuple(sorted(best, key=lambda dish: rescued([dish], risky)[0], reverse=True))
    cart = build_cart(ordered, stock, catalog)
    saved, names = rescued(ordered, risky)
    chosen_ids = {id(dish) for dish in ordered}
    return WeekPlan(
        dishes=ordered,
        cart=cart,
        total_cost=cart_total(cart),
        budget=budget,
        rescued=names,
        waste_value_total=waste_value_total(risky),
        waste_value_saved=saved,
        benched=tuple(dish.name for dish in candidates if id(dish) not in chosen_ids),
    )
