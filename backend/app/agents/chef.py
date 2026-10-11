"""The Chef: proposes dishes that use what is in the fridge, expiring food first."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Sequence

from app.agents.base import (
    SERVINGS,
    RaidContext,
    Rejection,
    dish_from_draft,
    inventory_lines,
    reconcile_units,
)
from app.catalog import Catalog, normalize_name
from app.llm import LLM, LLMError
from app.optimizer import RISK_DAYS
from app.schemas import ChefDraft, Dish

CHEF_SYSTEM = f"""You are the Chef in a party of AI agents raiding a fridge. The enemy is food waste.
You are bold, dramatic, and obsessed with using food before it expires.

Rules:
- Every dish serves {SERVINGS}. Give nutrition per serving.
- Build each dish around items with the fewest days left. Never ignore the "must use" items.
- Prefer ingredients already in the fridge. Add at most 3 ingredients that must be bought.
- For ingredient names and units, use the grocery catalog spelling and unit exactly when the item is listed there.
- Do not list salt, pepper, oil, sugar, or water.
- "pitch" is one punchy in-character line of at most 20 words. "description" is one plain sentence.
- "steps" is 3 to 5 short cooking steps, one sentence or two each, in order.
- When the player lists favorite foods, lean toward them, but never at the cost of wasting expiring food.
- Never use a food the player avoids, even if it is about to expire.
- Make the dishes clearly different from each other."""

AT_RISK_BONUS = 3.0
IN_STOCK_BONUS = 1.0
MISSING_PENALTY = 1.5
ARENA_BONUS = 4.0
FAVORITE_BONUS = 2.5


def _goal_lines(ctx: RaidContext) -> str:
    goals = ctx.goals
    favorites = ", ".join(" ".join(favorite.split()) for favorite in goals.favorites) or "none given"
    return (
        f"Diet: {goals.diet}. Per serving: at most {goals.max_calories} calories, "
        f"at most {goals.max_sodium_mg} mg sodium, at least {goals.min_protein_g} g protein. "
        f"Weekly shopping budget: ${goals.budget:.2f}. Favorite foods: {favorites}. "
        f"Foods to avoid: {', '.join(' '.join(food.split()) for food in goals.avoid) or 'none'}."
    )


PORK = frozenset({"bacon", "sausage", "ham", "pork", "prosciutto", "pepperoni", "salami", "chorizo"})
SHELLFISH = frozenset({"shrimp", "crab", "lobster", "clam", "mussel", "oyster", "scallop", "prawn"})
MEAT = PORK | frozenset({"chicken", "beef", "turkey", "lamb", "steak", "veal", "duck"})
DAIRY = frozenset({"milk", "cheese", "cheddar", "mozzarella", "parmesan", "feta", "butter", "cream", "yogurt"})
ALCOHOL = frozenset({"wine", "beer", "rum", "vodka", "mirin", "sake", "bourbon"})
# Words that turn a dairy-sounding name into something else: coconut milk, peanut butter.
NOT_DAIRY = frozenset({"coconut", "peanut", "almond", "oat", "soy"})
# Diets judged from ingredients. The other diets rely on each recipe's own tags.
RULE_DIETS = frozenset({"kosher", "halal"})


def _ingredient_words(dish: Dish) -> list[set[str]]:
    return [set(normalize_name(ingredient.name).split()) for ingredient in dish.ingredients]


def fits_diet(dish: Dish, diet: str) -> bool:
    """Whether a dish suits a diet.

    Kosher and halal are checked by ingredient only: no pork or alcohol for halal, and no pork,
    shellfish, or meat with dairy for kosher. This cannot confirm certification or preparation.
    """
    if diet == "none":
        return True
    if diet not in RULE_DIETS:
        return diet in dish.diets
    words = _ingredient_words(dish)
    has = lambda group: any(entry & group for entry in words)  # noqa: E731
    if has(PORK):
        return False
    if diet == "halal":
        return not has(ALCOHOL)
    has_dairy = any(entry & DAIRY and not entry & NOT_DAIRY for entry in words)
    return not has(SHELLFISH) and not (has(MEAT) and has_dairy)


def avoided_in(dish: Dish, avoid: Sequence[str]) -> tuple[str, ...]:
    """The avoided foods that a dish contains, matched on ingredient names."""
    unwanted = {normalize_name(food) for food in avoid} - {""}
    hits = []
    for ingredient in dish.ingredients:
        key = normalize_name(ingredient.name)
        if any(food == key or food in key.split() for food in unwanted):
            hits.append(ingredient.name)
    return tuple(hits)


def matches_favorite(recipe: Dish, favorites: Sequence[str]) -> bool:
    """True when a favorite food names the dish or one of its ingredients."""
    wanted = {normalize_name(favorite) for favorite in favorites} - {""}
    if not wanted:
        return False
    title_words = {normalize_name(word) for word in recipe.name.split()}
    ingredients = {normalize_name(ingredient.name) for ingredient in recipe.ingredients}
    return any(
        favorite in title_words or favorite in ingredients or favorite in normalize_name(recipe.name)
        for favorite in wanted
    )


def _base_prompt(ctx: RaidContext) -> str:
    must_use = ", ".join(ctx.arena_names) or "none chosen"
    return (
        f"Fridge inventory:\n{inventory_lines(ctx.inventory)}\n\n"
        f"Must use (dragged into the arena): {must_use}\n\n"
        f"Player goals: {_goal_lines(ctx)}\n\n"
        f"Grocery catalog (name and unit): {ctx.catalog.prompt_lines()}"
    )


def _to_dishes(draft: ChefDraft, limit: int, catalog: Catalog) -> tuple[Dish, ...]:
    dishes = tuple(reconcile_units(dish, catalog) for dish in map(dish_from_draft, draft.dishes) if dish is not None)
    if not dishes:
        raise LLMError("Chef returned no usable dishes.")
    return dishes[:limit]


class GeminiChef:
    def __init__(self, llm: LLM) -> None:
        self._llm = llm

    async def propose(self, ctx: RaidContext, count: int) -> tuple[Dish, ...]:
        prompt = f"{_base_prompt(ctx)}\n\nPropose exactly {count} dishes."
        draft = await self._llm.generate(system=CHEF_SYSTEM, prompt=prompt, schema=ChefDraft)
        return _to_dishes(draft, count, ctx.catalog)

    async def revise(
        self, ctx: RaidContext, rejections: Sequence[Rejection], taken_names: Sequence[str]
    ) -> tuple[Dish, ...]:
        objections = "\n".join(f'- "{r.dish.name}" was vetoed: {r.reason}' for r in rejections)
        prompt = (
            f"{_base_prompt(ctx)}\n\n"
            f"The Nutritionist vetoed these dishes:\n{objections}\n\n"
            f"Already on the table, do not repeat: {', '.join(taken_names) or 'nothing'}\n\n"
            f"Propose exactly {len(rejections)} replacement dishes that fix the objections "
            "while still using the expiring food. Each pitch should react to the veto."
        )
        draft = await self._llm.generate(system=CHEF_SYSTEM, prompt=prompt, schema=ChefDraft)
        return _to_dishes(draft, len(rejections), ctx.catalog)


def load_recipes(path: Path) -> tuple[Dish, ...]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not load recipe book from {path}") from exc
    return tuple(Dish.model_validate(entry) for entry in raw)


class OfflineChef:
    """Rule-based Chef that works without a network, from a bundled recipe book."""

    def __init__(self, recipes: tuple[Dish, ...]) -> None:
        self._recipes = recipes

    def _score(self, recipe: Dish, ctx: RaidContext) -> float:
        days_left = {normalize_name(item.name): item.days_left for item in ctx.inventory}
        arena = {normalize_name(name) for name in ctx.arena_names}
        score = 0.0
        for ingredient in recipe.ingredients:
            key = normalize_name(ingredient.name)
            if key not in days_left:
                score -= MISSING_PENALTY
                continue
            score += AT_RISK_BONUS if days_left[key] <= RISK_DAYS else IN_STOCK_BONUS
            if key in arena:
                score += ARENA_BONUS
        if matches_favorite(recipe, ctx.goals.favorites):
            score += FAVORITE_BONUS
        return score

    def _ranked(self, ctx: RaidContext, exclude: Sequence[str]) -> list[Dish]:
        taken = {name.lower() for name in exclude}
        diet = ctx.goals.diet
        eligible = [
            recipe
            for recipe in self._recipes
            if recipe.name.lower() not in taken
            and fits_diet(recipe, diet)
            and not avoided_in(recipe, ctx.goals.avoid)
        ]
        return sorted(eligible, key=lambda recipe: self._score(recipe, ctx), reverse=True)

    def ideas(self, ctx: RaidContext, exclude: Sequence[str]) -> list[Dish]:
        """Every recipe that fits the diet, the avoid list and the per-meal limits, best first."""
        goals = ctx.goals
        return [
            recipe
            for recipe in self._ranked(ctx, exclude=exclude)
            if recipe.calories <= goals.max_calories and recipe.sodium_mg <= goals.max_sodium_mg
        ]

    async def propose(self, ctx: RaidContext, count: int) -> tuple[Dish, ...]:
        return tuple(self._ranked(ctx, exclude=())[:count])

    async def revise(
        self, ctx: RaidContext, rejections: Sequence[Rejection], taken_names: Sequence[str]
    ) -> tuple[Dish, ...]:
        goals = ctx.goals
        within_limits = [
            recipe
            for recipe in self._ranked(ctx, exclude=taken_names)
            if recipe.calories <= goals.max_calories and recipe.sodium_mg <= goals.max_sodium_mg
        ]
        replacements = within_limits[: len(rejections)]
        return tuple(
            dish.model_copy(update={"pitch": f"Fine! Out goes {rejection.dish.name}. {dish.pitch}"})
            for dish, rejection in zip(replacements, rejections)
        )
