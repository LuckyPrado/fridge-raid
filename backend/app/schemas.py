"""Domain and wire models. Domain models are frozen: updates return new copies."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Category = Literal[
    "produce", "dairy", "protein", "grain", "pantry", "condiment", "frozen", "beverage", "leftover", "other"
]
CATEGORIES: tuple[str, ...] = (
    "produce", "dairy", "protein", "grain", "pantry", "condiment", "frozen", "beverage", "leftover", "other"
)
Diet = Literal["none", "vegetarian", "vegan", "pescatarian"]

MAX_INVENTORY_ITEMS = 200


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True)


class InventoryItem(Frozen):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=60)
    category: Category = "other"
    quantity: float = Field(gt=0, le=1000)
    unit: str = Field(default="unit", min_length=1, max_length=20)
    days_left: int = Field(ge=-30, le=3650)


class Ingredient(Frozen):
    name: str = Field(min_length=1, max_length=60)
    quantity: float = Field(gt=0, le=1000)
    unit: str = Field(default="unit", max_length=20)


class Dish(Frozen):
    id: str = ""
    name: str = Field(min_length=1, max_length=80)
    pitch: str = ""
    description: str = ""
    ingredients: tuple[Ingredient, ...] = Field(min_length=1)
    calories: int = Field(ge=0, le=5000)
    protein_g: int = Field(ge=0, le=500)
    sodium_mg: int = Field(ge=0, le=20000)
    minutes: int = Field(default=30, ge=0, le=600)
    diets: tuple[Diet, ...] = ()


class Verdict(Frozen):
    dish_id: str
    score: int = Field(ge=0, le=100)
    veto: bool
    reason: str


class Goals(Frozen):
    budget: float = Field(default=25.0, ge=0, le=500)
    diet: Diet = "none"
    max_calories: int = Field(default=800, ge=200, le=3000)
    max_sodium_mg: int = Field(default=900, ge=100, le=5000)
    min_protein_g: int = Field(default=15, ge=0, le=200)
    meals: int = Field(default=4, ge=1, le=7)


class CartLine(Frozen):
    name: str
    packs: int
    pack_size: float
    unit: str
    cost: float


class WeekPlan(Frozen):
    dishes: tuple[Dish, ...]
    cart: tuple[CartLine, ...]
    total_cost: float
    budget: float
    rescued: tuple[str, ...]
    waste_value_total: float
    waste_value_saved: float
    benched: tuple[str, ...] = ()


class RaidRequest(BaseModel):
    inventory: list[InventoryItem] = Field(min_length=1, max_length=MAX_INVENTORY_ITEMS)
    arena: list[str] = Field(default_factory=list, max_length=MAX_INVENTORY_ITEMS)
    goals: Goals = Goals()
    offline: bool = False


class InventoryPayload(BaseModel):
    items: list[InventoryItem] = Field(max_length=MAX_INVENTORY_ITEMS)


class AcceptRequest(BaseModel):
    inventory: list[InventoryItem] = Field(max_length=MAX_INVENTORY_ITEMS)
    plan: WeekPlan


class RaidStat(Frozen):
    ts: str
    meals: int
    spend: float
    waste_value_saved: float
    items_rescued: int


# --- Shapes the language model must return. Kept plain so they convert to a response schema. ---


class ScoutDraftItem(BaseModel):
    name: str
    category: str
    quantity: float
    unit: str
    days_left: int


class ScoutDraft(BaseModel):
    items: list[ScoutDraftItem]


class IngredientDraft(BaseModel):
    name: str
    quantity: float
    unit: str


class DishDraft(BaseModel):
    name: str
    pitch: str
    description: str
    ingredients: list[IngredientDraft]
    calories: int
    protein_g: int
    sodium_mg: int
    minutes: int


class ChefDraft(BaseModel):
    dishes: list[DishDraft]


class VerdictDraft(BaseModel):
    dish_id: str
    score: int
    veto: bool
    reason: str


class ReviewDraft(BaseModel):
    verdicts: list[VerdictDraft]


class Quip(BaseModel):
    text: str
