from __future__ import annotations

import pytest

from app.catalog import Catalog, normalize_name
from app.optimizer import at_risk_items, build_cart, cart_total, optimize_plan, rescued, stock_of, waste_value_total
from tests.conftest import make_dish, make_item

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Baby Spinach", "spinach"),
        ("Eggs", "egg"),
        ("Tomatoes", "tomato"),
        ("berries", "berry"),
        ("Cheddar Cheese", "cheddar"),
        ("cream cheese", "cream cheese"),
        ("  Bell Peppers ", "bell pepper"),
    ],
)
def test_normalize_name_reduces_variants_to_one_key(raw: str, expected: str) -> None:
    assert normalize_name(raw) == expected


def test_cart_is_empty_when_fridge_covers_every_ingredient(catalog: Catalog) -> None:
    stock = stock_of([make_item("spinach", 4, 1), make_item("egg", 6, 10)])
    dish = make_dish("Scramble", {"spinach": 2, "eggs": 4})

    cart = build_cart([dish], stock, catalog)

    assert cart == ()


def test_cart_buys_whole_packs_for_the_shortfall_only(catalog: Catalog) -> None:
    stock = stock_of([make_item("egg", 2, 10)])
    dish = make_dish("Big Omelette", {"egg": 16})

    cart = build_cart([dish], stock, catalog)

    assert len(cart) == 1
    assert cart[0].name == "egg"
    assert cart[0].packs == 2  # short 14 eggs, packs of 12
    assert cart_total(cart) == 6.00


def test_cart_ignores_kitchen_staples(catalog: Catalog) -> None:
    dish = make_dish("Salty Rice", {"rice": 1, "salt": 1, "olive oil": 2})

    cart = build_cart([dish], {}, catalog)

    assert [line.name for line in cart] == ["rice"]


def test_unknown_ingredient_gets_default_price(catalog: Catalog) -> None:
    dish = make_dish("Mystery", {"dragonfruit": 2})

    cart = build_cart([dish], {}, catalog)

    assert cart[0].packs == 2
    assert cart_total(cart) == 6.00


def test_shared_pack_is_paid_for_once_across_dishes(catalog: Catalog) -> None:
    first = make_dish("Fried Rice", {"rice": 3})
    second = make_dish("Rice Bowl", {"rice": 4})

    cart = build_cart([first, second], {}, catalog)

    assert cart_total(cart) == 2.00  # one pack of 10 covers both


def test_at_risk_counts_only_food_expiring_soon(catalog: Catalog) -> None:
    inventory = [make_item("spinach", 4, 1), make_item("egg", 12, 10), make_item("salmon", 1, 3)]

    risky = at_risk_items(inventory, catalog)

    assert set(risky) == {"spinach", "salmon"}
    assert waste_value_total(risky) == 11.00  # 4 * 0.50 + 1 * 9.00


def test_rescued_value_is_proportional_to_amount_used(catalog: Catalog) -> None:
    risky = at_risk_items([make_item("spinach", 4, 1)], catalog)
    dish = make_dish("Half Salad", {"spinach": 2})

    value, names = rescued([dish], risky)

    assert value == 1.00
    assert names == ("spinach",)


def test_optimizer_picks_most_meals_within_budget(catalog: Catalog) -> None:
    inventory = [make_item("spinach", 4, 1), make_item("egg", 6, 10)]
    free = make_dish("Scramble", {"spinach": 2, "egg": 3})
    cheap = make_dish("Rice Bowl", {"rice": 2, "egg": 2})
    pricey = make_dish("Salmon Plate", {"salmon": 2})

    plan = optimize_plan([free, cheap, pricey], inventory, catalog, budget=5.0, max_meals=3)

    assert {dish.name for dish in plan.dishes} == {"Scramble", "Rice Bowl"}
    assert plan.total_cost == 2.00
    assert plan.benched == ("Salmon Plate",)


def test_optimizer_breaks_meal_ties_by_food_rescued(catalog: Catalog) -> None:
    inventory = [make_item("spinach", 4, 1), make_item("egg", 12, 10)]
    rescuer = make_dish("Spinach Omelette", {"spinach": 4, "egg": 2})
    bystander = make_dish("Plain Omelette", {"egg": 3})

    plan = optimize_plan([bystander, rescuer], inventory, catalog, budget=0.0, max_meals=1)

    assert [dish.name for dish in plan.dishes] == ["Spinach Omelette"]
    assert plan.waste_value_saved == plan.waste_value_total == 2.00


def test_optimizer_breaks_remaining_ties_by_lower_cost(catalog: Catalog) -> None:
    cheap = make_dish("Rice", {"rice": 1})
    pricey = make_dish("Cheese Plate", {"cheese": 1})

    plan = optimize_plan([pricey, cheap], [], catalog, budget=10.0, max_meals=1)

    assert [dish.name for dish in plan.dishes] == ["Rice"]


def test_optimizer_returns_empty_plan_when_nothing_fits_budget(catalog: Catalog) -> None:
    pricey = make_dish("Salmon Plate", {"salmon": 2})

    plan = optimize_plan([pricey], [], catalog, budget=5.0, max_meals=3)

    assert plan.dishes == ()
    assert plan.cart == ()
    assert plan.benched == ("Salmon Plate",)


def test_optimizer_accounts_for_ingredients_shared_between_dishes(catalog: Catalog) -> None:
    """Two dishes each fit the fridge alone, but together they need more eggs than it holds."""
    inventory = [make_item("egg", 4, 10)]
    first = make_dish("Omelette", {"egg": 3})
    second = make_dish("Frittata", {"egg": 3})

    plan = optimize_plan([first, second], inventory, catalog, budget=0.0, max_meals=2)

    assert len(plan.dishes) == 1


def test_optimizer_handles_more_candidates_than_the_exact_limit(catalog: Catalog) -> None:
    candidates = [make_dish(f"Rice {index}", {"rice": 0.5}) for index in range(15)]

    plan = optimize_plan(candidates, [], catalog, budget=10.0, max_meals=4)

    assert len(plan.dishes) == 4
    assert plan.total_cost == 2.00
