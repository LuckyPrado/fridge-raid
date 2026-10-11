"""The Shopper's price finder and the player's own grocery list."""

from __future__ import annotations

import logging
from typing import Sequence

from pydantic import ValidationError

from app.catalog import Catalog, is_staple, normalize_name
from app.deals import Store
from app.repository import Repository
from app.schemas import MAX_GROCERY_ITEMS, GroceryItem, GroceryList, Quote

logger = logging.getLogger(__name__)

GROCERY_KEY = "grocery"


def best_quote(name: str, stores: Sequence[Store], catalog: Catalog) -> Quote | None:
    """Cheapest pack of one item across the stores. The nearest store wins a tie. None with no stores."""
    if not stores:
        return None
    entry = catalog.resolve(name)
    key = normalize_name(entry.name)
    best = min(stores, key=lambda store: (store.sale_prices.get(key, entry.pack_price), store.info.distance_mi))
    return Quote(
        name=entry.name,
        store=best.info.name,
        distance_mi=best.info.distance_mi,
        price=round(best.sale_prices.get(key, entry.pack_price), 2),
        list_price=round(entry.pack_price, 2),
        pack_size=entry.pack_size,
        unit=entry.unit,
        known=catalog.lookup(name) is not None,
    )


def quotes_for(names: Sequence[str], stores: Sequence[Store], catalog: Catalog) -> list[Quote]:
    seen: set[str] = set()
    quotes = []
    for name in names:
        key = normalize_name(name)
        if not key or key in seen or is_staple(name):
            continue
        seen.add(key)
        quote = best_quote(name, stores, catalog)
        if quote is not None:
            quotes.append(quote)
    return quotes


def pack_label(quote: Quote) -> str:
    size = f"{quote.pack_size:g}"
    return f"{size} {quote.unit}" if quote.unit != quote.name else f"pack of {size}"


def load_list(repository: Repository) -> GroceryList:
    raw = repository.get_doc(GROCERY_KEY)
    if not raw:
        return GroceryList()
    try:
        return GroceryList.model_validate_json(raw)
    except ValidationError:
        logger.warning("The stored grocery list is unreadable; starting an empty one.")
        return GroceryList()


def save_list(repository: Repository, grocery: GroceryList) -> GroceryList:
    repository.put_doc(GROCERY_KEY, grocery.model_dump_json())
    return grocery


def add_item(
    repository: Repository, name: str, stores: Sequence[Store], catalog: Catalog
) -> tuple[GroceryList, GroceryItem | None]:
    """Price an item at the best store and put it on the list. Returns the list and the new line, if added."""
    current = load_list(repository)
    quote = best_quote(" ".join(name.split()), stores, catalog)
    label = quote.name if quote else " ".join(name.lower().split())[:60]
    already = {normalize_name(item.name) for item in current.items}
    if not label or normalize_name(label) in already or len(current.items) >= MAX_GROCERY_ITEMS:
        return current, None
    item = GroceryItem(
        name=label,
        store=quote.store if quote else "",
        price=quote.price if quote else 0,
        pack=pack_label(quote) if quote else "",
    )
    return save_list(repository, GroceryList(items=(*current.items, item))), item
