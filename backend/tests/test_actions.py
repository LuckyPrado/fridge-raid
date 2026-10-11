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
def test_the_chef_adds_a_favorite_and_keeps_every_planned_dinner(client: TestClient) -> None:
    before = _plan(client, favorites=["pasta"])
    old_names = [dish["name"] for dish in before["dishes"]]
    client.put("/api/profile", json={"goals": {"favorites": ["pasta"]}})

    answer = _say(client, "chef", "Give me a different recipe")
    after = client.get("/api/plan").json()["data"]["plan"]
    names = [dish["name"] for dish in after["dishes"]]

    assert names[: len(old_names)] == old_names, "nothing already planned may be removed"
    assert len(names) == len(old_names) + 1
    assert "Pasta" in names[-1] and "You love pasta" in answer["reply"]
    assert answer["changes"] == [f"New recipe: {names[-1]}"]
    assert len({dish["id"] for dish in after["dishes"]}) == len(names)
    assert after["total_cost"] == round(sum(line["cost"] for line in after["cart"]), 2)


@pytest.mark.integration
def test_asking_for_a_recipe_with_no_plan_says_so(client: TestClient) -> None:
    answer = _say(client, "chef", "another recipe please")

    assert answer["changes"] == [] and "no new dinner" in answer["reply"]


@pytest.mark.integration
def test_a_recipe_can_be_removed_and_the_cart_shrinks_with_it(client: TestClient) -> None:
    before = _plan(client)
    target = before["dishes"][-1]

    after = client.delete(f"/api/plan/dish/{target['id']}").json()["data"]
    missing = client.delete(f"/api/plan/dish/{target['id']}")

    names = [dish["name"] for dish in after["plan"]["dishes"]]
    assert target["name"] not in names and len(names) == len(before["dishes"]) - 1
    assert after["plan"]["total_cost"] <= before["total_cost"]
    assert client.get("/api/plan").json()["data"] == after
    assert missing.status_code == 404


@pytest.mark.integration
def test_removing_a_cooked_recipe_forgets_that_it_was_cooked(client: TestClient) -> None:
    plan = _plan(client)
    first = plan["dishes"][0]["id"]
    client.post("/api/cook", json={"dish_id": first, "day": TODAY})

    after = client.delete(f"/api/plan/dish/{first}").json()["data"]

    assert after["cooked"] == []


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
