from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import tracker
from app.agents.base import dish_from_draft
from app.agents.chef import matches_favorite
from app.catalog import Catalog
from app.deals import Store, best_store_plan, load_stores, store_catalog, store_deals
from app.repository import sqlite_repository
from app.schemas import DishDraft, Goals, IngredientDraft, LogRequest, Profile, StoreInfo
from tests.conftest import make_dish, make_item

TODAY = "2026-10-10"


def _store(store_id: str, distance: float, **sale_prices: float) -> Store:
    info = StoreInfo(id=store_id, name=store_id.title(), distance_mi=distance, walk_min=int(distance * 20))
    return Store(info=info, sale_prices=sale_prices)


def _events(response_text: str) -> list[dict[str, Any]]:
    return [json.loads(line[len("data: "):]) for line in response_text.splitlines() if line.startswith("data: ")]


def _plan_a_dorm_week(client: TestClient) -> dict[str, Any]:
    fridges = client.get("/api/demo-fridges").json()["data"]
    items = next(fridge["items"] for fridge in fridges if fridge["id"] == "dorm")
    client.put("/api/inventory", json={"items": items})
    events = _events(client.post("/api/raid", json={"inventory": items}).text)
    return next(event["plan"] for event in events if event["type"] == "plan")


# --- store deals ---


@pytest.mark.unit
def test_store_catalog_applies_sale_prices_only_to_listed_items(catalog: Catalog) -> None:
    shop = store_catalog(_store("corner", 0.5, egg=1.50), catalog)

    assert shop.lookup("egg").pack_price == 1.50
    assert shop.lookup("spinach").pack_price == 2.00
    assert catalog.lookup("egg").pack_price == 3.00, "the regular catalog must not change"


@pytest.mark.unit
def test_load_stores_drops_unknown_items_and_prices_that_are_not_deals(tmp_path: Path, catalog: Catalog) -> None:
    path = tmp_path / "stores.json"
    path.write_text(
        json.dumps(
            [{"id": "s", "name": "S", "distance_mi": 1, "walk_min": 20,
              "deals": {"egg": 2.0, "dragonfruit": 1.0, "rice": 9.0, "cheese": 0}}]
        ),
        encoding="utf-8",
    )

    stores = load_stores(path, catalog)

    assert dict(stores[0].sale_prices) == {"egg": 2.0}
    assert [deal.name for deal in store_deals(stores[0], catalog).deals] == ["egg"]


@pytest.mark.unit
def test_load_stores_fails_loudly_on_a_missing_file(tmp_path: Path, catalog: Catalog) -> None:
    with pytest.raises(RuntimeError):
        load_stores(tmp_path / "nope.json", catalog)


@pytest.mark.unit
def test_best_store_plan_picks_the_cheapest_store_and_reports_the_regular_price(catalog: Catalog) -> None:
    dish = make_dish("Cheese Omelette", {"cheese": 1, "egg": 2})
    stores = [_store("pricey", 0.2), _store("deal", 1.5, cheese=2.50)]

    plan, shop = best_store_plan([dish], [], catalog, stores, budget=20.0, max_meals=1)

    assert plan.store is not None and plan.store.id == "deal"
    assert plan.total_cost == 5.50
    cheese = next(line for line in plan.cart if line.name == "cheese")
    assert (cheese.cost, cheese.list_cost) == (2.50, 4.00)
    assert shop.lookup("cheese").pack_price == 2.50


@pytest.mark.unit
def test_best_store_plan_prefers_the_nearest_store_on_a_tie(catalog: Catalog) -> None:
    dish = make_dish("Rice Bowl", {"rice": 2})
    stores = [_store("far", 2.0), _store("near", 0.3)]

    plan, _ = best_store_plan([dish], [], catalog, stores, budget=20.0, max_meals=1)

    assert plan.store.id == "near"


@pytest.mark.unit
def test_best_store_plan_works_without_any_stores(catalog: Catalog) -> None:
    plan, shop = best_store_plan([make_dish("Rice Bowl", {"rice": 2})], [], catalog, [], budget=20.0, max_meals=1)

    assert plan.store is None and shop is catalog


@pytest.mark.unit
def test_a_deal_can_bring_a_dish_inside_the_budget(catalog: Catalog) -> None:
    dish = make_dish("Salmon Plate", {"salmon": 1})
    stores = [_store("regular", 0.2), _store("fish-sale", 1.0, salmon=6.00)]

    plan, _ = best_store_plan([dish], [], catalog, stores, budget=7.0, max_meals=1)

    assert [d.name for d in plan.dishes] == ["Salmon Plate"]
    assert plan.store.id == "fish-sale"


# --- chef favorites and steps ---


@pytest.mark.unit
@pytest.mark.parametrize(
    ("favorites", "expected"),
    [(("eggs",), True), (("Scramble",), True), (("spinach scramble",), True), (("sushi",), False), ((), False)],
)
def test_matches_favorite_checks_the_name_and_ingredients(favorites: tuple[str, ...], expected: bool) -> None:
    dish = make_dish("Spinach Scramble", {"egg": 2, "spinach": 1})

    assert matches_favorite(dish, favorites) is expected


@pytest.mark.unit
def test_dish_from_draft_keeps_clean_steps_and_caps_their_number() -> None:
    draft = DishDraft(
        name="Toast", pitch="", description="", calories=200, protein_g=5, sodium_mg=100, minutes=5,
        ingredients=[IngredientDraft(name="bread", quantity=2, unit="slice")],
        steps=["  Toast the bread. ", "", *[f"Step {n}" for n in range(20)]],
    )

    dish = dish_from_draft(draft)

    assert dish.steps[0] == "Toast the bread."
    assert len(dish.steps) == 8


# --- the nutritionist's coaching line ---


@pytest.mark.unit
@pytest.mark.parametrize(
    ("calories", "protein", "with_dish", "expected"),
    [
        (2000, 50, True, "200 kcal past"),
        (1000, 100, True, "Protein goal met at 100 g"),
        (1000, 60, False, "40 g of protein to go. Scan"),
        (1000, 80, True, "closes today's goal"),
        (1000, 40, True, "60 g of protein to go. Egg Bowl adds 25 g and leaves 35 g."),
    ],
)
def test_coach_message_cites_the_players_numbers(calories: int, protein: int, with_dish: bool, expected: str) -> None:
    dish = make_dish("Egg Bowl", {"egg": 2}, protein_g=25) if with_dish else None

    message = tracker.coach_message(Goals(daily_calories=1800, daily_protein_g=100), calories, protein, dish)

    assert expected in message


# --- the ledger ---


@pytest.mark.unit
def test_profile_and_plan_fall_back_to_defaults_when_storage_is_corrupt(tmp_path: Path) -> None:
    repo = sqlite_repository(tmp_path / "db.sqlite3")
    repo.put_doc(tracker.PROFILE_KEY, "{not json")
    repo.put_doc(tracker.PLAN_KEY, '{"plan": 7}')

    assert tracker.load_profile(repo) == Profile()
    assert tracker.load_plan(repo).plan is None


@pytest.mark.unit
def test_documents_are_upserted(tmp_path: Path) -> None:
    repo = sqlite_repository(tmp_path / "db.sqlite3")

    repo.put_doc("k", "one")
    repo.put_doc("k", "two")

    assert repo.get_doc("k") == "two"
    assert repo.get_doc("missing") is None


@pytest.mark.unit
def test_logging_food_totals_the_day_and_keeps_days_apart(tmp_path: Path) -> None:
    repo = sqlite_repository(tmp_path / "db.sqlite3")

    tracker.log_food(repo, TODAY, LogRequest(name="  Yogurt   bowl ", calories=380, protein_g=20))
    summary = tracker.log_food(repo, TODAY, LogRequest(name="Wrap", calories=540, protein_g=24, sodium_mg=700))
    other_day = tracker.day_summary(repo, "2026-10-09")

    assert (summary.calories, summary.protein_g, summary.sodium_mg) == (920, 44, 700)
    assert [entry.name for entry in summary.entries] == ["Yogurt bowl", "Wrap"]
    assert other_day.entries == () and other_day.calories == 0


@pytest.mark.unit
def test_water_is_stored_per_day(tmp_path: Path) -> None:
    repo = sqlite_repository(tmp_path / "db.sqlite3")

    assert tracker.set_water(repo, TODAY, 5).water == 5
    assert tracker.day_summary(repo, "2026-10-09").water == 0


@pytest.mark.unit
@pytest.mark.parametrize(
    ("days", "expected"),
    [
        ([], 0),
        ([TODAY], 1),
        (["2026-10-09", "2026-10-08"], 2),
        ([TODAY, "2026-10-09", "2026-10-07"], 2),
        (["2026-10-07"], 0),
    ],
)
def test_streak_counts_consecutive_days_and_forgives_an_unlogged_today(days: list[str], expected: int) -> None:
    assert tracker._streak(days, TODAY) == expected


@pytest.mark.unit
def test_cooking_an_unknown_or_repeated_dish_is_refused(tmp_path: Path, catalog: Catalog) -> None:
    repo = sqlite_repository(tmp_path / "db.sqlite3")
    dish = make_dish("Scramble", {"spinach": 2, "egg": 2}).model_copy(update={"id": "d1"})
    repo.replace_items([make_item("spinach", 4, 1), make_item("egg", 6, 10)])
    plan, _ = best_store_plan([dish], repo.list_items(), catalog, [], budget=10.0, max_meals=1)
    tracker.save_plan(repo, plan)

    with pytest.raises(tracker.UnknownDish):
        tracker.cook(repo, catalog, "d9", TODAY)
    outcome = tracker.cook(repo, catalog, "d1", TODAY)
    with pytest.raises(tracker.AlreadyCooked):
        tracker.cook(repo, catalog, "d1", TODAY)

    assert outcome.rescued == ("spinach",)
    assert outcome.xp == tracker.XP_PER_MEAL + tracker.XP_PER_RESCUE
    assert {item.name: item.quantity for item in outcome.items} == {"spinach": 2, "egg": 4}
    assert tracker.next_dish(outcome.saved) is None
    assert tracker.progress(repo, TODAY).model_dump() == {
        "xp": 40, "level": 1, "streak": 1, "meals_cooked": 1, "items_rescued": 1,
    }


# --- HTTP ---


@pytest.mark.integration
def test_profile_round_trips_with_favorites(client: TestClient) -> None:
    profile = {"name": "  Alex  ", "goals": {"diet": "vegetarian", "budget": 55, "favorites": ["pasta", "tacos"]}}

    saved = client.put("/api/profile", json=profile).json()["data"]
    loaded = client.get("/api/profile").json()["data"]

    assert saved["name"] == "Alex"
    assert loaded["goals"]["favorites"] == ["pasta", "tacos"]
    assert loaded["goals"]["daily_calories"] == 1800


@pytest.mark.integration
def test_profile_rejects_too_many_favorites(client: TestClient) -> None:
    response = client.put("/api/profile", json={"goals": {"favorites": [f"food {n}" for n in range(9)]}})

    assert response.status_code == 422
    assert response.json()["success"] is False


@pytest.mark.integration
def test_planning_saves_the_plan_with_a_store_and_steps(client: TestClient) -> None:
    assert client.get("/api/plan").json()["data"]["plan"] is None

    plan = _plan_a_dorm_week(client)
    saved = client.get("/api/plan").json()["data"]

    assert saved["plan"]["dishes"] == plan["dishes"]
    assert saved["cooked"] == []
    assert plan["store"]["name"]
    assert all(dish["steps"] for dish in plan["dishes"])
    assert all(line["list_cost"] >= line["cost"] for line in plan["cart"])


@pytest.mark.integration
def test_cooking_a_planned_dish_logs_it_and_updates_the_fridge(client: TestClient) -> None:
    plan = _plan_a_dorm_week(client)
    dish = plan["dishes"][0]
    before = client.get("/api/inventory").json()["data"]["items"]

    result = client.post("/api/cook", json={"dish_id": dish["id"], "day": TODAY}).json()["data"]
    day = client.get(f"/api/day/{TODAY}").json()["data"]
    progress = client.get("/api/progress", params={"today": TODAY}).json()["data"]
    again = client.post("/api/cook", json={"dish_id": dish["id"], "day": TODAY})

    assert result["saved"]["cooked"] == [dish["id"]]
    assert result["rescued"], "the first dorm dish is built on expiring food"
    assert sum(item["quantity"] for item in result["items"]) < sum(item["quantity"] for item in before)
    assert [(entry["name"], entry["kind"]) for entry in day["entries"]] == [(dish["name"], "meal")]
    assert day["calories"] == dish["calories"]
    assert progress["xp"] == result["xp"] and progress["streak"] == 1
    assert again.status_code == 409


@pytest.mark.integration
def test_cooking_a_dish_outside_the_plan_is_a_404(client: TestClient) -> None:
    response = client.post("/api/cook", json={"dish_id": "d1", "day": TODAY})

    assert response.status_code == 404
    assert response.json() == {"success": False, "data": None, "error": "That recipe is not in your current plan."}


@pytest.mark.integration
def test_day_log_and_water_endpoints(client: TestClient) -> None:
    logged = client.post(f"/api/day/{TODAY}/log", json={"name": "Hummus wrap", "calories": 540, "protein_g": 22})
    watered = client.put(f"/api/day/{TODAY}/water", json={"glasses": 4}).json()["data"]

    assert logged.status_code == 200
    assert (watered["calories"], watered["protein_g"], watered["water"]) == (540, 22, 4)
    assert "78 g of protein to go" in watered["coach"]


@pytest.mark.integration
@pytest.mark.parametrize("day", ["2026-13-45", "today", "20261010", "0001-01-01"])
def test_day_routes_reject_days_that_do_not_exist(client: TestClient, day: str) -> None:
    assert client.get(f"/api/day/{day}").status_code == 422
    assert client.get("/api/progress", params={"today": day}).status_code == 422
    assert client.post("/api/cook", json={"dish_id": "d1", "day": day}).status_code == 422


@pytest.mark.integration
def test_log_rejects_impossible_numbers(client: TestClient) -> None:
    response = client.post(f"/api/day/{TODAY}/log", json={"name": "Feast", "calories": 999999})

    assert response.status_code == 422
    assert client.put(f"/api/day/{TODAY}/water", json={"glasses": -1}).status_code == 422


@pytest.mark.integration
def test_stores_list_sample_deals_below_the_regular_price(client: TestClient) -> None:
    stores = client.get("/api/stores").json()["data"]

    assert len(stores) >= 2
    assert all(deal["price"] < deal["list_price"] for entry in stores for deal in entry["deals"])
    assert all(entry["deals"] for entry in stores)
