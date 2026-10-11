import type { Category, InventoryItem } from "../types";

export const RISK_DAYS = 3;
const KEEPS_DAYS = 60;

const KEYWORD_SPRITES: ReadonlyArray<[string, string]> = [
  ["spinach", "🥬"], ["kale", "🥬"], ["lettuce", "🥬"], ["cabbage", "🥬"],
  ["tomato", "🍅"], ["onion", "🧅"], ["scallion", "🧅"], ["garlic", "🧄"],
  ["bell pepper", "🫑"], ["pepper", "🌶️"], ["carrot", "🥕"], ["broccoli", "🥦"],
  ["mushroom", "🍄"], ["zucchini", "🥒"], ["cucumber", "🥒"], ["sweet potato", "🍠"],
  ["potato", "🥔"], ["lemon", "🍋"], ["lime", "🍋"], ["avocado", "🥑"], ["corn", "🌽"],
  ["green bean", "🫛"], ["banana", "🍌"], ["apple", "🍎"], ["berr", "🍓"],
  ["cilantro", "🌿"], ["basil", "🌿"], ["ginger", "🫚"],
  ["coconut milk", "🥥"], ["milk", "🥛"], ["egg", "🥚"], ["butter", "🧈"],
  ["yogurt", "🥣"], ["sour cream", "🥣"], ["cream", "🥛"],
  ["cheddar", "🧀"], ["mozzarella", "🧀"], ["parmesan", "🧀"], ["feta", "🧀"], ["cheese", "🧀"],
  ["chicken", "🍗"], ["beef", "🥩"], ["bacon", "🥓"], ["sausage", "🌭"], ["ham", "🍖"],
  ["turkey", "🍖"], ["tofu", "🧊"], ["salmon", "🐟"], ["fish", "🐟"], ["shrimp", "🦐"],
  ["bean", "🫘"], ["chickpea", "🫘"],
  ["rice", "🍚"], ["pasta", "🍝"], ["ramen", "🍜"], ["noodle", "🍜"], ["bread", "🍞"],
  ["tortilla", "🫓"], ["oat", "🌾"], ["quinoa", "🌾"], ["flour", "🌾"],
  ["broth", "🍲"], ["peanut butter", "🥜"], ["honey", "🍯"], ["salsa", "🥫"], ["pesto", "🌿"],
  ["soy sauce", "🍶"], ["hot sauce", "🌶️"], ["hummus", "🥙"],
];

const CATEGORY_SPRITES: Record<Category, string> = {
  produce: "🥗",
  dairy: "🥛",
  protein: "🍖",
  grain: "🌾",
  pantry: "🥫",
  condiment: "🥫",
  frozen: "🧊",
  beverage: "🧃",
  leftover: "🍱",
  other: "📦",
};

const DISH_SPRITES: ReadonlyArray<[string, string]> = [
  ["taco", "🌮"], ["burrito", "🌯"], ["wrap", "🌯"], ["quesadilla", "🫓"],
  ["carbonara", "🍝"], ["pasta", "🍝"], ["zoodle", "🍤"], ["shrimp", "🍤"], ["ramen", "🍜"], ["noodle", "🍜"],
  ["curry", "🍛"], ["stew", "🍲"], ["soup", "🍲"], ["fried rice", "🍚"],
  ["oats", "🥣"], ["melt", "🥪"], ["sandwich", "🥪"], ["toast", "🍞"],
  ["salmon", "🐟"], ["stir", "🥘"], ["hash", "🥘"], ["frittata", "🍳"], ["skillet", "🍳"],
  ["scramble", "🍳"], ["omelet", "🍳"], ["salad", "🥗"], ["bowl", "🥗"], ["pizza", "🍕"], ["burger", "🍔"],
];

const DEFAULT_DISH_SPRITE = "🍽️";

/** Emoji for a food item: by keyword first, then by category. Drawn as pixel art by PixelEmoji. */
export function spriteFor(item: Pick<InventoryItem, "name" | "category">): string {
  const name = item.name.toLowerCase();
  const match = KEYWORD_SPRITES.find(([keyword]) => name.includes(keyword));
  return match ? match[1] : CATEGORY_SPRITES[item.category];
}

/** Emoji for a food known only by name, such as a shopping list line. */
export function spriteForName(name: string): string {
  return spriteFor({ name, category: "pantry" });
}

export function dishSprite(dishName: string): string {
  const name = dishName.toLowerCase();
  const match = DISH_SPRITES.find(([keyword]) => name.includes(keyword));
  return match ? match[1] : DEFAULT_DISH_SPRITE;
}

export function isAtRisk(daysLeft: number): boolean {
  return daysLeft <= RISK_DAYS;
}

export function isPantry(daysLeft: number): boolean {
  return daysLeft >= KEEPS_DAYS;
}

export function daysLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    return "expired";
  }
  if (daysLeft === 0) {
    return "today";
  }
  if (isPantry(daysLeft)) {
    return "pantry";
  }
  return daysLeft === 1 ? "1 day" : `${daysLeft} days`;
}

export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

const COUNT_UNITS = new Set(["whole", "unit", "piece", "each"]);

function isCounted(unit: string, name: string): boolean {
  return COUNT_UNITS.has(unit) || unit === name;
}

/** "2 cup spinach", but "4 egg" and "2 zucchini" rather than "4 egg egg" and "2 whole zucchini". */
export function ingredientLabel(quantity: number, unit: string, name: string): string {
  const count = Number(quantity.toFixed(2));
  return isCounted(unit, name) ? `${count} ${name}` : `${count} ${unit} ${name}`;
}

/** The amount alone: "2 cup", or "4" for counted foods. */
export function amountLabel(quantity: number, unit: string, name: string): string {
  const count = Number(quantity.toFixed(2));
  return isCounted(unit, name) ? `${count}` : `${count} ${unit}`;
}

/** How a grocery line is sold: "1 pack of 12" or "2 × 6 cup". */
export function packLabel(packs: number, packSize: number, unit: string, name: string): string {
  const size = Number(packSize.toFixed(2));
  if (isCounted(unit, name)) {
    return size === 1 ? `${packs}` : `${packs} pack${packs === 1 ? "" : "s"} of ${size}`;
  }
  return `${packs} × ${size} ${unit}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "a", "a and b", "a, b and c". */
export function listOf(names: readonly string[]): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function plural(count: number, word: string): string {
  const ending = /(ch|sh|s|x)$/.test(word) ? "es" : "s";
  return `${count} ${word}${count === 1 ? "" : ending}`;
}
