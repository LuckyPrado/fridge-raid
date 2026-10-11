import type { CartLine, Dish, Goals, Ingredient, InventoryItem, SavedPlan } from "../types";
import { isAtRisk } from "./food";

// Mirrors the server's catalog matching closely enough to line recipes up with the fridge.
const DESCRIPTORS = new Set([
  "baby", "fresh", "organic", "shredded", "whole", "large", "small", "raw", "chopped", "diced", "sliced", "ripe",
]);
const STAPLES = new Set(["salt", "pepper", "black pepper", "olive oil", "oil", "vegetable oil", "water", "sugar"]);

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.length > 4 && word.endsWith("oes")) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Reduce a free-text food name to a matching key: "Baby Spinach" becomes "spinach". */
export function normalizeName(name: string): string {
  const words = name.toLowerCase().replace(/[^a-z ]/g, " ").split(" ").filter(Boolean);
  const kept = words.filter((word) => !DESCRIPTORS.has(word));
  const base = kept.length > 0 ? kept : words;
  const trimmed = base.length > 1 && base[base.length - 1] === "cheese" && base[0] !== "cream" ? base.slice(0, -1) : base;
  return trimmed.map(singular).join(" ");
}

export function isStaple(name: string): boolean {
  return STAPLES.has(normalizeName(name));
}

export type IngredientStatus = "ready" | "use-soon" | "buy" | "staple";

export interface IngredientCheck {
  ingredient: Ingredient;
  status: IngredientStatus;
}

interface Stock {
  quantity: number;
  soonest: number;
}

function stockOf(inventory: readonly InventoryItem[]): Map<string, Stock> {
  const stock = new Map<string, Stock>();
  for (const item of inventory) {
    const key = normalizeName(item.name);
    const previous = stock.get(key);
    stock.set(key, {
      quantity: item.quantity + (previous?.quantity ?? 0),
      soonest: Math.min(item.days_left, previous?.soonest ?? Number.POSITIVE_INFINITY),
    });
  }
  return stock;
}

/** For each ingredient of a dish: is it in the fridge, about to expire, or still to buy? */
export function checkIngredients(dish: Dish, inventory: readonly InventoryItem[]): IngredientCheck[] {
  const stock = stockOf(inventory);
  return dish.ingredients.map((ingredient) => {
    if (isStaple(ingredient.name)) {
      return { ingredient, status: "staple" };
    }
    const held = stock.get(normalizeName(ingredient.name));
    if (!held || held.quantity < ingredient.quantity) {
      return { ingredient, status: "buy" };
    }
    return { ingredient, status: isAtRisk(held.soonest) ? "use-soon" : "ready" };
  });
}

export interface Readiness {
  ready: number;
  total: number;
  useSoon: string[];
  toBuy: string[];
}

export function readiness(checks: readonly IngredientCheck[]): Readiness {
  return {
    ready: checks.filter((check) => check.status !== "buy").length,
    total: checks.length,
    useSoon: checks.filter((check) => check.status === "use-soon").map((check) => check.ingredient.name),
    toBuy: checks.filter((check) => check.status === "buy").map((check) => check.ingredient.name),
  };
}

/** Names of the dishes that need a given shopping line. */
export function dishesUsing(line: CartLine, dishes: readonly Dish[]): string[] {
  const key = normalizeName(line.name);
  return dishes
    .filter((dish) => dish.ingredients.some((ingredient) => normalizeName(ingredient.name) === key))
    .map((dish) => dish.name);
}

export function cartLineFor(ingredientName: string, cart: readonly CartLine[]): CartLine | undefined {
  const key = normalizeName(ingredientName);
  return cart.find((line) => normalizeName(line.name) === key);
}

export function isDeal(line: CartLine): boolean {
  return line.list_cost > line.cost;
}

export function savingPercent(price: number, listPrice: number): number {
  return listPrice > 0 ? Math.round((1 - price / listPrice) * 100) : 0;
}

export function nextDish(saved: SavedPlan): Dish | null {
  return saved.plan?.dishes.find((dish) => !saved.cooked.includes(dish.id)) ?? null;
}

const DAY_TAGS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Short weekday tag for the nth dinner, counting from the given date. */
export function dayTag(from: Date, offset: number): string {
  return DAY_TAGS[(from.getDay() + offset) % DAY_TAGS.length];
}

/** Local calendar day as YYYY-MM-DD. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** How many of `segments` blocks to fill for value out of max. Never fills more than exist. */
export function filledSegments(value: number, max: number, segments: number): number {
  if (max <= 0 || value <= 0) {
    return 0;
  }
  return Math.min(segments, Math.max(1, Math.round((value / max) * segments)));
}

const REASONS_SHOWN = 2;

/** The favorite foods a dish delivers on: named in its title or among its ingredients. */
export function favoritesIn(dish: Dish, favorites: readonly string[]): string[] {
  const title = normalizeName(dish.name);
  const titleWords = new Set(title.split(" "));
  const ingredients = new Set(dish.ingredients.map((ingredient) => normalizeName(ingredient.name)));
  return favorites.filter((favorite) => {
    const key = normalizeName(favorite);
    return key !== "" && (titleWords.has(key) || ingredients.has(key) || title.includes(key));
  });
}

/** Plain reasons the Chef picked a dish, most personal first: your favorites, your expiring food, your diet. */
export function whySuggested(dish: Dish, inventory: readonly InventoryItem[], goals: Goals): string[] {
  const reasons = favoritesIn(dish, goals.favorites).map((favorite) => `You love ${favorite}`);
  const useSoon = readiness(checkIngredients(dish, inventory)).useSoon.slice(0, REASONS_SHOWN);
  if (useSoon.length > 0) {
    reasons.push(`Uses your ${useSoon.join(" and ")} before it spoils`);
  }
  if (goals.diet !== "none") {
    reasons.push(`Fits ${goals.diet}`);
  }
  if (goals.avoid.length > 0) {
    reasons.push(`No ${goals.avoid.slice(0, REASONS_SHOWN).join(" or ")}`);
  }
  return reasons;
}
