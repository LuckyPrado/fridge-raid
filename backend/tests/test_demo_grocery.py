from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import demo, grocery
from app.catalog import Catalog
from app.chat import ChatFacts, offline_answer, offline_draft
from app.config import Settings
from app.deals import Store
from app.llm import LLMError
from app.main import create_app
from app.repository import sqlite_repository
from app.schemas import Goals, MealDraft, ScoutDraft, ScoutDraftItem, StoreInfo
from app.scout import scan_from_draft

PHOTO = {"photo": ("fridge.jpg", b"fake-bytes", "image/jpeg")}


def _store(store_id: str, distance: float, **sale_prices: float) -> Store:
    info = StoreInfo(id=store_id, name=store_id.title(), distance_mi=distance, walk_min=int(distance * 20))
    return Store(info=info, sale_prices=sale_prices)


class _VisionLLM:
    """Stands in for Gemini vision: one egg carton in a known spot, one plate of pasta."""

    def __init__(self) -> None:
        self.calls = 0
        self.fail = False

    async def generate(self, *, schema: type, **_: Any) -> Any:
        self.calls += 1
        if self.fail:
            raise LLMError("stub outage")
        if schema is MealDraft:
            return MealDraft(name=" Pasta  bowl ", calories=640, protein_g=22, sodium_mg=700)
        return ScoutDraft(
            items=[ScoutDraftItem(name="Eggs", category="dairy", quantity=6, unit="egg", days_left=9, box=[100, 200, 400, 600])]
        )


def _live_client(settings: Settings, llm: Any) -> TestClient:
    return TestClient(create_app(settings=settings, repository=sqlite_repository(settings.sqlite_path), llm=llm))


# --- scan boxes ---


@pytest.mark.unit
def test_scan_turns_model_corners_into_fractions_and_drops_bad_boxes(catalog: Catalog) -> None:
    draft = ScoutDraft(
        items=[
            ScoutDraftItem(name="egg", category="dairy", quantity=6, unit="unit", days_left=9, box=[100, 200, 400, 600]),
            ScoutDraftItem(name="spinach", category="produce", quantity=2, unit="unit", days_left=2, box=[5, 5, 6, 6]),
            ScoutDraftItem(name="rice", category="grain", quantity=1, unit="unit", days_left=300, box=[1, 2, 3]),
            ScoutDraftItem(name="cheese", category="dairy", quantity=1, unit="unit", days_left=9, box=[-50, 900, 500, 2000]),
        ]
    )

    result = scan_from_draft(draft, catalog)

    assert [item.name for item in result.items] == ["egg", "spinach", "rice", "cheese"]
    assert [(box.name, box.x, box.y, box.width, box.height) for box in result.boxes] == [
        ("egg", 0.2, 0.1, 0.4, 0.3),
        ("cheese", 0.9, 0.0, 0.1, 0.5),
    ]
    assert result.boxes[0].item_id == result.items[0].id


# --- price finder and grocery list ---


@pytest.mark.unit
def test_best_quote_picks_the_cheapest_store_then_the_nearest(catalog: Catalog) -> None:
    stores = [_store("far", 2.0, egg=1.50), _store("near", 0.2), _store("mid", 1.0, egg=1.50)]

    egg = grocery.best_quote("Eggs", stores, catalog)
    rice = grocery.best_quote("rice", stores, catalog)
    unknown = grocery.best_quote("dragonfruit", stores, catalog)

    assert (egg.store, egg.price, egg.list_price, egg.known) == ("Mid", 1.50, 3.00, True)
    assert (rice.store, rice.price) == ("Near", 2.00)
    assert (unknown.known, unknown.store) == (False, "Near")
    assert grocery.best_quote("egg", [], catalog) is None


@pytest.mark.unit
def test_quotes_skip_staples_blanks_and_repeats(catalog: Catalog) -> None:
    quotes = grocery.quotes_for(["egg", "Eggs", "salt", " ", "rice"], [_store("a", 1.0)], catalog)

    assert [quote.name for quote in quotes] == ["egg", "rice"]


@pytest.mark.unit
def test_grocery_list_adds_once_with_the_best_price(tmp_path: Path, catalog: Catalog) -> None:
    repo = sqlite_repository(tmp_path / "db.sqlite3")
    stores = [_store("deal", 1.0, egg=1.50)]

    first, added = grocery.add_item(repo, "  Eggs ", stores, catalog)
    second, repeat = grocery.add_item(repo, "egg", stores, catalog)

    assert (added.name, added.store, added.price, added.pack) == ("egg", "Deal", 1.50, "12 unit")
    assert repeat is None and second == first == grocery.load_list(repo)
    repo.put_doc(grocery.GROCERY_KEY, "{broken")
    assert grocery.load_list(repo).items == ()


# --- questions the agents can answer without the model ---


@pytest.mark.unit
@pytest.mark.parametrize(
    ("agent", "message", "expected"),
    [
        ("chef", "What should I cook tonight?", "Tonight I would make Egg Tacos. It takes 10 minutes."),
        ("chef", "what is going bad?", "Use the milk, spinach first."),
        ("nutritionist", "How am I doing today?", "900 of 1800 kcal and 40 of 100 g protein"),
        ("bargain_hunter", "What is my budget?", "Your plan costs $12.00 of your $25.00 budget. $13.00 stays in reserve."),
        ("bargain_hunter", "How much is milk?", "Milk is $2 at Corner."),
        ("bargain_hunter", "which store?", "Your best stop this week is Corner."),
        ("chef", "how much protein is left", "60 g of protein to go"),
    ],
)
def test_agents_answer_questions_from_saved_facts(agent: str, message: str, expected: str) -> None:
    facts = ChatFacts(
        next_dish="Egg Tacos", next_dish_minutes=10, use_soon=("milk", "spinach"), calories=900, protein_g=40,
        plan_cost=12.0, store="Corner", price_of=lambda name: f"{name.capitalize()} is $2 at Corner.",
    )

    assert expected in (offline_answer(agent, message, facts, Goals()) or "")


@pytest.mark.unit
def test_agents_have_no_answer_for_small_talk() -> None:
    assert offline_answer("chef", "hello there", ChatFacts(), Goals()) is None


@pytest.mark.unit
def test_offline_reader_spots_grocery_list_requests() -> None:
    assert offline_draft("Please add milk and eggs to my grocery list").add_to_grocery == ["milk", "eggs"]
    assert offline_draft("put oats on the list").add_to_grocery == ["oats"]


# --- HTTP: grocery, quotes, chat ---


@pytest.mark.integration
def test_grocery_list_round_trip_over_http(client: TestClient) -> None:
    added = client.post("/api/grocery", json={"name": "lemon"}).json()["data"]
    quotes = client.post("/api/quote", json={"names": ["lemon", "salt"]}).json()["data"]
    cleared = client.put("/api/grocery", json={"items": []}).json()["data"]

    assert [(item["name"], item["price"] > 0, bool(item["store"])) for item in added["items"]] == [("lemon", True, True)]
    assert [quote["name"] for quote in quotes] == ["lemon"]
    assert quotes[0]["price"] <= quotes[0]["list_price"]
    assert cleared["items"] == [] and client.get("/api/grocery").json()["data"]["items"] == []
    assert client.post("/api/quote", json={"names": []}).status_code == 422


@pytest.mark.integration
def test_chat_can_put_things_on_the_grocery_list_and_answer_prices(client: TestClient) -> None:
    added = client.post("/api/chat", json={"agent": "bargain_hunter", "message": "add lemon to my list"}).json()["data"]
    again = client.post("/api/chat", json={"agent": "bargain_hunter", "message": "add lemon to my list"}).json()["data"]
    price = client.post("/api/chat", json={"agent": "bargain_hunter", "message": "How much is lemon?"}).json()["data"]

    assert len(added["changes"]) == 1 and added["changes"][0].startswith("On your list: lemon · $")
    assert "already on your list" in again["reply"]
    assert price["reply"].startswith("Lemon is cheapest at ")
    assert [item["name"] for item in client.get("/api/grocery").json()["data"]["items"]] == ["lemon"]


# --- HTTP: recording and demo mode ---


@pytest.mark.integration
def test_a_live_scan_is_recorded_and_demo_mode_replays_it_without_the_model(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.DEMO_SCAN_SECONDS", 0)
    llm = _VisionLLM()
    client = _live_client(settings, llm)

    live = client.post("/api/scout", files=PHOTO).json()["data"]
    photo = client.get("/api/scan/photo")
    switched = client.put("/api/demo", json={"on": True}).json()["data"]
    status = client.get("/api/status").json()["data"]
    replay = client.post("/api/scout", files=PHOTO).json()["data"]

    assert [(item["name"], item["quantity"]) for item in live["items"]] == [("egg", 6)]
    assert live["boxes"][0]["x"] == 0.2 and live["has_photo"]
    assert (photo.status_code, photo.content, photo.headers["content-type"]) == (200, b"fake-bytes", "image/jpeg")
    assert switched == {"on": True, "has_scan": True, "has_meal": False}
    assert (status["mode"], status["scan_ready"]) == ("demo", True)
    assert llm.calls == 1, "the replay must not call the model"
    assert [item["name"] for item in replay["items"]] == ["egg"]
    assert replay["items"][0]["id"] != live["items"][0]["id"]
    assert replay["boxes"][0]["item_id"] == replay["items"][0]["id"]


@pytest.mark.integration
def test_meal_photo_estimates_live_and_replays_in_demo_mode(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.DEMO_SCAN_SECONDS", 0)
    llm = _VisionLLM()
    client = _live_client(settings, llm)

    live = client.post("/api/meal-photo", files=PHOTO).json()["data"]
    client.put("/api/demo", json={"on": True})
    replay = client.post("/api/meal-photo", files=PHOTO).json()["data"]

    assert live == replay == {"name": "Pasta bowl", "calories": 640, "protein_g": 22, "sodium_mg": 700}
    assert llm.calls == 1


@pytest.mark.integration
def test_photo_routes_explain_themselves_without_a_model_or_recording(client: TestClient) -> None:
    assert client.post("/api/scout", files=PHOTO).status_code == 503
    assert client.post("/api/meal-photo", files=PHOTO).status_code == 503
    assert client.get("/api/scan/photo").status_code == 404
    assert client.post("/api/meal-photo", files={"photo": ("a.txt", b"x", "text/plain")}).status_code == 415
    assert client.get("/api/demo").json()["data"] == {"on": False, "has_scan": False, "has_meal": False}


@pytest.mark.integration
def test_a_failed_live_read_reports_an_error_and_records_nothing(settings: Settings) -> None:
    llm = _VisionLLM()
    llm.fail = True
    client = _live_client(settings, llm)

    assert client.post("/api/scout", files=PHOTO).status_code == 502
    assert client.post("/api/meal-photo", files=PHOTO).status_code == 502
    assert client.get("/api/demo").json()["data"]["has_scan"] is False


@pytest.mark.integration
def test_demo_mode_plans_and_chats_without_the_model_and_survives_a_reset(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.DEMO_SCAN_SECONDS", 0)
    llm = _VisionLLM()
    client = _live_client(settings, llm)
    client.post("/api/scout", files=PHOTO)
    client.put("/api/demo", json={"on": True})
    calls_before = llm.calls

    client.post("/api/reset")
    fridges = client.get("/api/demo-fridges").json()["data"]
    raid = client.post("/api/raid", json={"inventory": fridges[0]["items"]}).text
    chat = client.post("/api/chat", json={"agent": "chef", "message": "I love tacos"}).json()["data"]

    assert client.get("/api/demo").json()["data"] == {"on": True, "has_scan": True, "has_meal": False}
    assert '"party": "offline"' in raid and '"type": "plan"' in raid
    assert chat["changes"] == ["Favorites: tacos"] and chat["reply"].startswith("Noted!")
    assert llm.calls == calls_before, "demo mode must never call the model"
    assert demo.recorded_scan(sqlite_repository(settings.sqlite_path)) is not None
