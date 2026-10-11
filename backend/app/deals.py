"""The Shopper's map: nearby stores, their weekly deals, and which store makes the plan cheapest.

Store names, distances, and offers are sample data in data/stores.json. No live prices are fetched.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path
from types import MappingProxyType
from typing import Mapping, Sequence

from app.catalog import Catalog, normalize_name
from app.optimizer import optimize_plan
from app.schemas import Deal, Dish, InventoryItem, StoreDeals, StoreInfo, WeekPlan


@dataclass(frozen=True)
class Store:
    info: StoreInfo
    # Sale price per pack, keyed by normalized item name.
    sale_prices: Mapping[str, float]


def load_stores(path: Path, catalog: Catalog) -> tuple[Store, ...]:
    """Read the store list, keeping only real deals: known items priced below the regular price."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not load stores from {path}") from exc
    stores = []
    for entry in raw:
        sale_prices = {}
        for name, price in entry.get("deals", {}).items():
            known = catalog.lookup(name)
            if known is not None and 0 < price < known.pack_price:
                sale_prices[normalize_name(name)] = float(price)
        info = StoreInfo(**{key: value for key, value in entry.items() if key != "deals"})
        stores.append(Store(info=info, sale_prices=MappingProxyType(sale_prices)))
    return tuple(stores)


def stores_from_places(places: Sequence[StoreInfo], samples: Sequence[Store]) -> tuple[Store, ...]:
    """Give each real store one of the sample deal sheets. The store is real, its prices are not.

    The sheet is picked from the store's id, so the same store always shows the same deals.
    """
    if not samples:
        return ()
    return tuple(
        Store(info=place, sale_prices=samples[sum(place.id.encode()) % len(samples)].sale_prices) for place in places
    )


def store_catalog(store: Store, catalog: Catalog) -> Catalog:
    """The grocery catalog as priced at one store."""
    return Catalog(
        tuple(
            replace(item, pack_price=store.sale_prices.get(normalize_name(item.name), item.pack_price))
            for item in catalog.items
        )
    )


def store_deals(store: Store, catalog: Catalog) -> StoreDeals:
    deals = tuple(
        Deal(
            name=item.name,
            unit=item.unit,
            pack_size=item.pack_size,
            price=store.sale_prices[normalize_name(item.name)],
            list_price=item.pack_price,
        )
        for item in catalog.items
        if normalize_name(item.name) in store.sale_prices
    )
    return StoreDeals(store=store.info, deals=deals)


def _rank(plan: WeekPlan, store: Store) -> tuple[float, int, float, float]:
    return (plan.waste_value_saved, len(plan.dishes), -plan.total_cost, -store.info.distance_mi)


@dataclass(frozen=True)
class StoreQuote:
    """What the plan would look like if all the shopping happened at one store."""

    store: Store
    plan: WeekPlan
    shop: Catalog


def quote_stores(
    candidates: Sequence[Dish],
    inventory: Sequence[InventoryItem],
    catalog: Catalog,
    stores: Sequence[Store],
    budget: float,
    max_meals: int,
) -> tuple[StoreQuote, ...]:
    """Plan a one-stop shop at every store. Best first: most food rescued, most meals, lowest cost, nearest."""
    quotes = []
    for store in stores:
        shop = store_catalog(store, catalog)
        plan = optimize_plan(candidates, inventory, catalog, budget, max_meals, shop=shop)
        quotes.append(StoreQuote(store=store, plan=plan.model_copy(update={"store": store.info}), shop=shop))
    return tuple(sorted(quotes, key=lambda quote: _rank(quote.plan, quote.store), reverse=True))


def best_store_plan(
    candidates: Sequence[Dish],
    inventory: Sequence[InventoryItem],
    catalog: Catalog,
    stores: Sequence[Store],
    budget: float,
    max_meals: int,
) -> tuple[WeekPlan, Catalog]:
    """The best one-stop plan across all stores, with that store's prices."""
    quotes = quote_stores(candidates, inventory, catalog, stores, budget, max_meals)
    if not quotes:
        return optimize_plan(candidates, inventory, catalog, budget, max_meals), catalog
    return quotes[0].plan, quotes[0].shop


def comparison_line(quotes: Sequence[StoreQuote]) -> str:
    """The Shopper explaining the store choice, with the real totals."""
    best = quotes[0]
    meals = len(best.plan.dishes)
    if best.plan.total_cost == 0:
        return f"I checked {len(quotes)} stores, but these {meals} meals need nothing from any of them."
    line = f"I priced your list at {len(quotes)} stores. {best.store.info.name} wins at ${best.plan.total_cost:.2f}."
    if len(quotes) > 1:
        runner_up = quotes[1]
        line += f" {runner_up.store.info.name} would be ${runner_up.plan.total_cost:.2f}."
    return line
