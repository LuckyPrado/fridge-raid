export const CATEGORIES = [
  "produce",
  "dairy",
  "protein",
  "grain",
  "pantry",
  "condiment",
  "frozen",
  "beverage",
  "leftover",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type Diet = "none" | "vegetarian" | "vegan" | "pescatarian";
export type AgentId = "chef" | "nutritionist" | "bargain_hunter";

export interface InventoryItem {
  id: string;
  name: string;
  category: Category;
  quantity: number;
  unit: string;
  days_left: number;
}

export interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
}

export interface Dish {
  id: string;
  name: string;
  pitch: string;
  description: string;
  ingredients: Ingredient[];
  calories: number;
  protein_g: number;
  sodium_mg: number;
  minutes: number;
  diets: Diet[];
  steps: string[];
}

export interface CartLine {
  name: string;
  packs: number;
  pack_size: number;
  unit: string;
  cost: number;
  list_cost: number;
}

export interface StoreInfo {
  id: string;
  name: string;
  neighborhood: string;
  distance_mi: number;
  walk_min: number;
}

export interface WeekPlan {
  dishes: Dish[];
  cart: CartLine[];
  total_cost: number;
  budget: number;
  rescued: string[];
  waste_value_total: number;
  waste_value_saved: number;
  benched: string[];
  store: StoreInfo | null;
}

export interface Goals {
  budget: number;
  diet: Diet;
  max_calories: number;
  max_sodium_mg: number;
  min_protein_g: number;
  meals: number;
  favorites: string[];
  daily_calories: number;
  daily_protein_g: number;
}

export interface RaidRequest {
  inventory: InventoryItem[];
  arena: string[];
  goals: Goals;
  offline: boolean;
}

export interface StatusInfo {
  mode: "gemini" | "offline";
  model: string | null;
  database: string;
}

export interface DemoFridge {
  id: string;
  title: string;
  blurb: string;
  items: InventoryItem[];
}

export interface Threat {
  waste_value_total: number;
  at_risk: string[];
}

export interface RaidStat {
  ts: string;
  meals: number;
  spend: number;
  waste_value_saved: number;
  items_rescued: number;
}

export interface Profile {
  name: string;
  goals: Goals;
}

export interface SavedPlan {
  plan: WeekPlan | null;
  cooked: string[];
}

export interface LogEntry {
  id: string;
  ts: string;
  day: string;
  name: string;
  calories: number;
  protein_g: number;
  sodium_mg: number;
  kind: "meal" | "manual";
}

export interface DaySummary {
  day: string;
  entries: LogEntry[];
  water: number;
  calories: number;
  protein_g: number;
  sodium_mg: number;
  coach: string;
}

export interface Progress {
  xp: number;
  level: number;
  streak: number;
  meals_cooked: number;
  items_rescued: number;
}

export interface Deal {
  name: string;
  unit: string;
  pack_size: number;
  price: number;
  list_price: number;
}

export interface StoreDeals {
  store: StoreInfo;
  deals: Deal[];
}

export interface CookResult {
  items: InventoryItem[];
  saved: SavedPlan;
  day: DaySummary;
  rescued: string[];
  xp: number;
}

export interface FoodLogInput {
  name: string;
  calories: number;
  protein_g: number;
  sodium_mg: number;
}

export type RaidEvent =
  | { type: "boss"; max_hp: number; hp: number; party: string; at_risk: string[] }
  | { type: "proposal"; agent: AgentId; round: number; dish: Dish; text: string }
  | { type: "verdict"; agent: AgentId; dish_id: string; dish_name: string; score: number; veto: boolean; text: string }
  | { type: "cost"; agent: AgentId; dish_id: string; dish_name: string; cost: number; text: string }
  | { type: "strike"; dish_id: string; dish_name: string; damage: number; hp: number; spent: number }
  | { type: "system"; text: string }
  | { type: "summary"; agent: AgentId; text: string }
  | { type: "plan"; plan: WeekPlan }
  | { type: "done" }
  | { type: "error"; text: string };
