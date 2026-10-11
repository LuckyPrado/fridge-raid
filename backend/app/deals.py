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


def best_store_plan(
    candidates: Sequence[Dish],
    inventory: Sequence[InventoryItem],
    catalog: Catalog,
    stores: Sequence[Store],
    budget: float,
    max_meals: int,
) -> tuple[WeekPlan, Catalog]:
    """Plan a one-stop shop at every store and keep the best. Returns the plan and that store's prices.

    Ranking matches the optimizer: most food rescued, most meals, lowest cost, then the nearest store.
    """
    if not stores:
        return optimize_plan(candidates, inventory, catalog, budget, max_meals), catalog
    best: tuple[WeekPlan, Catalog, Store] | None = None
    for store in stores:
        shop = store_catalog(store, catalog)
        plan = optimize_plan(candidates, inventory, catalog, budget, max_meals, shop=shop)
        if best is None or _rank(plan, store) > _rank(best[0], best[2]):
            best = (plan, shop, store)
    plan, shop, store = best
    return plan.model_copy(update={"store": store.info}), shop
