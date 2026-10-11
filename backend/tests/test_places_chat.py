from __future__ import annotations

from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app import api_day
from app.agents.chef import avoided_in
from app.agents.nutritionist import OfflineNutritionist
from app.chat import NO_CHANGE, apply_draft, converse, offline_draft
from app.config import Settings
from app.deals import Store, stores_from_places
from app.llm import LLMError
from app.main import create_app
from app.places import PlacesError, distance_miles, find_stores, overpass_query, stores_from_elements
from app.repository import sqlite_repository
from app.schemas import ChatDraft, Goals, Profile, StoreInfo
from tests.conftest import make_dish

HOME = (40.5008, -74.4474)


def _element(name: str, lat: float, lon: float, shop: str = "supermarket", **extra: Any) -> dict[str, Any]:
    return {"type": "node", "id": abs(hash(name)) % 10**8, "lat": lat, "lon": lon, "tags": {"name": name, "shop": shop}, **extra}


def _draft(**changes: Any) -> ChatDraft:
    fields: dict[str, Any] = {
        "reply": "Done.", "name": "", "diet": "", "budget": NO_CHANGE, "meals": NO_CHANGE,
        "daily_calories": NO_CHANGE, "daily_protein_g": NO_CHANGE, "max_calories": NO_CHANGE,
        "max_sodium_mg": NO_CHANGE, "add_favorites": [], "remove_favorites": [], "add_avoid": [], "remove_avoid": [],
    }
    return ChatDraft(**{**fields, **changes})


class _ChatLLM:
    def __init__(self, reply: ChatDraft | None) -> None:
        self._reply = reply

    async def generate(self, **_: Any) -> Any:
        if self._reply is None:
            raise LLMError("stub outage")
        return self._reply


# --- places ---


@pytest.mark.unit
def test_distance_between_two_known_points_is_about_right() -> None:
    new_brunswick_to_princeton = distance_miles(40.4862, -74.4518, 40.3573, -74.6672)

    assert 14 < new_brunswick_to_princeton < 15
    assert distance_miles(*HOME, *HOME) == 0


@pytest.mark.unit
def test_overpass_query_searches_grocery_shops_around_the_point() -> None:
    query = overpass_query(*HOME)

    assert "around:4000,40.50080,-74.44740" in query
    assert "supermarket" in query and "[out:json]" in query


@pytest.mark.unit
def test_stores_are_deduped_sorted_by_distance_and_prefer_supermarkets() -> None:
    elements = [
        _element("Far Foods", 40.53, -74.44),
        _element("Near Mart", 40.502, -74.447),
        _element("Near Mart", 40.56, -74.40),
        {"type": "way", "id": 7, "center": {"lat": 40.505, "lon": -74.45}, "tags": {"name": "  Way   Grocer ", "shop": "grocery"}},
        {"type": "node", "id": 8, "lat": 40.5, "lon": -74.44, "tags": {"shop": "supermarket"}},
        {"type": "node", "id": 9, "tags": {"name": "No Position", "shop": "supermarket"}},
        *[_element(f"Corner {n}", 40.5009, -74.4475, shop="convenience") for n in range(6)],
    ]

    stores = stores_from_elements(elements, *HOME)

    assert len(stores) == 5
    assert {"Near Mart", "Way Grocer", "Far Foods"} <= {store.name for store in stores}
    assert [store.distance_mi for store in stores] == sorted(store.distance_mi for store in stores)
    near = next(store for store in stores if store.name == "Near Mart")
    assert near.distance_mi == 0.1 and near.lat == 40.502
    assert all(store.id.startswith("osm-") for store in stores)


@pytest.mark.unit
async def test_find_stores_falls_back_to_the_second_map_server() -> None:
    calls: list[str] = []

    async def fetch(url: str, query: str) -> dict[str, Any]:
        calls.append(url)
        if len(calls) == 1:
            raise httpx.ConnectError("down")
        return {"elements": [_element("Near Mart", 40.502, -74.447)]}

    stores = await find_stores(*HOME, fetch=fetch)

    assert [store.name for store in stores] == ["Near Mart"]
    assert len(calls) == 2


@pytest.mark.unit
async def test_find_stores_fails_when_no_server_answers() -> None:
    async def fetch(url: str, query: str) -> dict[str, Any]:
        raise httpx.ReadTimeout("slow")

    with pytest.raises(PlacesError):
        await find_stores(*HOME, fetch=fetch)


@pytest.mark.unit
def test_real_stores_borrow_a_sample_deal_sheet_and_keep_it() -> None:
    samples = [
        Store(info=StoreInfo(id="a", name="A", distance_mi=1, walk_min=20), sale_prices={"egg": 2.0}),
        Store(info=StoreInfo(id="b", name="B", distance_mi=1, walk_min=20), sale_prices={"rice": 1.0}),
    ]
    place = StoreInfo(id="osm-node-1", name="Near Mart", distance_mi=0.2, walk_min=4, lat=40.5, lon=-74.4)

    first = stores_from_places([place], samples)
    second = stores_from_places([place], samples)

    assert first[0].info == place
    assert first[0].sale_prices == second[0].sale_prices
    assert stores_from_places([place], []) == ()


# --- foods to avoid ---


@pytest.mark.unit
def test_avoided_foods_are_found_in_a_dish() -> None:
    dish = make_dish("Mushroom Toast", {"mushrooms": 2, "bread": 2, "cream cheese": 1})

    assert avoided_in(dish, ("Mushroom",)) == ("mushrooms",)
    assert avoided_in(dish, ("cheese",)) == ("cream cheese",)
    assert avoided_in(dish, ("egg", "")) == ()


@pytest.mark.unit
async def test_nutritionist_vetoes_a_dish_with_an_avoided_food() -> None:
    dish = make_dish("Mushroom Toast", {"mushroom": 2, "bread": 2}).model_copy(update={"id": "d1"})

    (verdict,) = await OfflineNutritionist().review([dish], Goals(avoid=("mushroom",)))

    assert verdict.veto
    assert "which you avoid" in verdict.reason


# --- chat ---


@pytest.mark.unit
def test_apply_draft_changes_only_what_was_asked_and_clamps_it() -> None:
    profile = Profile(goals=Goals(favorites=("pasta", "mushroom")))

    updated, changes = apply_draft(
        profile, _draft(budget=9999, daily_protein_g=120, diet="Vegan", add_avoid=["Mushrooms!"], add_favorites=["tacos"], name=" Alex ")
    )

    assert updated.goals.budget == 500
    assert updated.goals.daily_protein_g == 120
    assert updated.goals.diet == "vegan"
    assert updated.goals.avoid == ("mushrooms",)
    assert updated.goals.favorites == ("pasta", "tacos"), "an avoided food is dropped from favorites"
    assert updated.goals.meals == profile.goals.meals
    assert updated.name == "Alex"
    assert len(changes) == 6


@pytest.mark.unit
def test_apply_draft_reports_nothing_when_nothing_changes() -> None:
    profile = Profile(goals=Goals(budget=40, diet="vegan"))

    updated, changes = apply_draft(profile, _draft(budget=40, diet="vegan", remove_avoid=["kale"], diet_unknown=1))

    assert updated == profile
    assert changes == []


@pytest.mark.unit
def test_apply_draft_ignores_an_unknown_diet_and_removes_foods() -> None:
    profile = Profile(goals=Goals(avoid=("kale", "tofu"), favorites=("rice",)))

    updated, _ = apply_draft(profile, _draft(diet="carnivore", remove_avoid=["Kale"], remove_favorites=["rice"]))

    assert updated.goals.diet == "none"
    assert updated.goals.avoid == ("tofu",)
    assert updated.goals.favorites == ()


@pytest.mark.unit
@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Make my budget $40", {"budget": 40}),
        ("I hate mushrooms and olives.", {"add_avoid": ["mushrooms", "olives"]}),
        ("I'm allergic to shrimp but I love tacos", {"add_avoid": ["shrimp"], "add_favorites": ["tacos"]}),
        ("I want 130 g of protein and 2200 calories", {"daily_protein_g": 130, "daily_calories": 2200}),
        ("I am vegetarian now, plan 3 dinners", {"diet": "vegetarian", "meals": 3}),
        ("I am not vegan anymore", {"diet": "none"}),
        ("hello there", {}),
    ],
)
def test_offline_reader_understands_common_requests(message: str, expected: dict[str, Any]) -> None:
    draft = offline_draft(message)

    blank = _draft(reply="").model_dump()
    assert draft.model_dump() == {**blank, **expected}


@pytest.mark.unit
async def test_converse_uses_the_model_reply_and_its_changes() -> None:
    llm = _ChatLLM(_draft(reply="  Forty   dollars it is. ", budget=40))

    reply, updated, changes = await converse(llm, "bargain_hunter", "budget 40", Profile())

    assert reply == "Forty dollars it is."
    assert updated.goals.budget == 40
    assert changes == ["Weekly budget $40.00"]


@pytest.mark.unit
async def test_converse_falls_back_to_rules_when_the_model_fails_or_is_missing() -> None:
    for llm in (_ChatLLM(None), None):
        reply, updated, changes = await converse(llm, "chef", "I hate mushrooms", Profile())

        assert updated.goals.avoid == ("mushrooms",)
        assert reply.startswith("Done.") and changes == ["Avoiding: mushrooms"]

    reply, _, changes = await converse(None, "chef", "hello", Profile())
    assert changes == [] and "did not catch" in reply


# --- HTTP ---


@pytest.mark.integration
def test_chat_saves_the_change_and_the_next_plan_respects_it(client: TestClient) -> None:
    answer = client.post("/api/chat", json={"agent": "chef", "message": "I hate bacon and I love tacos"}).json()["data"]
    profile = client.get("/api/profile").json()["data"]
    fridges = client.get("/api/demo-fridges").json()["data"]
    raid = client.post("/api/raid", json={"inventory": fridges[0]["items"], "goals": profile["goals"]}).text

    assert answer["changes"] == ["Avoiding: bacon", "Favorites: tacos"]
    assert profile["goals"]["avoid"] == ["bacon"]
    assert "Bacon" not in raid.split('"type": "plan"')[1]


@pytest.mark.integration
def test_chat_rejects_an_unknown_agent_and_an_empty_message(client: TestClient) -> None:
    assert client.post("/api/chat", json={"agent": "wizard", "message": "hi"}).status_code == 422
    assert client.post("/api/chat", json={"agent": "chef", "message": ""}).status_code == 422
    assert client.post("/api/chat", json={"agent": "chef", "message": "x" * 401}).status_code == 422


@pytest.mark.integration
def test_stores_start_as_samples_with_no_location(client: TestClient) -> None:
    board = client.get("/api/stores").json()["data"]

    assert board["origin"] is None
    assert len(board["stores"]) >= 2
    assert all(deal["price"] < deal["list_price"] for entry in board["stores"] for deal in entry["deals"])


@pytest.mark.integration
def test_sharing_a_location_switches_the_shopper_to_real_stores(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_find(lat: float, lon: float) -> tuple[StoreInfo, ...]:
        return stores_from_elements([_element("Near Mart", 40.502, -74.447), _element("Far Foods", 40.53, -74.44)], lat, lon)

    monkeypatch.setattr(api_day, "find_stores", fake_find)

    board = client.post("/api/nearby", json={"lat": 40.50081234, "lon": -74.44741234}).json()["data"]
    fridges = client.get("/api/demo-fridges").json()["data"]
    raid = client.post("/api/raid", json={"inventory": fridges[0]["items"]}).text
    cleared = client.delete("/api/nearby").json()["data"]

    assert board["origin"] == {"lat": 40.501, "lon": -74.447}, "the saved location is rounded"
    assert [entry["store"]["name"] for entry in board["stores"]] == ["Near Mart", "Far Foods"]
    assert all(entry["deals"] for entry in board["stores"])
    assert "Near Mart" in raid or "Far Foods" in raid
    assert cleared["origin"] is None and cleared["stores"][0]["store"]["lat"] is None


@pytest.mark.integration
def test_location_errors_are_reported_plainly(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def down(lat: float, lon: float) -> tuple[StoreInfo, ...]:
        raise PlacesError("down")

    async def empty(lat: float, lon: float) -> tuple[StoreInfo, ...]:
        return ()

    monkeypatch.setattr(api_day, "find_stores", down)
    assert client.post("/api/nearby", json={"lat": 1, "lon": 1}).status_code == 502
    monkeypatch.setattr(api_day, "find_stores", empty)
    assert client.post("/api/nearby", json={"lat": 1, "lon": 1}).status_code == 404
    assert client.post("/api/nearby", json={"lat": 91, "lon": 1}).status_code == 422
    assert client.get("/api/stores").json()["data"]["origin"] is None


@pytest.mark.integration
def test_chat_uses_the_live_model_when_one_is_configured(settings: Settings) -> None:
    llm = _ChatLLM(_draft(reply="Mushrooms are banished.", add_avoid=["mushroom"]))
    client = TestClient(create_app(settings=settings, repository=sqlite_repository(settings.sqlite_path), llm=llm))

    answer = client.post("/api/chat", json={"agent": "chef", "message": "no mushrooms"}).json()["data"]

    assert answer["reply"] == "Mushrooms are banished."
    assert answer["profile"]["goals"]["avoid"] == ["mushroom"]


@pytest.mark.integration
def test_a_second_lookup_at_the_same_spot_does_not_need_the_map_service(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_find(lat: float, lon: float) -> tuple[StoreInfo, ...]:
        return stores_from_elements([_element("Near Mart", 40.502, -74.447)], lat, lon)

    async def down(lat: float, lon: float) -> tuple[StoreInfo, ...]:
        raise PlacesError("down")

    monkeypatch.setattr(api_day, "find_stores", fake_find)
    client.post("/api/nearby", json={"lat": 40.5008, "lon": -74.4474})
    client.delete("/api/nearby")
    monkeypatch.setattr(api_day, "find_stores", down)

    again = client.post("/api/nearby", json={"lat": 40.5011, "lon": -74.4469})

    assert again.status_code == 200
    assert [entry["store"]["name"] for entry in again.json()["data"]["stores"]] == ["Near Mart"]
