from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.catalog import Catalog
from app.config import MAX_UPLOAD_BYTES, Settings
from app.inventory_ops import apply_plan
from app.llm import LLMError
from app.main import create_app
from app.optimizer import optimize_plan
from app.ratelimit import RateLimiter
from app.repository import create_repository, sqlite_repository, utc_now_iso
from app.schemas import RaidStat, ScoutDraft, ScoutDraftItem
from tests.conftest import make_dish, make_item

pytestmark = pytest.mark.integration


def _events(response_text: str) -> list[dict[str, Any]]:
    return [json.loads(line[len("data: "):]) for line in response_text.splitlines() if line.startswith("data: ")]


def _demo_items(client: TestClient, fridge_id: str = "dorm") -> list[dict[str, Any]]:
    fridges = client.get("/api/demo-fridges").json()["data"]
    return next(fridge["items"] for fridge in fridges if fridge["id"] == fridge_id)


# --- inventory operations and persistence ---


def test_apply_plan_consumes_food_and_stores_leftover_groceries(catalog: Catalog) -> None:
    inventory = [make_item("spinach", 4, 1), make_item("egg", 2, 10)]
    dish = make_dish("Big Scramble", {"spinach": 4, "egg": 5})
    plan = optimize_plan([dish], inventory, catalog, budget=10.0, max_meals=1)

    after = apply_plan(inventory, plan, catalog)

    assert [(item.name, item.quantity) for item in after] == [("egg", 9)]  # bought 12, had 2, used 5
    assert after[0].days_left == 21
    assert inventory[0].quantity == 4, "the original inventory must not be mutated"


def test_apply_plan_uses_soonest_expiring_stock_first(catalog: Catalog) -> None:
    inventory = [make_item("egg", 3, 10, item_id="fresh"), make_item("egg", 3, 1, item_id="old")]
    dish = make_dish("Omelette", {"egg": 4})
    plan = optimize_plan([dish], inventory, catalog, budget=0.0, max_meals=1)

    after = apply_plan(inventory, plan, catalog)

    assert [(item.id, item.quantity) for item in after] == [("fresh", 2)]


def test_repository_round_trips_inventory_and_stats(tmp_path: Path) -> None:
    repo = sqlite_repository(tmp_path / "db.sqlite3")
    items = [make_item("egg", 6, 9), make_item("spinach", 2.5, 1)]
    stat = RaidStat(ts=utc_now_iso(), meals=3, spend=12.5, waste_value_saved=7.25, items_rescued=4)

    repo.replace_items(items)
    repo.add_stat(stat)

    assert sorted(repo.list_items(), key=lambda item: item.name) == items
    assert repo.list_stats() == [stat]


def test_repository_replace_overwrites_previous_inventory(tmp_path: Path) -> None:
    repo = sqlite_repository(tmp_path / "db.sqlite3")
    repo.replace_items([make_item("egg", 6, 9)])

    repo.replace_items([])

    assert repo.list_items() == []


def test_create_repository_falls_back_to_sqlite_when_postgres_is_unreachable(tmp_path: Path) -> None:
    repo = create_repository("postgresql://nobody:nothing@127.0.0.1:1/none", tmp_path / "db.sqlite3")

    assert repo.name == "sqlite"


def test_scout_route_returns_429_once_the_limit_is_hit(client: TestClient) -> None:
    statuses = [
        client.post("/api/scout", files={"photo": ("f.png", b"x", "image/png")}).status_code for _ in range(8)
    ]

    assert statuses[0] == 503 and statuses[-1] == 429


def test_rate_limiter_forgets_idle_clients() -> None:
    limiter = RateLimiter(max_requests=2, window_seconds=60)
    limiter.allow("old", now=0)

    limiter.allow("new", now=100)

    assert set(limiter._hits) == {"new"}


def test_rate_limiter_blocks_after_the_limit_and_recovers() -> None:
    limiter = RateLimiter(max_requests=2, window_seconds=60)

    assert limiter.allow("a", now=0) and limiter.allow("a", now=1)
    assert not limiter.allow("a", now=2)
    assert limiter.allow("b", now=2)
    assert limiter.allow("a", now=61)


# --- HTTP routes ---


def test_status_reports_offline_mode_without_a_key(client: TestClient) -> None:
    body = client.get("/api/status").json()

    assert body == {"success": True, "data": {"mode": "offline", "model": None, "database": "sqlite"}, "error": None}


def test_demo_fridges_are_listed_with_items(client: TestClient) -> None:
    fridges = client.get("/api/demo-fridges").json()["data"]

    assert len(fridges) == 3
    assert all(fridge["items"] for fridge in fridges)


def test_threat_reports_value_and_names_of_expiring_food(client: TestClient) -> None:
    items = _demo_items(client, "dorm")

    threat = client.post("/api/threat", json={"items": items}).json()["data"]

    assert threat["waste_value_total"] > 0
    assert "spinach" in threat["at_risk"] and "rice" not in threat["at_risk"]


def test_inventory_can_be_saved_and_read_back(client: TestClient) -> None:
    items = _demo_items(client)

    saved = client.put("/api/inventory", json={"items": items})
    loaded = client.get("/api/inventory").json()["data"]["items"]

    assert saved.status_code == 200
    assert {item["name"] for item in loaded} == {item["name"] for item in items}


def test_inventory_rejects_invalid_items_with_an_error_envelope(client: TestClient) -> None:
    response = client.put("/api/inventory", json={"items": [{"id": "x", "name": "egg", "quantity": -1, "days_left": 1}]})

    assert response.status_code == 422
    assert response.json()["success"] is False and "quantity" in response.json()["error"]


def test_unknown_route_returns_an_error_envelope(client: TestClient) -> None:
    response = client.get("/api/nope")

    assert response.status_code == 404
    assert response.json()["success"] is False


@pytest.mark.parametrize("fridge_id", ["dorm", "mealprep", "leftovers"])
def test_raid_on_each_demo_fridge_produces_a_plan_within_budget(client: TestClient, fridge_id: str) -> None:
    items = _demo_items(client, fridge_id)

    response = client.post("/api/raid", json={"inventory": items, "arena": [items[0]["id"]], "goals": {"budget": 25}})
    events = _events(response.text)
    plan = next(event["plan"] for event in events if event["type"] == "plan")

    assert response.headers["content-type"].startswith("text/event-stream")
    assert events[-1]["type"] == "done"
    assert len(plan["dishes"]) >= 2
    assert plan["total_cost"] <= 25
    assert plan["waste_value_saved"] > 0


def test_dorm_fridge_raid_includes_a_veto_and_a_revision(client: TestClient) -> None:
    items = _demo_items(client, "dorm")

    events = _events(client.post("/api/raid", json={"inventory": items}).text)

    assert any(event["type"] == "verdict" and event["veto"] for event in events)
    assert any(event["type"] == "proposal" and event["round"] == 2 for event in events)


def test_raid_rejects_an_empty_inventory(client: TestClient) -> None:
    response = client.post("/api/raid", json={"inventory": []})

    assert response.status_code == 422


def test_accepting_a_plan_updates_inventory_and_records_a_stat(client: TestClient) -> None:
    items = _demo_items(client)
    events = _events(client.post("/api/raid", json={"inventory": items}).text)
    plan = next(event["plan"] for event in events if event["type"] == "plan")

    accepted = client.post("/api/plan/accept", json={"inventory": items, "plan": plan}).json()["data"]
    stats = client.get("/api/stats").json()["data"]
    stored = client.get("/api/inventory").json()["data"]["items"]

    assert accepted["stat"]["meals"] == len(plan["dishes"])
    assert len(stats) == 1 and stats[0]["spend"] == plan["total_cost"]
    assert len(stored) == len(accepted["items"])
    assert {item["name"] for item in stored} != {item["name"] for item in items}


def test_scout_is_unavailable_without_a_key(client: TestClient) -> None:
    response = client.post("/api/scout", files={"photo": ("fridge.png", b"fake", "image/png")})

    assert response.status_code == 503
    assert "demo fridge" in response.json()["error"]


class _ScoutLLM:
    def __init__(self, fail: bool = False) -> None:
        self._fail = fail

    async def generate(self, **_: Any) -> ScoutDraft:
        if self._fail:
            raise LLMError("outage")
        return ScoutDraft(items=[ScoutDraftItem(name="Eggs", category="dairy", quantity=6, unit="egg", days_left=9)])


def _client_with_llm(settings: Settings, llm: Any) -> TestClient:
    return TestClient(create_app(settings=settings, repository=sqlite_repository(settings.sqlite_path), llm=llm))


def test_scout_returns_inventory_from_a_photo(settings: Settings) -> None:
    client = _client_with_llm(settings, _ScoutLLM())

    response = client.post("/api/scout", files={"photo": ("fridge.jpg", b"fake-bytes", "image/jpeg")})
    items = response.json()["data"]["items"]

    assert response.status_code == 200
    assert [(item["name"], item["quantity"]) for item in items] == [("egg", 6)]
    assert client.get("/api/status").json()["data"]["mode"] == "gemini"


@pytest.mark.parametrize(
    ("name", "size", "mime", "expected_status"),
    [
        ("notes.txt", 5, "text/plain", 415),
        ("empty.png", 0, "image/png", 400),
        ("huge.png", MAX_UPLOAD_BYTES + 1, "image/png", 413),
    ],
)
def test_scout_rejects_bad_uploads(settings: Settings, name: str, size: int, mime: str, expected_status: int) -> None:
    client = _client_with_llm(settings, _ScoutLLM())

    response = client.post("/api/scout", files={"photo": (name, b"x" * size, mime)})

    assert response.status_code == expected_status
    assert response.json()["success"] is False


def test_scout_refuses_an_oversized_upload_from_its_declared_length(settings: Settings) -> None:
    client = _client_with_llm(settings, _ScoutLLM())

    response = client.post(
        "/api/scout",
        files={"photo": ("fridge.png", b"tiny", "image/png")},
        headers={"content-length": str(MAX_UPLOAD_BYTES * 3)},
    )

    assert response.status_code == 413


def test_accept_rejects_a_plan_with_impossible_numbers(client: TestClient) -> None:
    plan = {
        "dishes": [], "cart": [], "total_cost": -5, "budget": 25, "rescued": [],
        "waste_value_total": 0, "waste_value_saved": 0,
    }

    response = client.post("/api/plan/accept", json={"inventory": [], "plan": plan})

    assert response.status_code == 422


def test_scout_reports_a_gateway_error_when_the_model_fails(settings: Settings) -> None:
    client = _client_with_llm(settings, _ScoutLLM(fail=True))

    response = client.post("/api/scout", files={"photo": ("fridge.png", b"fake", "image/png")})

    assert response.status_code == 502
    assert "outage" not in response.json()["error"]
