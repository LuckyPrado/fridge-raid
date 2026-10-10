"""The Bargain Hunter: the optimizer decides the cart, this agent explains it in character."""

from __future__ import annotations

from app.llm import LLM
from app.schemas import Goals, Quip, WeekPlan

BARGAIN_SYSTEM = """You are the Bargain Hunter in a party of AI agents raiding a fridge.
You are thrifty, smug about a good deal, and you hate paying for food that is already in the fridge.
Summarize the final plan in at most 2 short sentences. Cite the total cost and the dollar value of
food saved from the bin. Do not invent numbers."""


def _plan_facts(plan: WeekPlan) -> str:
    cart = ", ".join(f"{line.packs} x {line.name} (${line.cost:.2f})" for line in plan.cart) or "nothing to buy"
    return (
        f"Meals planned: {len(plan.dishes)} ({', '.join(d.name for d in plan.dishes) or 'none'}).\n"
        f"Shopping list: {cart}.\n"
        f"Total cost: ${plan.total_cost:.2f} of a ${plan.budget:.2f} budget.\n"
        f"Expiring food saved: ${plan.waste_value_saved:.2f} of ${plan.waste_value_total:.2f} at risk.\n"
        f"Dishes left out: {', '.join(plan.benched) or 'none'}."
    )


class GeminiBargainHunter:
    def __init__(self, llm: LLM) -> None:
        self._llm = llm

    async def narrate(self, plan: WeekPlan, goals: Goals) -> str:
        quip = await self._llm.generate(system=BARGAIN_SYSTEM, prompt=_plan_facts(plan), schema=Quip)
        return quip.text.strip()


class OfflineBargainHunter:
    async def narrate(self, plan: WeekPlan, goals: Goals) -> str:
        if not plan.dishes:
            return f"Nothing fits a ${plan.budget:.2f} budget. Raise it a little and I will find a deal."
        meals = f"{len(plan.dishes)} meal{'s' if len(plan.dishes) != 1 else ''}"
        saved = f"${plan.waste_value_saved:.2f} of food saved from the bin"
        if not plan.cart:
            return f"Zero dollars spent. {meals.capitalize()} straight from the fridge, {saved}."
        return (
            f"Cart locked at ${plan.total_cost:.2f} of ${plan.budget:.2f}. "
            f"{len(plan.cart)} item{'s' if len(plan.cart) != 1 else ''} buys {meals}, with {saved}."
        )
