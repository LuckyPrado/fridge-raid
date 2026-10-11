from __future__ import annotations

from typing import Any

import pytest

from app.agents.base import Party, RaidContext, Rejection, dish_from_draft, reconcile_units
from app.agents.bargain_hunter import GeminiBargainHunter, OfflineBargainHunter
from app.agents.chef import GeminiChef, OfflineChef
from app.agents.nutritionist import GeminiNutritionist, OfflineNutritionist
from app.catalog import Catalog
from app.llm import LLMError, parse_structured
from app.negotiation import MAX_ROUNDS, run_raid
from app.schemas import (
    ChefDraft,
    Dish,
    DishDraft,
    Goals,
    IngredientDraft,
    Quip,
    RaidRequest,
    ReviewDraft,
    ScoutDraft,
    ScoutDraftItem,
    Verdict,
    VerdictDraft,
    WeekPlan,
)
from app.scout import items_from_draft, scout_fridge
from tests.conftest import make_dish, make_item

pytestmark = pytest.mark.unit


class StubLLM:
    """Returns canned drafts by schema, or raises to simulate an outage."""

    def __init__(self, replies: dict[type, Any] | None = None, fail: bool = False) -> None:
        self._replies = replies or {}
        self._fail = fail
        self.calls: list[type] = []

    async def generate(self, *, system: str, prompt: str, schema: type, image: Any = None, temperature: float = 0.8) -> Any:
        self.calls.append(schema)
        if self._fail:
            raise LLMError("stub outage")
        return self._replies[schema]


def _draft(name: str, **overrides: Any) -> DishDraft:
    fields = {
        "name": name, "pitch": "Bold!", "description": "A dish.",
        "ingredients": [IngredientDraft(name="spinach", quantity=2, unit="unit")],
        "calories": 400, "protein_g": 20, "sodium_mg": 300, "minutes": 15,
        "steps": ["Wilt the spinach.", "  ", "Serve."],
    }
    return DishDraft(**{**fields, **overrides})


def _ctx(catalog: Catalog, **goal_overrides: Any) -> RaidContext:
    inventory = (make_item("spinach", 4, 1), make_item("egg", 6, 10))
    return RaidContext(inventory=inventory, arena_names=("spinach",), goals=Goals(**goal_overrides), catalog=catalog)


# --- model output parsing ---


def test_parse_structured_rejects_empty_output() -> None:
    with pytest.raises(LLMError):
        parse_structured("  ", ScoutDraft)


def test_parse_structured_rejects_output_that_breaks_the_schema() -> None:
    with pytest.raises(LLMError):
        parse_structured('{"items": [{"name": "egg"}]}', ScoutDraft)


def test_parse_structured_accepts_valid_output() -> None:
    parsed = parse_structured('{"text": "deal"}', Quip)

    assert parsed.text == "deal"


def test_scout_drops_unusable_items_and_repairs_the_rest(catalog: Catalog) -> None:
    draft = ScoutDraft(
        items=[
            ScoutDraftItem(name="Eggs", category="DAIRY", quantity=6, unit="", days_left=9),
            ScoutDraftItem(name="mystery jar", category="weird", quantity=1, unit="jar", days_left=99999),
            ScoutDraftItem(name="", category="produce", quantity=1, unit="unit", days_left=3),
            ScoutDraftItem(name="ghost", category="produce", quantity=0, unit="unit", days_left=3),
        ]
    )

    items = items_from_draft(draft, catalog)

    assert [item.name for item in items] == ["egg", "mystery jar"]
    assert items[0].category == "dairy" and items[0].unit == "unit"
    assert items[1].category == "other" and items[1].days_left == 3650


async def test_scout_raises_when_every_reported_item_is_unusable(catalog: Catalog) -> None:
    draft = ScoutDraft(items=[ScoutDraftItem(name="", category="x", quantity=1, unit="u", days_left=1)])
    llm = StubLLM({ScoutDraft: draft})

    with pytest.raises(LLMError):
        await scout_fridge(llm, b"img", "image/png", catalog)


async def test_scout_returns_empty_list_for_a_photo_with_no_food(catalog: Catalog) -> None:
    llm = StubLLM({ScoutDraft: ScoutDraft(items=[])})

    assert await scout_fridge(llm, b"img", "image/png", catalog) == []


def test_dish_from_draft_clamps_wild_numbers_and_rejects_empty_dishes() -> None:
    wild = dish_from_draft(_draft("Wild", calories=999999, sodium_mg=-5))
    empty = dish_from_draft(_draft("Empty", ingredients=[]))

    assert wild is not None and wild.calories == 5000 and wild.sodium_mg == 0
    assert empty is None


# --- gemini-backed agents against a stub model ---


async def test_gemini_chef_returns_validated_dishes(catalog: Catalog) -> None:
    llm = StubLLM({ChefDraft: ChefDraft(dishes=[_draft("A"), _draft("B"), _draft("C")])})

    dishes = await GeminiChef(llm).propose(_ctx(catalog), count=2)

    assert [dish.name for dish in dishes] == ["A", "B"]


async def test_gemini_chef_raises_when_no_dish_is_usable(catalog: Catalog) -> None:
    llm = StubLLM({ChefDraft: ChefDraft(dishes=[_draft("Empty", ingredients=[])])})

    with pytest.raises(LLMError):
        await GeminiChef(llm).propose(_ctx(catalog), count=2)


async def test_gemini_chef_revise_asks_for_one_replacement_per_rejection(catalog: Catalog) -> None:
    llm = StubLLM({ChefDraft: ChefDraft(dishes=[_draft("Fix 1"), _draft("Fix 2")])})
    rejection = Rejection(dish=make_dish("Bad", {"egg": 1}), reason="too salty")

    dishes = await GeminiChef(llm).revise(_ctx(catalog), [rejection], taken_names=["Bad"])

    assert [dish.name for dish in dishes] == ["Fix 1"]


async def test_gemini_nutritionist_clamps_scores() -> None:
    llm = StubLLM({ReviewDraft: ReviewDraft(verdicts=[VerdictDraft(dish_id="d1", score=250, veto=False, reason=" ok ")])})
    dish = make_dish("A", {"egg": 1}).model_copy(update={"id": "d1"})

    verdicts = await GeminiNutritionist(llm).review([dish], Goals())

    assert verdicts == (Verdict(dish_id="d1", score=100, veto=False, reason="ok"),)


async def test_gemini_bargain_hunter_returns_trimmed_text(catalog: Catalog) -> None:
    llm = StubLLM({Quip: Quip(text="  What a deal.  ")})
    plan = WeekPlan(dishes=(), cart=(), total_cost=0, budget=25, rescued=(), waste_value_total=0, waste_value_saved=0)

    assert await GeminiBargainHunter(llm).narrate(plan, Goals()) == "What a deal."


# --- offline agents ---


def _recipes() -> tuple[Dish, ...]:
    return (
        make_dish("Spinach Scramble", {"spinach": 2, "egg": 3}).model_copy(update={"diets": ("vegetarian",)}),
        make_dish("Salt Bomb", {"egg": 2}, sodium_mg=3000),
        make_dish("Salmon Plate", {"salmon": 1}),
        make_dish("Plain Eggs", {"egg": 2}).model_copy(update={"diets": ("vegetarian",)}),
    )


async def test_offline_chef_ranks_expiring_and_arena_food_first(catalog: Catalog) -> None:
    dishes = await OfflineChef(_recipes()).propose(_ctx(catalog), count=2)

    assert dishes[0].name == "Spinach Scramble"


async def test_offline_chef_respects_the_diet(catalog: Catalog) -> None:
    dishes = await OfflineChef(_recipes()).propose(_ctx(catalog, diet="vegetarian"), count=4)

    assert {dish.name for dish in dishes} == {"Spinach Scramble", "Plain Eggs"}


async def test_offline_chef_revision_avoids_taken_dishes_and_limit_breakers(catalog: Catalog) -> None:
    rejection = Rejection(dish=make_dish("Salt Bomb", {"egg": 2}, sodium_mg=3000), reason="too salty")

    dishes = await OfflineChef(_recipes()).revise(
        _ctx(catalog), [rejection], taken_names=["Spinach Scramble", "Salt Bomb"]
    )

    assert len(dishes) == 1
    assert dishes[0].name in {"Plain Eggs", "Salmon Plate"}
    assert "Salt Bomb" in dishes[0].pitch


async def test_offline_nutritionist_vetoes_clear_violations_only() -> None:
    goals = Goals(max_sodium_mg=900, max_calories=800, min_protein_g=15)
    fine = make_dish("Fine", {"egg": 1}).model_copy(update={"id": "d1"})
    near_miss = make_dish("Near", {"egg": 1}, sodium_mg=1000).model_copy(update={"id": "d2"})
    salty = make_dish("Salty", {"egg": 1}, sodium_mg=2000).model_copy(update={"id": "d3"})
    heavy = make_dish("Heavy", {"egg": 1}, calories=1200, protein_g=5).model_copy(update={"id": "d4"})

    verdicts = await OfflineNutritionist().review([fine, near_miss, salty, heavy], goals)

    assert [v.veto for v in verdicts] == [False, False, True, True]
    assert verdicts[0].score == 100
    assert "1000 mg sodium" in verdicts[1].reason
    assert verdicts[3].score < verdicts[2].score


async def test_offline_nutritionist_does_not_veto_untagged_dishes_on_diet() -> None:
    """Live Chef dishes have no diet tags; a backup review must not reject them all."""
    untagged = make_dish("Lentil Soup", {"lentil": 1}).model_copy(update={"id": "d1"})

    (verdict,) = await OfflineNutritionist().review([untagged], Goals(diet="vegan"))

    assert not verdict.veto


def test_reconcile_units_fixes_mismatched_units_and_caps_the_amount(catalog: Catalog) -> None:
    dish = Dish(
        name="Odd Units",
        ingredients=(
            {"name": "spinach", "quantity": 200, "unit": "g"},
            {"name": "egg", "quantity": 3, "unit": "unit"},
            {"name": "dragonfruit", "quantity": 2, "unit": "slice"},
        ),
        calories=300, protein_g=10, sodium_mg=100,
    )

    fixed = reconcile_units(dish, catalog)

    assert [(i.name, i.quantity, i.unit) for i in fixed.ingredients] == [
        ("spinach", 12, "unit"),  # capped at 3 packs of 4
        ("egg", 3, "unit"),
        ("dragonfruit", 2, "slice"),
    ]


async def test_gemini_chef_reconciles_units_before_returning(catalog: Catalog) -> None:
    odd = _draft("Odd", ingredients=[IngredientDraft(name="spinach", quantity=500, unit="g")])
    llm = StubLLM({ChefDraft: ChefDraft(dishes=[odd])})

    (dish,) = await GeminiChef(llm).propose(_ctx(catalog), count=1)

    assert dish.ingredients[0].unit == "unit" and dish.ingredients[0].quantity == 12


async def test_offline_nutritionist_vetoes_diet_violations() -> None:
    dish = make_dish("Steak", {"beef": 1}).model_copy(update={"id": "d1", "diets": ("pescatarian",)})

    (verdict,) = await OfflineNutritionist().review([dish], Goals(diet="vegan"))

    assert verdict.veto and "not vegan" in verdict.reason.lower()



@pytest.mark.parametrize(
    ("dishes", "cost", "expected"),
    [(0, 0.0, "Nothing fits"), (2, 0.0, "Zero dollars spent"), (2, 4.0, "Cart locked at $4.00")],
)
async def test_offline_bargain_hunter_describes_each_outcome(dishes: int, cost: float, expected: str) -> None:
    from app.schemas import CartLine

    plan = WeekPlan(
        dishes=tuple(make_dish(f"D{i}", {"egg": 1}) for i in range(dishes)),
        cart=(CartLine(name="rice", packs=2, pack_size=10, unit="unit", cost=cost),) if cost else (),
        total_cost=cost, budget=25, rescued=(), waste_value_total=5, waste_value_saved=3,
    )

    assert expected in await OfflineBargainHunter().narrate(plan, Goals())


# --- negotiation loop ---


def _offline_party() -> Party:
    return Party("offline", OfflineChef(_recipes()), OfflineNutritionist(), OfflineBargainHunter())


def _request(**goal_overrides: Any) -> RaidRequest:
    return RaidRequest(
        inventory=[make_item("spinach", 4, 1), make_item("egg", 6, 10)],
        arena=["spinach", "not-a-real-id"],
        goals=Goals(**goal_overrides),
    )


async def _collect(request: RaidRequest, party: Party, backup: Party, catalog: Catalog) -> list[dict[str, Any]]:
    return [event async for event in run_raid(request, party, backup, catalog)]


async def test_raid_streams_boss_then_debate_then_plan(catalog: Catalog) -> None:
    party = _offline_party()

    events = await _collect(_request(meals=2), party, party, catalog)
    kinds = [event["type"] for event in events]

    assert kinds[0] == "boss" and kinds[-2:] == ["plan", "done"]
    assert events[0]["max_hp"] == 2.00 and events[0]["at_risk"] == ["spinach"]
    assert "proposal" in kinds and "verdict" in kinds and "summary" in kinds
    assert any(event["type"] == "verdict" and event["veto"] for event in events)
    strikes = [event for event in events if event["type"] == "strike"]
    assert strikes and strikes[-1]["hp"] < events[0]["max_hp"]


async def test_raid_gives_every_dish_a_unique_id(catalog: Catalog) -> None:
    party = _offline_party()

    events = await _collect(_request(meals=2), party, party, catalog)
    ids = [event["dish"]["id"] for event in events if event["type"] == "proposal"]

    assert len(ids) == len(set(ids)) and all(ids)


async def test_raid_stops_revising_after_the_round_limit(catalog: Catalog) -> None:
    class StubbornChef:
        def __init__(self) -> None:
            self.revisions = 0

        async def propose(self, ctx: RaidContext, count: int) -> tuple[Dish, ...]:
            return (make_dish("Salt Bomb 0", {"egg": 1}, sodium_mg=5000),)

        async def revise(self, ctx: RaidContext, rejections: Any, taken_names: Any) -> tuple[Dish, ...]:
            self.revisions += 1
            return (make_dish(f"Salt Bomb {self.revisions}", {"egg": 1}, sodium_mg=5000),)

    chef = StubbornChef()
    party = Party("stub", chef, OfflineNutritionist(), OfflineBargainHunter())

    events = await _collect(_request(), party, _offline_party(), catalog)
    plan = next(event["plan"] for event in events if event["type"] == "plan")

    assert chef.revisions == MAX_ROUNDS - 1
    assert len(plan["dishes"]) == 0
    assert events[-1]["type"] == "done"


async def test_raid_falls_back_to_offline_agents_when_the_model_fails(catalog: Catalog) -> None:
    llm = StubLLM(fail=True)
    live = Party("gemini", GeminiChef(llm), GeminiNutritionist(llm), GeminiBargainHunter(llm))

    events = await _collect(_request(meals=2), live, _offline_party(), catalog)
    notes = [event["text"] for event in events if event["type"] == "system"]
    plan = next(event["plan"] for event in events if event["type"] == "plan")

    assert any("Chef" in note for note in notes)
    assert plan["dishes"], "offline backup should still produce a plan"


async def test_raid_defaults_to_approval_when_a_verdict_is_missing(catalog: Catalog) -> None:
    class SilentNutritionist:
        async def review(self, dishes: Any, goals: Goals) -> tuple[Verdict, ...]:
            return ()

    party = Party("stub", OfflineChef(_recipes()), SilentNutritionist(), OfflineBargainHunter())

    events = await _collect(_request(meals=1), party, _offline_party(), catalog)
    verdicts = [event for event in events if event["type"] == "verdict"]

    assert verdicts and all(not event["veto"] for event in verdicts)
