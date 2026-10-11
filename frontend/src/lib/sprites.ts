import type { Category, InventoryItem } from "../types";

export const RISK_DAYS = 3;
const KEEPS_DAYS = 60;

export type Shelf = "top" | "middle" | "crisper" | "door";

export const SHELVES: ReadonlyArray<{ id: Shelf; label: string }> = [
  { id: "top", label: "Top shelf" },
  { id: "middle", label: "Middle shelf" },
  { id: "crisper", label: "Crisper drawer" },
  { id: "door", label: "Door" },
];

const SHELF_BY_CATEGORY: Record<Category, Shelf> = {
  dairy: "top",
  leftover: "top",
  beverage: "top",
  protein: "middle",
  grain: "middle",
  pantry: "middle",
  frozen: "middle",
  other: "middle",
  produce: "crisper",
  condiment: "door",
};

const KEYWORD_SPRITES: ReadonlyArray<[string, string]> = [
  ["spinach", "🥬"], ["kale", "🥬"], ["lettuce", "🥬"], ["cabbage", "🥬"],
  ["tomato", "🍅"], ["onion", "🧅"], ["scallion", "🧅"], ["garlic", "🧄"],
  ["bell pepper", "🫑"], ["pepper", "🌶️"], ["carrot", "🥕"], ["broccoli", "🥦"],
  ["mushroom", "🍄"], ["zucchini", "🥒"], ["cucumber", "🥒"], ["sweet potato", "🍠"],
  ["potato", "🥔"], ["lemon", "🍋"], ["lime", "🍋"], ["avocado", "🥑"], ["corn", "🌽"],
  ["green bean", "🫛"], ["banana", "🍌"], ["apple", "🍎"], ["berr", "🫐"],
  ["cilantro", "🌿"], ["basil", "🌿"], ["ginger", "🫚"],
  ["coconut milk", "🥥"], ["milk", "🥛"], ["egg", "🥚"], ["butter", "🧈"],
  ["yogurt", "🥣"], ["sour cream", "🥣"], ["cream", "🥛"],
  ["cheddar", "🧀"], ["mozzarella", "🧀"], ["parmesan", "🧀"], ["feta", "🧀"], ["cheese", "🧀"],
  ["chicken", "🍗"], ["beef", "🥩"], ["bacon", "🥓"], ["sausage", "🌭"], ["ham", "🍖"],
  ["turkey", "🦃"], ["tofu", "⬜"], ["salmon", "🐟"], ["fish", "🐟"], ["shrimp", "🦐"],
  ["bean", "🫘"], ["chickpea", "🫘"],
  ["rice", "🍚"], ["pasta", "🍝"], ["ramen", "🍜"], ["noodle", "🍜"], ["bread", "🍞"],
  ["tortilla", "🫓"], ["oat", "🌾"], ["quinoa", "🌾"], ["flour", "🌾"],
  ["broth", "🍲"], ["peanut butter", "🥜"], ["honey", "🍯"], ["salsa", "🫙"],
  ["soy sauce", "🍶"], ["hot sauce", "🌶️"], ["hummus", "🥙"],
];

const CATEGORY_SPRITES: Record<Category, string> = {
  produce: "🥗",
  dairy: "🥛",
  protein: "🍖",
  grain: "🌾",
  pantry: "🥫",
  condiment: "🫙",
  frozen: "🧊",
  beverage: "🧃",
  leftover: "🍱",
  other: "📦",
};

export function spriteFor(item: Pick<InventoryItem, "name" | "category">): string {
  const name = item.name.toLowerCase();
  const match = KEYWORD_SPRITES.find(([keyword]) => name.includes(keyword));
  return match ? match[1] : CATEGORY_SPRITES[item.category];
}

export function shelfOf(category: Category): Shelf {
  return SHELF_BY_CATEGORY[category];
}

export function isAtRisk(daysLeft: number): boolean {
  return daysLeft <= RISK_DAYS;
}

export function daysLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    return "expired";
  }
  if (daysLeft === 0) {
    return "today";
  }
  if (daysLeft >= KEEPS_DAYS) {
    return "keeps";
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

/** How a grocery line is sold: "1 pack of 12" or "2 × 6 cup". */
export function packLabel(packs: number, packSize: number, unit: string, name: string): string {
  const size = Number(packSize.toFixed(2));
  if (isCounted(unit, name)) {
    return size === 1 ? `${packs}` : `${packs} pack${packs === 1 ? "" : "s"} of ${size}`;
  }
  return `${packs} × ${size} ${unit}`;
}

export function amount(quantity: number, unit: string): string {
  return `${Number(quantity.toFixed(2))} ${unit}`;
}
