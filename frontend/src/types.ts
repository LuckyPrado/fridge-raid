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
export type Diet = "none" | "vegetarian" | "vegan" | "pescatarian" | "kosher" | "halal";
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
  lat: number | null;
  lon: number | null;
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
  avoid: string[];
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
  mode: "gemini" | "offline" | "demo";
  scan_ready: boolean;
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
  onboarded: boolean;
  goals: Goals;
}

export interface SavedPlan {
  plan: WeekPlan | null;
  cooked: string[];
  /** Shopping lines already bought. That food is in the fridge. */
  bought: string[];
}

export interface BoughtResult {
  items: InventoryItem[];
  saved: SavedPlan;
  grocery: { items: GroceryItem[] };
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

export interface Origin {
  lat: number;
  lon: number;
}

export interface StoreBoard {
  origin: Origin | null;
  stores: StoreDeals[];
}

export interface ChatReply {
  agent: AgentId;
  reply: string;
  profile: Profile;
  changes: string[];
}

export interface ChatMessage {
  id: number;
  /** Whose conversation this line belongs to. Each agent has its own. */
  thread: AgentId;
  from: "you" | AgentId;
  text: string;
  changes: string[];
}

export interface FoundBox {
  item_id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScanResult {
  items: InventoryItem[];
  boxes: FoundBox[];
  has_photo: boolean;
}

export interface ScanView {
  photoUrl: string;
  boxes: FoundBox[];
}

export interface MealEstimate {
  name: string;
  calories: number;
  protein_g: number;
  sodium_mg: number;
}

export interface Quote {
  name: string;
  store: string;
  distance_mi: number;
  price: number;
  list_price: number;
  pack_size: number;
  unit: string;
  known: boolean;
}

export interface GroceryItem {
  name: string;
  store: string;
  price: number;
  pack: string;
}

export interface DemoState {
  on: boolean;
  has_scan: boolean;
  has_meal: boolean;
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

export interface StoreQuote {
  name: string;
  distance_mi: number;
  total: number;
  meals: number;
  chosen: boolean;
}

export type RaidEvent =
  | { type: "boss"; max_hp: number; hp: number; party: string; at_risk: string[] }
  | { type: "proposal"; agent: AgentId; round: number; dish: Dish; text: string }
  | { type: "verdict"; agent: AgentId; dish_id: string; dish_name: string; score: number; veto: boolean; text: string }
  | { type: "cost"; agent: AgentId; dish_id: string; dish_name: string; cost: number; text: string }
  | { type: "strike"; dish_id: string; dish_name: string; damage: number; hp: number; spent: number }
  | { type: "stores"; agent: AgentId; text: string; quotes: StoreQuote[] }
  | { type: "system"; text: string }
  | { type: "summary"; agent: AgentId; text: string }
  | { type: "plan"; plan: WeekPlan }
  | { type: "done" }
  | { type: "error"; text: string };
