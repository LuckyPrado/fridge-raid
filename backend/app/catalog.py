"""Grocery catalog: mocked prices, pack sizes, and shelf lives, with tolerant name matching."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Mapping

UNKNOWN_PACK_PRICE = 3.0
UNKNOWN_SHELF_LIFE_DAYS = 7

# Assumed to be in every kitchen, so never priced or tracked.
STAPLES = frozenset({"salt", "pepper", "black pepper", "olive oil", "oil", "vegetable oil", "water", "sugar"})

_DESCRIPTORS = frozenset(
    {"baby", "fresh", "organic", "shredded", "whole", "large", "small", "raw", "chopped", "diced", "sliced", "ripe"}
)


@dataclass(frozen=True)
class CatalogItem:
    name: str
    category: str
    unit: str
    pack_size: float
    pack_price: float
    shelf_life_days: int

    @property
    def unit_price(self) -> float:
        return self.pack_price / self.pack_size


def _singular(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("oes"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def normalize_name(name: str) -> str:
    """Reduce a free-text ingredient name to a matching key: 'Baby Spinach' -> 'spinach'."""
    words = re.sub(r"[^a-z ]", " ", name.lower()).split()
    kept = [w for w in words if w not in _DESCRIPTORS] or words
    if len(kept) > 1 and kept[-1] == "cheese" and kept[0] != "cream":
        kept = kept[:-1]
    return " ".join(_singular(w) for w in kept)


class Catalog:
    def __init__(self, items: tuple[CatalogItem, ...]) -> None:
        self._items = items
        self._by_key: Mapping[str, CatalogItem] = MappingProxyType({normalize_name(i.name): i for i in items})

    @property
    def items(self) -> tuple[CatalogItem, ...]:
        return self._items

    def lookup(self, name: str) -> CatalogItem | None:
        return self._by_key.get(normalize_name(name))

    def resolve(self, name: str, unit: str = "unit") -> CatalogItem:
        """Return the catalog entry, or a default-priced stand-in for unknown items."""
        found = self.lookup(name)
        if found is not None:
            return found
        return CatalogItem(
            name=name.strip().lower(),
            category="other",
            unit=unit or "unit",
            pack_size=1.0,
            pack_price=UNKNOWN_PACK_PRICE,
            shelf_life_days=UNKNOWN_SHELF_LIFE_DAYS,
        )

    def prompt_lines(self) -> str:
        return ", ".join(f"{i.name} ({i.unit})" for i in self._items)


def is_staple(name: str) -> bool:
    return normalize_name(name) in STAPLES


def load_catalog(path: Path) -> Catalog:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not load grocery catalog from {path}") from exc
    return Catalog(tuple(CatalogItem(**entry) for entry in raw))
