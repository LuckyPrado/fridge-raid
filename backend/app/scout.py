"""The Scout: turns a fridge photo into a validated inventory list."""

from __future__ import annotations

from pydantic import ValidationError

from app.catalog import Catalog
from app.inventory_ops import new_item_id
from app.llm import LLM, LLMError
from app.schemas import CATEGORIES, MAX_INVENTORY_ITEMS, InventoryItem, ScoutDraft, ScoutDraftItem

SCOUT_SYSTEM = """You are the Scout in a party of AI agents raiding a fridge. You read a fridge photo
and report exactly what food is visible. You never invent items you cannot see.

For each distinct food item return:
- "name": short, lowercase, singular. Use the grocery catalog spelling when the item is listed there.
- "category": one of produce, dairy, protein, grain, pantry, condiment, frozen, beverage, leftover, other.
- "quantity" and "unit": your best estimate, using the catalog unit when the item is listed there.
- "days_left": estimated days until it should be thrown out, judged from the food type and how it looks.
  Leafy greens, berries, raw meat, and fish get low numbers. Sealed condiments get high numbers.
Skip non-food objects. If the photo shows no food, return an empty list."""

MIN_DAYS_LEFT = -30
MAX_DAYS_LEFT = 3650
MAX_QUANTITY = 1000


def _item_from_draft(draft: ScoutDraftItem, catalog: Catalog) -> InventoryItem | None:
    name = draft.name.strip().lower()[:60]
    if not name or draft.quantity <= 0:
        return None
    known = catalog.lookup(name)
    category = draft.category.strip().lower()
    if category not in CATEGORIES:
        category = known.category if known and known.category in CATEGORIES else "other"
    try:
        return InventoryItem(
            id=new_item_id(),
            name=known.name if known else name,
            category=category,
            quantity=min(draft.quantity, MAX_QUANTITY),
            unit=(draft.unit.strip().lower() or (known.unit if known else "unit"))[:20],
            days_left=max(MIN_DAYS_LEFT, min(MAX_DAYS_LEFT, draft.days_left)),
        )
    except ValidationError:
        return None


def items_from_draft(draft: ScoutDraft, catalog: Catalog) -> list[InventoryItem]:
    items = [item for item in (_item_from_draft(entry, catalog) for entry in draft.items) if item is not None]
    return items[:MAX_INVENTORY_ITEMS]


async def scout_fridge(llm: LLM, image: bytes, mime_type: str, catalog: Catalog) -> list[InventoryItem]:
    prompt = (
        "List the food in this fridge photo.\n\n"
        f"Grocery catalog (name and unit): {catalog.prompt_lines()}"
    )
    draft = await llm.generate(
        system=SCOUT_SYSTEM, prompt=prompt, schema=ScoutDraft, image=(image, mime_type), temperature=0.2
    )
    items = items_from_draft(draft, catalog)
    if draft.items and not items:
        raise LLMError("Scout output contained no usable items.")
    return items
