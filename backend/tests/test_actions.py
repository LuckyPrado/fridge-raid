from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.agents.chef import fits_diet
from app.agents.nutritionist import OfflineNutritionist
from app.chat import offline_draft
from app.schemas import Goals
from tests.conftest import make_dish

TODAY = "2026-10-10"


def _events(text: str) -> list[dict[str, Any]]:
    return [json.loads(line[len("data: "):]) for line in text.splitlines() if line.startswith("data: ")]


def _plan(client: TestClient, **goals: Any) -> dict[str, Any]:
    fridges = client.get("/api/demo-fridges").json()["data"]
    items = fridges[0]["items"]
    client.put("/api/inventory", json={"items": items})
    events = _events(client.post("/api/raid", json={"inventory": items, "goals": goals}).text)
    return next(event["plan"] for event in events if event["type"] == "plan")


def _say(client: TestClient, agent: str, message: str) -> dict[str, Any]:
    return client.post("/api/chat", params={"today": TODAY}, json={"agent": agent, "message": message}).json()["data"]


# --- kosher and halal, judged from ingredients ---


@pytest.mark.unit
@pytest.mark.parametrize(
    ("ingredients", "halal", "kosher"),
    [
        ({"chicken breast": 1, "rice": 1}, True, True),
        ({"bacon": 2, "egg": 2}, False, False),
        ({"shrimp": 6, "rice": 1}, True, False),
        ({"ground beef": 1, "cheddar": 1}, True, False),
        ({"chicken": 1, "coconut milk": 1}, True, True),
        ({"pasta": 1, "wine": 1}, False, True),
        ({"scallion": 2, "egg": 2, "butter": 1}, True, True),
    ],
)
def test_kosher_and_halal_follow_ingredient_rules(ingredients: dict[str, float], halal: bool, kosher: bool) -> None:
    dish = make_dish("Test Dish", ingredients)

    assert (fits_diet(dish, "halal"), fits_diet(dish, "kosher")) == (halal, kosher)
    assert fits_diet(dish, "none") is True


@pytest.mark.unit
async def test_nutritionist_vetoes_pork_for_a_halal_player() -> None:
    dish = make_dish("Bacon Eggs", {"bacon": 2, "egg": 2}).model_copy(update={"id": "d1"})

    (verdict,) = await OfflineNutritionist().review([dish], Goals(diet="halal"))

    assert verdict.veto and "not halal" in verdict.reason.lower()


@pytest.mark.integration
@pytest.mark.parametrize("diet", ["halal", "kosher"])
def test_a_plan_for_a_rule_diet_has_meals_and_no_pork(client: TestClient, diet: str) -> None:
    plan = _plan(client, diet=diet)
    ingredients = {ingredient["name"] for dish in plan["dishes"] for ingredient in dish["ingredients"]}

    assert plan["dishes"], "the recipe book must still offer dinners"
    assert not ingredients & {"bacon", "sausage"}


# --- things the agents can do when asked ---


@pytest.mark.unit
@pytest.mark.parametrize(
    ("message", "field", "expected"),
    [
        ("Give me a different recipe", "swap_recipe", True),
        ("I don't like that, something else please", "swap_recipe", True),
        ("I drank two glasses of water", "add_water", 2),
        ("log a glass", "add_water", 1),
        ("Take lemon off my grocery list", "remove_from_grocery", ["lemon"]),
        ("What should I cook tonight?", "swap_recipe", False),
    ],
)
def test_offline_reader_spots_requests_for_action(message: str, field: str, expected: Any) -> None:
    assert getattr(offline_draft(message), field) == expected


@pytest.mark.integration
def test_the_chef_swaps_the_next_dinner_and_the_cart_follows(client: TestClient) -> None:
    before = _plan(client)
    first = before["dishes"][0]["name"]

    answer = _say(client, "chef", "Give me a different recipe")
    after = client.get("/api/plan").json()["data"]["plan"]
    names = [dish["name"] for dish in after["dishes"]]

    assert answer["changes"] == [f"New recipe: {names[0]}"]
    assert first in answer["reply"] and names[0] in answer["reply"]
    assert first not in names and len(names) == len(before["dishes"])
    assert len({dish["id"] for dish in after["dishes"]}) == len(names)
    assert after["total_cost"] == round(sum(line["cost"] for line in after["cart"]), 2)
    assert after["store"] == before["store"]


@pytest.mark.integration
def test_swapping_with_no_plan_says_so(client: TestClient) -> None:
    answer = _say(client, "chef", "another recipe please")

    assert answer["changes"] == [] and "no planned dinner" in answer["reply"]


@pytest.mark.integration
def test_the_nutritionist_logs_water_and_the_shopper_edits_the_list(client: TestClient) -> None:
    water = _say(client, "nutritionist", "I drank two glasses of water")
    more = _say(client, "nutritionist", "drank water")
    _say(client, "bargain_hunter", "add lemon and oats to my list")
    removed = _say(client, "bargain_hunter", "remove lemon from my list")

    assert water["changes"] == ["Water: 2 glasses today"]
    assert more["changes"] == ["Water: 3 glasses today"]
    assert client.get(f"/api/day/{TODAY}").json()["data"]["water"] == 3
    assert removed["changes"] == ["Off your list: lemon"]
    assert [item["name"] for item in client.get("/api/grocery").json()["data"]["items"]] == ["oats"]
