"""Application services, built once at startup and injected into routes."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

from fastapi import Request

from app.agents.base import Party
from app.agents.bargain_hunter import GeminiBargainHunter, OfflineBargainHunter
from app.agents.chef import GeminiChef, OfflineChef, load_recipes
from app.agents.nutritionist import GeminiNutritionist, OfflineNutritionist
from app.catalog import Catalog, load_catalog
from app.config import DATA_DIR, Settings
from app.deals import Store, load_stores
from app.llm import LLM, GeminiLLM
from app.repository import Repository, create_repository
from app.schemas import Frozen, InventoryItem

logger = logging.getLogger(__name__)


class DemoFridge(Frozen):
    id: str
    title: str
    blurb: str
    items: tuple[InventoryItem, ...]


@dataclass(frozen=True)
class Services:
    settings: Settings
    catalog: Catalog
    repository: Repository
    llm: LLM | None
    live_party: Party | None
    offline_party: Party
    demo_fridges: tuple[DemoFridge, ...]
    stores: tuple[Store, ...] = ()
    # The built-in recipe book, used for instant suggestions outside a full planning round.
    recipe_chef: OfflineChef | None = None

    def party_for(self, force_offline: bool) -> Party:
        if force_offline or self.live_party is None:
            return self.offline_party
        return self.live_party


def load_demo_fridges(path: Path) -> tuple[DemoFridge, ...]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not load demo fridges from {path}") from exc
    return tuple(
        DemoFridge(
            id=fridge["id"],
            title=fridge["title"],
            blurb=fridge["blurb"],
            items=tuple(
                InventoryItem(id=f"{fridge['id']}-{index}", **item) for index, item in enumerate(fridge["items"])
            ),
        )
        for fridge in raw
    )


def build_services(
    settings: Settings, repository: Repository | None = None, llm: LLM | None = None
) -> Services:
    catalog = load_catalog(DATA_DIR / "prices.json")
    recipe_chef = OfflineChef(load_recipes(DATA_DIR / "recipes.json"))
    offline_party = Party(
        name="offline",
        chef=recipe_chef,
        nutritionist=OfflineNutritionist(),
        bargain_hunter=OfflineBargainHunter(),
    )
    if llm is None and settings.gemini_api_key:
        llm = GeminiLLM(settings.gemini_api_key, settings.gemini_model, settings.gemini_fallback_models)
    live_party = None
    if llm is not None:
        live_party = Party(
            name="gemini",
            chef=GeminiChef(llm),
            nutritionist=GeminiNutritionist(llm),
            bargain_hunter=GeminiBargainHunter(llm),
        )
    return Services(
        settings=settings,
        catalog=catalog,
        repository=repository or create_repository(settings.database_url, settings.sqlite_path),
        llm=llm,
        live_party=live_party,
        offline_party=offline_party,
        demo_fridges=load_demo_fridges(DATA_DIR / "demo" / "fridges.json"),
        stores=load_stores(DATA_DIR / "stores.json", catalog),
        recipe_chef=recipe_chef,
    )


def get_services(request: Request) -> Services:
    return request.app.state.services
