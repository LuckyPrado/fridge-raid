from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.catalog import Catalog, CatalogItem
from app.config import Settings
from app.main import create_app
from app.repository import sqlite_repository
from app.schemas import Dish, Ingredient, InventoryItem


def make_item(name: str, quantity: float, days_left: int, unit: str = "unit", item_id: str | None = None) -> InventoryItem:
    return InventoryItem(id=item_id or name, name=name, quantity=quantity, unit=unit, days_left=days_left)


def make_dish(name: str, ingredients: dict[str, float], **nutrition: int) -> Dish:
    return Dish(
        name=name,
        ingredients=tuple(Ingredient(name=n, quantity=q, unit="unit") for n, q in ingredients.items()),
        calories=nutrition.get("calories", 500),
        protein_g=nutrition.get("protein_g", 25),
        sodium_mg=nutrition.get("sodium_mg", 500),
    )


@pytest.fixture
def catalog() -> Catalog:
    return Catalog(
        (
            CatalogItem("spinach", "produce", "unit", 4, 2.00, 5),
            CatalogItem("egg", "dairy", "unit", 12, 3.00, 21),
            CatalogItem("cheese", "dairy", "unit", 1, 4.00, 21),
            CatalogItem("rice", "grain", "unit", 10, 2.00, 365),
            CatalogItem("salmon", "protein", "unit", 1, 9.00, 2),
        )
    )


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        gemini_api_key=None,
        gemini_model="test-model",
        database_url=None,
        sqlite_path=tmp_path / "test.sqlite3",
        cors_origins=("http://localhost:5173",),
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings=settings, repository=sqlite_repository(settings.sqlite_path))
    with TestClient(app) as test_client:
        yield test_client
