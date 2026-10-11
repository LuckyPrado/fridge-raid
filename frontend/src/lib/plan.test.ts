import { describe, expect, it } from "vitest";

import type { CartLine, Dish, InventoryItem, SavedPlan } from "../types";
import {
  cartLineFor,
  checkIngredients,
  dayTag,
  dishesUsing,
  filledSegments,
  isDeal,
  isStaple,
  localDay,
  nextDish,
  normalizeName,
  readiness,
  savingPercent,
  whySuggested,
} from "./plan";

const item = (name: string, quantity: number, daysLeft: number): InventoryItem => ({
  id: `${name}-${daysLeft}`,
  name,
  category: "produce",
  quantity,
  unit: "unit",
  days_left: daysLeft,
});

const dish = (id: string, name: string, ingredients: Record<string, number>): Dish => ({
  id,
  name,
  pitch: "",
  description: "",
  ingredients: Object.entries(ingredients).map(([ingredient, quantity]) => ({ name: ingredient, quantity, unit: "unit" })),
  calories: 400,
  protein_g: 20,
  sodium_mg: 300,
  minutes: 10,
  diets: [],
  steps: [],
});

const line = (name: string, cost: number, listCost: number): CartLine => ({
  name,
  packs: 1,
  pack_size: 1,
  unit: "unit",
  cost,
  list_cost: listCost,
});

describe("normalizeName", () => {
  it("matches food names the way the server does", () => {
    expect([
      normalizeName("Baby Spinach"),
      normalizeName("Tomatoes"),
      normalizeName("berries"),
      normalizeName("Cheddar Cheese"),
      normalizeName("cream cheese"),
      normalizeName("fresh"),
    ]).toEqual(["spinach", "tomato", "berry", "cheddar", "cream cheese", "fresh"]);
  });

  it("recognizes kitchen staples", () => {
    expect([isStaple("Olive Oil"), isStaple("salt"), isStaple("spinach")]).toEqual([true, true, false]);
  });
});

describe("checkIngredients", () => {
  const scramble = dish("d1", "Scramble", { spinach: 2, eggs: 3, salsa: 1, salt: 1 });
  const inventory = [item("spinach", 1, 9), item("baby spinach", 1, 1), item("egg", 6, 10)];

  it("sorts each ingredient into ready, use soon, to buy, or staple", () => {
    const statuses = checkIngredients(scramble, inventory).map((check) => check.status);

    expect(statuses).toEqual(["use-soon", "ready", "buy", "staple"]);
  });

  it("treats too small an amount as something to buy", () => {
    const statuses = checkIngredients(dish("d2", "Big Omelette", { egg: 12 }), inventory).map((check) => check.status);

    expect(statuses).toEqual(["buy"]);
  });

  it("summarizes readiness", () => {
    expect(readiness(checkIngredients(scramble, inventory))).toEqual({
      ready: 3,
      total: 4,
      useSoon: ["spinach"],
      toBuy: ["salsa"],
    });
  });
});

describe("shopping helpers", () => {
  const dishes = [dish("d1", "Tacos", { tortilla: 2, salsa: 1 }), dish("d2", "Quesadilla", { tortillas: 2 })];

  it("finds the dishes that need a shopping line", () => {
    expect(dishesUsing(line("tortilla", 2, 2), dishes)).toEqual(["Tacos", "Quesadilla"]);
    expect(dishesUsing(line("lemon", 1, 1), dishes)).toEqual([]);
  });

  it("finds the shopping line for an ingredient", () => {
    const cart = [line("tortilla", 2, 3)];

    expect(cartLineFor("Tortillas", cart)?.name).toBe("tortilla");
    expect(cartLineFor("salsa", cart)).toBeUndefined();
  });

  it("spots deals and their saving", () => {
    expect([isDeal(line("a", 2, 3)), isDeal(line("a", 3, 3)), isDeal(line("a", 3, 0))]).toEqual([true, false, false]);
    expect([savingPercent(1.2, 1.8), savingPercent(2, 0)]).toEqual([33, 0]);
  });
});

describe("plan helpers", () => {
  const dishes = [dish("d1", "Tacos", { egg: 1 }), dish("d2", "Stew", { egg: 1 })];
  const plan = {
    dishes,
    cart: [],
    total_cost: 0,
    budget: 25,
    rescued: [],
    waste_value_total: 0,
    waste_value_saved: 0,
    benched: [],
    store: null,
  };

  it("returns the first dish that is not cooked yet", () => {
    const saved: SavedPlan = { plan, cooked: ["d1"], bought: [] };

    expect(nextDish(saved)?.id).toBe("d2");
    expect(nextDish({ plan, cooked: ["d1", "d2"], bought: [] })).toBeNull();
    expect(nextDish({ plan: null, cooked: [], bought: [] })).toBeNull();
  });

  it("tags dinners with weekdays that wrap around the week", () => {
    const saturday = new Date(2026, 9, 10);

    expect([dayTag(saturday, 0), dayTag(saturday, 1), dayTag(saturday, 2)]).toEqual(["Sat", "Sun", "Mon"]);
  });

  it("formats the local calendar day with zero padding", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("fills bar segments in proportion, never past the end", () => {
    expect([
      filledSegments(0, 100, 10),
      filledSegments(1, 100, 10),
      filledSegments(50, 100, 10),
      filledSegments(250, 100, 10),
      filledSegments(5, 0, 10),
    ]).toEqual([0, 1, 5, 10, 0]);
  });
});

describe("whySuggested", () => {
  const goals = {
    budget: 25, diet: "halal" as const, max_calories: 800, max_sodium_mg: 900, min_protein_g: 15, meals: 4,
    favorites: ["Tacos", "eggs", "sushi"], avoid: ["mushrooms"], daily_calories: 1800, daily_protein_g: 100,
  };

  it("names the favorite, the expiring food, the diet and the avoided food behind a recipe", () => {
    const tacos = dish("d1", "Spinach Egg Tacos", { spinach: 1, egg: 2 });
    const inventory = [item("spinach", 2, 1), item("egg", 6, 9)];

    expect(whySuggested(tacos, inventory, goals)).toEqual([
      "You love Tacos",
      "You love eggs",
      "Uses your spinach before it spoils",
      "Fits halal",
      "No mushrooms",
    ]);
  });

  it("gives no reasons when nothing personal applies", () => {
    const plain = { ...goals, diet: "none" as const, favorites: [], avoid: [] };

    expect(whySuggested(dish("d2", "Rice Bowl", { rice: 1 }), [item("rice", 3, 300)], plain)).toEqual([]);
  });
});
