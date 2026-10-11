"""The Nutritionist: scores each dish against the player's goals and can veto."""

from __future__ import annotations

from typing import Sequence

from app.agents.chef import RULE_DIETS, avoided_in, fits_diet
from app.llm import LLM
from app.schemas import Dish, Goals, ReviewDraft, Verdict

NUTRITIONIST_SYSTEM = """You are the Nutritionist in a party of AI agents raiding a fridge.
You are precise, a little stern, and you do not let the Chef get away with anything.

For each dish, return a verdict:
- "score" from 0 to 100 for how well it fits the player's goals.
- "veto" true only for a clear violation: it breaks the diet, it contains a food the player avoids,
  or it exceeds the calorie or sodium limit by more than 25 percent. A near miss gets a warning, not a veto.
- "reason" is one in-character line of at most 18 words that cites a number.
Return exactly one verdict per dish, using the dish_id you were given."""

VETO_MARGIN = 1.25
MAX_SCORE = 100
OVER_LIMIT_PENALTY = 25
LOW_PROTEIN_PENALTY = 15
DIET_PENALTY = 60


def _dish_lines(dishes: Sequence[Dish]) -> str:
    return "\n".join(
        f"- dish_id={dish.id} | {dish.name} | {dish.calories} cal, {dish.protein_g} g protein, "
        f"{dish.sodium_mg} mg sodium | ingredients: {', '.join(i.name for i in dish.ingredients)}"
        for dish in dishes
    )


def _clamp_score(score: int) -> int:
    return max(0, min(MAX_SCORE, score))


class GeminiNutritionist:
    def __init__(self, llm: LLM) -> None:
        self._llm = llm

    async def review(self, dishes: Sequence[Dish], goals: Goals) -> tuple[Verdict, ...]:
        prompt = (
            f"Player goals: diet {goals.diet}; per serving at most {goals.max_calories} calories, "
            f"at most {goals.max_sodium_mg} mg sodium, at least {goals.min_protein_g} g protein. "
            f"Foods the player avoids: {', '.join(goals.avoid) or 'none'}.\n\n"
            f"Dishes to review:\n{_dish_lines(dishes)}"
        )
        draft = await self._llm.generate(
            system=NUTRITIONIST_SYSTEM, prompt=prompt, schema=ReviewDraft, temperature=0.4
        )
        return tuple(
            Verdict(dish_id=v.dish_id, score=_clamp_score(v.score), veto=v.veto, reason=v.reason.strip())
            for v in draft.verdicts
        )


def _judge(dish: Dish, goals: Goals) -> Verdict:
    score = MAX_SCORE
    veto = False
    problems: list[str] = []

    # Dishes from the live Chef carry no diet tags, so the diet can only be judged when tags exist.
    if goals.diet in RULE_DIETS:
        breaks_diet = not fits_diet(dish, goals.diet)
    else:
        breaks_diet = goals.diet != "none" and bool(dish.diets) and goals.diet not in dish.diets
    if breaks_diet:
        score -= DIET_PENALTY
        veto = True
        problems.append(f"not {goals.diet}")
    unwanted = avoided_in(dish, goals.avoid)
    if unwanted:
        score -= DIET_PENALTY
        veto = True
        problems.append(f"contains {', '.join(unwanted)}, which you avoid")
    if dish.sodium_mg > goals.max_sodium_mg:
        score -= OVER_LIMIT_PENALTY
        veto = veto or dish.sodium_mg > goals.max_sodium_mg * VETO_MARGIN
        problems.append(f"{dish.sodium_mg} mg sodium against a {goals.max_sodium_mg} mg cap")
    if dish.calories > goals.max_calories:
        score -= OVER_LIMIT_PENALTY
        veto = veto or dish.calories > goals.max_calories * VETO_MARGIN
        problems.append(f"{dish.calories} calories against a {goals.max_calories} limit")
    if dish.protein_g < goals.min_protein_g:
        score -= LOW_PROTEIN_PENALTY
        problems.append(f"only {dish.protein_g} g protein")

    if veto:
        reason = f"Veto. {'; '.join(problems).capitalize()}."
    elif problems:
        reason = f"I will allow it, but note: {'; '.join(problems)}."
    else:
        reason = f"Approved. {dish.protein_g} g protein for {dish.calories} calories, {dish.sodium_mg} mg sodium."
    return Verdict(dish_id=dish.id, score=_clamp_score(score), veto=veto, reason=reason)


class OfflineNutritionist:
    """Rule-based Nutritionist that applies the numeric limits directly."""

    async def review(self, dishes: Sequence[Dish], goals: Goals) -> tuple[Verdict, ...]:
        return tuple(_judge(dish, goals) for dish in dishes)
