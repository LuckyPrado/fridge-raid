"""The Scout: turns a fridge photo into a validated inventory list."""

from __future__ import annotations

from pydantic import ValidationError

from app.catalog import Catalog
from app.inventory_ops import new_item_id
from app.llm import LLM, LLMError
from app.schemas import (
    CATEGORIES,
    MAX_INVENTORY_ITEMS,
    FoundBox,
    InventoryItem,
    MealDraft,
    MealEstimate,
    ScanResult,
    ScoutDraft,
    ScoutDraftItem,
)

SCOUT_SYSTEM = """You are the Scout in a party of AI agents raiding a fridge. You read a fridge photo
and report exactly what food is visible. You never invent items you cannot see.

For each distinct food item return:
- "name": short, lowercase, singular. Use the grocery catalog spelling when the item is listed there.
- "category": one of produce, dairy, protein, grain, pantry, condiment, frozen, beverage, leftover, other.
- "quantity" and "unit": your best estimate, using the catalog unit when the item is listed there.
- "days_left": estimated days until it should be thrown out, judged from the food type and how it looks.
  Leafy greens, berries, raw meat, and fish get low numbers. Sealed condiments get high numbers.
- "box": [ymin, xmin, ymax, xmax] around the item in the photo, each from 0 to 1000.
Skip non-food objects. If the photo shows no food, return an empty list."""

MEAL_SYSTEM = """You estimate the nutrition of one plate of food from a photo, for a food diary.
Return a short plain name for the meal, and your best estimate for one serving as shown:
calories, grams of protein, and milligrams of sodium. Be realistic, not optimistic.
If the photo does not show food, name it "Not food" with zeros."""

BOX_GRID = 1000
MIN_BOX_SIDE = 0.02

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
    return list(scan_from_draft(draft, catalog).items)


def _box_for(item: InventoryItem, raw: list[int]) -> FoundBox | None:
    """A drawable box from the corner list the model returned, or None when the corners make no sense."""
    if len(raw) != 4:
        return None
    ymin, xmin, ymax, xmax = (max(0.0, min(1.0, value / BOX_GRID)) for value in raw)
    width, height = xmax - xmin, ymax - ymin
    if width < MIN_BOX_SIDE or height < MIN_BOX_SIDE:
        return None
    return FoundBox(
        item_id=item.id, name=item.name, x=round(xmin, 4), y=round(ymin, 4), width=round(width, 4), height=round(height, 4)
    )


def scan_from_draft(draft: ScoutDraft, catalog: Catalog) -> ScanResult:
    """Validated inventory plus, for each item the model could place, where it is in the photo."""
    items: list[InventoryItem] = []
    boxes: list[FoundBox] = []
    for entry in draft.items[:MAX_INVENTORY_ITEMS]:
        item = _item_from_draft(entry, catalog)
        if item is None:
            continue
        items.append(item)
        box = _box_for(item, entry.box)
        if box is not None:
            boxes.append(box)
    return ScanResult(items=tuple(items), boxes=tuple(boxes), has_photo=True)


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


async def scan_fridge(llm: LLM, image: bytes, mime_type: str, catalog: Catalog) -> ScanResult:
    """Read a fridge photo into an inventory with a box around each item found."""
    prompt = (
        "List the food in this fridge photo, with a box around each item.\n\n"
        f"Grocery catalog (name and unit): {catalog.prompt_lines()}"
    )
    draft = await llm.generate(
        system=SCOUT_SYSTEM, prompt=prompt, schema=ScoutDraft, image=(image, mime_type), temperature=0.2
    )
    result = scan_from_draft(draft, catalog)
    if draft.items and not result.items:
        raise LLMError("Scout output contained no usable items.")
    return result


async def estimate_meal(llm: LLM, image: bytes, mime_type: str) -> MealEstimate:
    """Name a plate of food from a photo and estimate its nutrition."""
    draft = await llm.generate(
        system=MEAL_SYSTEM, prompt="Estimate this meal.", schema=MealDraft, image=(image, mime_type), temperature=0.2
    )
    name = " ".join(draft.name.split())[:80]
    if not name or name.lower() == "not food":
        raise LLMError("The photo does not show a meal.")
    return MealEstimate(
        name=name,
        calories=max(0, min(5000, draft.calories)),
        protein_g=max(0, min(500, draft.protein_g)),
        sodium_mg=max(0, min(20000, draft.sodium_mg)),
    )
