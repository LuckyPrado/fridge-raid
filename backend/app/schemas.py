"""Domain and wire models. Domain models are frozen: updates return new copies."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Category = Literal[
    "produce", "dairy", "protein", "grain", "pantry", "condiment", "frozen", "beverage", "leftover", "other"
]
CATEGORIES: tuple[str, ...] = (
    "produce", "dairy", "protein", "grain", "pantry", "condiment", "frozen", "beverage", "leftover", "other"
)
Diet = Literal["none", "vegetarian", "vegan", "pescatarian"]

MAX_INVENTORY_ITEMS = 200
MAX_STEPS = 8
MAX_STEP_CHARS = 240
MAX_FAVORITES = 8
MAX_AVOID = 12
MAX_NEARBY_STORES = 8
MAX_CHAT_CHARS = 400
MAX_WATER_GLASSES = 20

Day = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
Favorite = Annotated[str, Field(min_length=1, max_length=30)]
Step = Annotated[str, Field(min_length=1, max_length=MAX_STEP_CHARS)]


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
    steps: tuple[Step, ...] = Field(default=(), max_length=MAX_STEPS)


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
    favorites: tuple[Favorite, ...] = Field(default=(), max_length=MAX_FAVORITES)
    # Foods the player dislikes or cannot eat. No recipe may use them.
    avoid: tuple[Favorite, ...] = Field(default=(), max_length=MAX_AVOID)
    daily_calories: int = Field(default=1800, ge=800, le=6000)
    daily_protein_g: int = Field(default=100, ge=10, le=400)


MAX_PLAN_DISHES = 20
MAX_CART_LINES = 200
MAX_MONEY = 100_000


def _money() -> float:
    return Field(ge=0, le=MAX_MONEY, allow_inf_nan=False)


class CartLine(Frozen):
    name: str = Field(min_length=1, max_length=60)
    packs: int = Field(ge=1, le=1000)
    pack_size: float = Field(gt=0, le=1000, allow_inf_nan=False)
    unit: str = Field(max_length=20)
    cost: float = _money()
    # What the same packs cost at the regular price. Higher than cost when the store has a deal.
    list_cost: float = Field(default=0, ge=0, le=MAX_MONEY, allow_inf_nan=False)


class StoreInfo(Frozen):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=60)
    neighborhood: str = Field(default="", max_length=60)
    distance_mi: float = Field(ge=0, le=100)
    walk_min: int = Field(ge=0, le=6000)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)


class WeekPlan(Frozen):
    dishes: tuple[Dish, ...] = Field(max_length=MAX_PLAN_DISHES)
    cart: tuple[CartLine, ...] = Field(max_length=MAX_CART_LINES)
    total_cost: float = _money()
    budget: float = _money()
    rescued: tuple[str, ...] = Field(max_length=MAX_INVENTORY_ITEMS)
    waste_value_total: float = _money()
    waste_value_saved: float = _money()
    benched: tuple[str, ...] = Field(default=(), max_length=MAX_INVENTORY_ITEMS)
    store: StoreInfo | None = None


class RaidRequest(BaseModel):
    inventory: list[InventoryItem] = Field(min_length=1, max_length=MAX_INVENTORY_ITEMS)
    arena: list[str] = Field(default_factory=list, max_length=MAX_INVENTORY_ITEMS)
    goals: Goals = Goals()
    offline: bool = False


class InventoryPayload(BaseModel):
    items: list[InventoryItem] = Field(max_length=MAX_INVENTORY_ITEMS)


class Profile(Frozen):
    name: str = Field(default="", max_length=24)
    # False until the player has answered the party's first questions.
    onboarded: bool = False
    goals: Goals = Goals()


class SavedPlan(Frozen):
    """The party's latest plan and which of its dishes have been cooked."""

    plan: WeekPlan | None = None
    cooked: tuple[str, ...] = Field(default=(), max_length=MAX_PLAN_DISHES)


class LogEntry(Frozen):
    id: str = Field(min_length=1, max_length=64)
    ts: str
    day: Day
    name: str = Field(min_length=1, max_length=80)
    calories: int = Field(ge=0, le=5000)
    protein_g: int = Field(ge=0, le=500)
    sodium_mg: int = Field(ge=0, le=20000)
    kind: Literal["meal", "manual"] = "manual"


class DaySummary(Frozen):
    day: Day
    entries: tuple[LogEntry, ...]
    water: int
    calories: int
    protein_g: int
    sodium_mg: int
    coach: str


class Progress(Frozen):
    xp: int
    level: int
    streak: int
    meals_cooked: int
    items_rescued: int


class Deal(Frozen):
    name: str
    unit: str
    pack_size: float
    price: float
    list_price: float


class StoreDeals(Frozen):
    store: StoreInfo
    deals: tuple[Deal, ...]


class Origin(Frozen):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Nearby(Frozen):
    """Real stores found around the player's location."""

    origin: Origin
    stores: tuple[StoreInfo, ...] = Field(max_length=MAX_NEARBY_STORES)


class StoreBoard(Frozen):
    """The stores the Shopper works with: real nearby ones when a location is set, otherwise the samples."""

    origin: Origin | None
    stores: tuple[StoreDeals, ...]


class ChatRequest(BaseModel):
    agent: Literal["chef", "nutritionist", "bargain_hunter"]
    message: str = Field(min_length=1, max_length=MAX_CHAT_CHARS)


class ChatReply(Frozen):
    agent: str
    reply: str
    profile: Profile
    changes: tuple[str, ...]


class CookRequest(BaseModel):
    dish_id: str = Field(min_length=1, max_length=16)
    day: Day


class LogRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    calories: int = Field(ge=0, le=5000)
    protein_g: int = Field(default=0, ge=0, le=500)
    sodium_mg: int = Field(default=0, ge=0, le=20000)


class WaterRequest(BaseModel):
    glasses: int = Field(ge=0, le=MAX_WATER_GLASSES)


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
    steps: list[str]


class ChefDraft(BaseModel):
    dishes: list[DishDraft]


class ChatDraft(BaseModel):
    reply: str
    name: str
    diet: str
    budget: float
    meals: int
    daily_calories: int
    daily_protein_g: int
    max_calories: int
    max_sodium_mg: int
    add_favorites: list[str]
    remove_favorites: list[str]
    add_avoid: list[str]
    remove_avoid: list[str]


class VerdictDraft(BaseModel):
    dish_id: str
    score: int
    veto: bool
    reason: str


class ReviewDraft(BaseModel):
    verdicts: list[VerdictDraft]


class Quip(BaseModel):
    text: str
