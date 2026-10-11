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
  chat: (agent: AgentId, message: string): Promise<ChatReply> => request("/api/chat", json("POST", { agent, message })),
  inventory: async (): Promise<InventoryItem[]> =>
    (await request<{ items: InventoryItem[] }>("/api/inventory")).items,
  saveInventory: async (items: InventoryItem[]): Promise<InventoryItem[]> =>
    (await request<{ items: InventoryItem[] }>("/api/inventory", json("PUT", { items }))).items,
  threat: (items: InventoryItem[]): Promise<Threat> => request("/api/threat", json("POST", { items })),
  scout: async (photo: File): Promise<InventoryItem[]> => {
    const form = new FormData();
    form.append("photo", photo);
    return (await request<{ items: InventoryItem[] }>("/api/scout", { method: "POST", body: form })).items;
  },
};
