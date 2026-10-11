"""The raid: Chef proposes, Nutritionist critiques, Chef revises, Bargain Hunter settles the plan.

Yields plain event dicts so the API layer can stream them to the browser as they happen.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Mapping, Sequence, TypeVar

from app.agents.base import Party, RaidContext, Rejection
from app.catalog import Catalog
from app.deals import Store, best_store_plan, comparison_line, quote_stores
from app.llm import LLMError
from app.optimizer import AtRisk, at_risk_items, build_cart, cart_total, rescued, stock_of, waste_value_total
from app.schemas import Dish, RaidRequest, Verdict

logger = logging.getLogger(__name__)

MAX_ROUNDS = 3
EXTRA_CANDIDATES = 2
DEFAULT_SCORE = 70

Event = dict[str, Any]
T = TypeVar("T")


def _event(kind: str, **fields: Any) -> Event:
    return {"type": kind, **fields}


@dataclass
class _RaidState:
    """Scratchpad for one raid. Private to this module."""

    approved: list[Dish] = field(default_factory=list)
    taken_names: list[str] = field(default_factory=list)
    dish_count: int = 0
    notes: list[str] = field(default_factory=list)

    def drain_notes(self) -> list[Event]:
        events = [_event("system", text=note) for note in self.notes]
        self.notes = []
        return events

    def number(self, dishes: tuple[Dish, ...]) -> tuple[Dish, ...]:
        numbered = tuple(
            dish.model_copy(update={"id": f"d{self.dish_count + offset}"})
            for offset, dish in enumerate(dishes, start=1)
        )
        self.dish_count += len(numbered)
        self.taken_names = [*self.taken_names, *(dish.name for dish in numbered)]
        return numbered


async def _attempt(
    primary: Callable[[], Awaitable[T]], backup: Callable[[], Awaitable[T]], label: str, state: _RaidState
) -> T:
    """Run the live agent, and fall back to the rule-based one if the model call fails."""
    try:
        return await primary()
    except LLMError:
        logger.warning("%s failed on the live model; using the offline agent for this step.", label)
        state.notes = [*state.notes, f"{label} lost the signal. Backup tactics engaged for this move."]
        return await backup()


def _verdict_for(dish: Dish, verdicts: Mapping[str, Verdict]) -> Verdict:
    return verdicts.get(dish.id) or Verdict(dish_id=dish.id, score=DEFAULT_SCORE, veto=False, reason="No objection.")


async def _negotiate(
    ctx: RaidContext, party: Party, backup: Party, stock: Mapping[str, float], state: _RaidState
) -> AsyncIterator[Event]:
    count = ctx.goals.meals + EXTRA_CANDIDATES
    pending = await _attempt(
        lambda: party.chef.propose(ctx, count), lambda: backup.chef.propose(ctx, count), "Chef", state
    )
    for round_no in range(1, MAX_ROUNDS + 1):
        for note in state.drain_notes():
            yield note
        if not pending:
            return
        dishes = state.number(pending)
        for dish in dishes:
            yield _event("proposal", agent="chef", round=round_no, dish=dish.model_dump(), text=dish.pitch)

        verdicts = await _attempt(
            lambda: party.nutritionist.review(dishes, ctx.goals),
            lambda: backup.nutritionist.review(dishes, ctx.goals),
            "Nutritionist",
            state,
        )
        by_id = {verdict.dish_id: verdict for verdict in verdicts}
        rejections: list[Rejection] = []
        for dish in dishes:
            verdict = _verdict_for(dish, by_id)
            yield _event(
                "verdict", agent="nutritionist", dish_id=dish.id, dish_name=dish.name,
                score=verdict.score, veto=verdict.veto, text=verdict.reason,
            )
            if verdict.veto:
                rejections.append(Rejection(dish=dish, reason=verdict.reason))
                continue
            state.approved = [*state.approved, dish]
            cost = cart_total(build_cart([dish], stock, ctx.catalog))
            if cost > 0:
                yield _event(
                    "cost", agent="bargain_hunter", dish_id=dish.id, dish_name=dish.name, cost=cost,
                    text=f"{dish.name} adds ${cost:.2f} to the cart.",
                )

        if not rejections or round_no == MAX_ROUNDS:
            return
        taken = tuple(state.taken_names)
        pending = await _attempt(
            lambda: party.chef.revise(ctx, rejections, taken),
            lambda: backup.chef.revise(ctx, rejections, taken),
            "Chef",
            state,
        )


async def _settle(
    ctx: RaidContext,
    party: Party,
    backup: Party,
    stock: Mapping[str, float],
    risky: Mapping[str, AtRisk],
    state: _RaidState,
    stores: Sequence[Store],
) -> AsyncIterator[Event]:
    quotes = quote_stores(state.approved, ctx.inventory, ctx.catalog, stores, ctx.goals.budget, ctx.goals.meals)
    if quotes:
        plan, shop = quotes[0].plan, quotes[0].shop
    else:
        plan, shop = best_store_plan(state.approved, ctx.inventory, ctx.catalog, (), ctx.goals.budget, ctx.goals.meals)
    if quotes and plan.dishes:
        yield _event(
            "stores", agent="bargain_hunter", text=comparison_line(quotes),
            quotes=[
                {
                    "name": quote.store.info.name, "distance_mi": quote.store.info.distance_mi,
                    "total": quote.plan.total_cost, "meals": len(quote.plan.dishes), "chosen": index == 0,
                }
                for index, quote in enumerate(quotes)
            ],
        )
    boss_max = waste_value_total(risky)
    previous_saved = 0.0
    for index, dish in enumerate(plan.dishes, start=1):
        so_far = plan.dishes[:index]
        saved, _ = rescued(so_far, risky)
        yield _event(
            "strike", dish_id=dish.id, dish_name=dish.name,
            damage=round(saved - previous_saved, 2), hp=round(max(0.0, boss_max - saved), 2),
            spent=cart_total(build_cart(so_far, stock, shop)),
        )
        previous_saved = saved

    summary = await _attempt(
        lambda: party.bargain_hunter.narrate(plan, ctx.goals),
        lambda: backup.bargain_hunter.narrate(plan, ctx.goals),
        "Bargain Hunter",
        state,
    )
    for note in state.drain_notes():
        yield note
    yield _event("summary", agent="bargain_hunter", text=summary)
    yield _event("plan", plan=plan.model_dump())


async def run_raid(
    request: RaidRequest, party: Party, backup: Party, catalog: Catalog, stores: Sequence[Store] = ()
) -> AsyncIterator[Event]:
    inventory = tuple(request.inventory)
    by_id = {item.id: item for item in inventory}
    ctx = RaidContext(
        inventory=inventory,
        arena_names=tuple(by_id[item_id].name for item_id in request.arena if item_id in by_id),
        goals=request.goals,
        catalog=catalog,
    )
    risky = at_risk_items(inventory, catalog)
    stock = stock_of(inventory)
    state = _RaidState()
    boss_max = waste_value_total(risky)

    yield _event(
        "boss", max_hp=boss_max, hp=boss_max, party=party.name,
        at_risk=sorted(entry.name for entry in risky.values()),
    )
    async for event in _negotiate(ctx, party, backup, stock, state):
        yield event
    async for event in _settle(ctx, party, backup, stock, risky, state, stores):
        yield event
    yield _event("done")
