import type {
  CookResult,
  DaySummary,
  DemoFridge,
  FoodLogInput,
  InventoryItem,
  Profile,
  Progress,
  SavedPlan,
  StatusInfo,
  AgentId,
  ChatReply,
  DemoState,
  GroceryItem,
  MealEstimate,
  Quote,
  ScanResult,
  Origin,
  StoreBoard,
  Threat,
} from "../types";

export const API_BASE: string = import.meta.env.VITE_API_URL ?? "";

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

const FALLBACK_ERROR = "Could not reach the kitchen. Check that the server is running.";

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new Error(FALLBACK_ERROR);
  }
  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    envelope = null;
  }
  if (!response.ok || !envelope?.success || envelope.data === null) {
    throw new Error(envelope?.error ?? `Request failed (${response.status}).`);
  }
  return envelope.data;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function photoForm(photo: File): FormData {
  const form = new FormData();
  form.append("photo", photo);
  return form;
}

/** Address of the fridge photo from the latest scan. The stamp defeats the browser cache after a new scan. */
export function scanPhotoUrl(stamp: number): string {
  return `${API_BASE}/api/scan/photo?t=${stamp}`;
}

export const api = {
  status: (): Promise<StatusInfo> => request("/api/status"),
  demoFridges: (): Promise<DemoFridge[]> => request("/api/demo-fridges"),
  profile: (): Promise<Profile> => request("/api/profile"),
  saveProfile: (profile: Profile): Promise<Profile> => request("/api/profile", json("PUT", profile)),
  reset: (): Promise<Profile> => request("/api/reset", { method: "POST" }),
  plan: (): Promise<SavedPlan> => request("/api/plan"),
  cook: (dishId: string, day: string): Promise<CookResult> =>
    request("/api/cook", json("POST", { dish_id: dishId, day })),
  day: (day: string): Promise<DaySummary> => request(`/api/day/${day}`),
  logFood: (day: string, entry: FoodLogInput): Promise<DaySummary> =>
    request(`/api/day/${day}/log`, json("POST", entry)),
  setWater: (day: string, glasses: number): Promise<DaySummary> =>
    request(`/api/day/${day}/water`, json("PUT", { glasses })),
  progress: (today: string): Promise<Progress> => request(`/api/progress?today=${today}`),
  stores: (): Promise<StoreBoard> => request("/api/stores"),
  findNearby: (origin: Origin): Promise<StoreBoard> => request("/api/nearby", json("POST", origin)),
  forgetNearby: (): Promise<StoreBoard> => request("/api/nearby", { method: "DELETE" }),
  chat: (agent: AgentId, message: string, today: string): Promise<ChatReply> =>
    request(`/api/chat?today=${today}`, json("POST", { agent, message })),
  inventory: async (): Promise<InventoryItem[]> =>
    (await request<{ items: InventoryItem[] }>("/api/inventory")).items,
  saveInventory: async (items: InventoryItem[]): Promise<InventoryItem[]> =>
    (await request<{ items: InventoryItem[] }>("/api/inventory", json("PUT", { items }))).items,
  threat: (items: InventoryItem[]): Promise<Threat> => request("/api/threat", json("POST", { items })),
  scout: (photo: File): Promise<ScanResult> => request("/api/scout", { method: "POST", body: photoForm(photo) }),
  lastScan: (): Promise<ScanResult> => request("/api/scan/last"),
  mealPhoto: (photo: File): Promise<MealEstimate> => request("/api/meal-photo", { method: "POST", body: photoForm(photo) }),
  quote: (names: string[]): Promise<Quote[]> => request("/api/quote", json("POST", { names })),
  grocery: async (): Promise<GroceryItem[]> => (await request<{ items: GroceryItem[] }>("/api/grocery")).items,
  addGrocery: async (name: string): Promise<GroceryItem[]> =>
    (await request<{ items: GroceryItem[] }>("/api/grocery", json("POST", { name }))).items,
  saveGrocery: async (items: GroceryItem[]): Promise<GroceryItem[]> =>
    (await request<{ items: GroceryItem[] }>("/api/grocery", json("PUT", { items }))).items,
  demo: (): Promise<DemoState> => request("/api/demo"),
  setDemo: (on: boolean): Promise<DemoState> => request("/api/demo", json("PUT", { on })),
};
