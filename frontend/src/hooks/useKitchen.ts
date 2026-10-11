import { useCallback, useEffect, useState } from "react";

import { api, errorMessage } from "../lib/api";
import { localDay } from "../lib/plan";
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
  StoreDeals,
  Threat,
} from "../types";

const NO_THREAT: Threat = { waste_value_total: 0, at_risk: [] };
const NO_PLAN: SavedPlan = { plan: null, cooked: [] };
const NO_PROGRESS: Progress = { xp: 0, level: 1, streak: 0, meals_cooked: 0, items_rescued: 0 };

export const DEFAULT_PROFILE: Profile = {
  name: "",
  goals: {
    budget: 25,
    diet: "none",
    max_calories: 800,
    max_sodium_mg: 900,
    min_protein_g: 15,
    meals: 4,
    favorites: [],
    avoid: [],
    daily_calories: 1800,
    daily_protein_g: 100,
  },
};

function emptyDay(day: string): DaySummary {
  return { day, entries: [], water: 0, calories: 0, protein_g: 0, sodium_mg: 0, coach: "" };
}

/** Re-read a value after a successful save. A failed refresh keeps the old value and is not an error. */
async function refresh<T>(load: () => Promise<T>, apply: (value: T) => void): Promise<void> {
  try {
    apply(await load());
  } catch {
    // The save itself succeeded. The next load picks up the fresh value.
  }
}

export interface Kitchen {
  isLoading: boolean;
  /** False when the first load failed. Nothing may be saved then, or defaults would overwrite real data. */
  hasLoaded: boolean;
  today: string;
  status: StatusInfo | null;
  fridges: DemoFridge[];
  stores: StoreDeals[];
  /** Where the real store search was centered, or null while the sample stores are in use. */
  origin: Origin | null;
  inventory: InventoryItem[];
  threat: Threat;
  profile: Profile;
  saved: SavedPlan;
  day: DaySummary;
  progress: Progress;
  problem: string | null;
  clearProblem: () => void;
  reportProblem: (message: string) => void;
  saveInventory: (items: InventoryItem[]) => Promise<void>;
  saveProfile: (profile: Profile) => Promise<boolean>;
  reloadPlan: () => Promise<void>;
  cook: (dishId: string) => Promise<CookResult | null>;
  logFood: (entry: FoodLogInput) => Promise<boolean>;
  setWater: (glasses: number) => Promise<void>;
  /** Ask the phone for its location and switch the Shopper to real stores nearby. Returns a problem message or null. */
  shareLocation: () => Promise<string | null>;
  clearLocation: () => Promise<void>;
  chat: (agent: AgentId, message: string) => Promise<ChatReply | null>;
}

const LOCATION_TIMEOUT_MS = 12000;

function currentPosition(): Promise<Origin> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      reject(new Error("Location needs the secure https address. Open the app with https and try again."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? "Location is blocked for this site. On iPhone: Settings, Privacy & Security, Location Services, Safari Websites, then choose While Using the App. Reload and try again."
              : "Your phone could not find its location. Try again near a window.",
          ),
        ),
      { enableHighAccuracy: false, timeout: LOCATION_TIMEOUT_MS, maximumAge: 300000 },
    );
  });
}

/** Server-backed state for the whole app: fridge, profile, plan, today's log, and progress. */
export function useKitchen(): Kitchen {
  const [today] = useState(() => localDay(new Date()));
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [fridges, setFridges] = useState<DemoFridge[]>([]);
  const [stores, setStores] = useState<StoreDeals[]>([]);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [threat, setThreat] = useState<Threat>(NO_THREAT);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [saved, setSaved] = useState<SavedPlan>(NO_PLAN);
  const [day, setDay] = useState<DaySummary>(() => emptyDay(today));
  const [progress, setProgress] = useState<Progress>(NO_PROGRESS);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    Promise.all([
      api.status(),
      api.demoFridges(),
      api.stores(),
      api.inventory(),
      api.profile(),
      api.plan(),
      api.day(today),
      api.progress(today),
    ])
      .then(([nextStatus, nextFridges, nextStores, items, nextProfile, plan, nextDay, nextProgress]) => {
        if (isCancelled) {
          return;
        }
        setStatus(nextStatus);
        setFridges(nextFridges);
        setStores(nextStores.stores);
        setOrigin(nextStores.origin);
        setInventory(items);
        setProfile(nextProfile);
        setSaved(plan);
        setDay(nextDay);
        setProgress(nextProgress);
        setHasLoaded(true);
      })
      .catch((error: unknown) => !isCancelled && setProblem(errorMessage(error)))
      .finally(() => !isCancelled && setIsLoading(false));
    return () => {
      isCancelled = true;
    };
  }, [today]);

  useEffect(() => {
    if (inventory.length === 0) {
      setThreat(NO_THREAT);
      return;
    }
    let isCancelled = false;
    api
      .threat(inventory)
      .then((next) => !isCancelled && setThreat(next))
      .catch((error: unknown) => !isCancelled && setProblem(errorMessage(error)));
    return () => {
      isCancelled = true;
    };
  }, [inventory]);

  const saveInventory = useCallback(async (items: InventoryItem[]) => {
    setInventory(items);
    try {
      await api.saveInventory(items);
    } catch (error: unknown) {
      setProblem(`Your stash was not saved. ${errorMessage(error)}`);
    }
  }, []);

  const saveProfile = useCallback(async (next: Profile) => {
    try {
      setProfile(await api.saveProfile(next));
    } catch (error: unknown) {
      setProblem(`Your goals were not saved. ${errorMessage(error)}`);
      return false;
    }
    await refresh(() => api.day(today), setDay);
    return true;
  }, [today]);

  const reloadPlan = useCallback(async () => {
    try {
      const [plan, nextDay] = await Promise.all([api.plan(), api.day(today)]);
      setSaved(plan);
      setDay(nextDay);
    } catch (error: unknown) {
      setProblem(errorMessage(error));
    }
  }, [today]);

  const cook = useCallback(async (dishId: string) => {
    try {
      const result = await api.cook(dishId, today);
      setInventory(result.items);
      setSaved(result.saved);
      setDay(result.day);
      await refresh(() => api.progress(today), setProgress);
      return result;
    } catch (error: unknown) {
      setProblem(errorMessage(error));
      return null;
    }
  }, [today]);

  const logFood = useCallback(async (entry: FoodLogInput) => {
    try {
      setDay(await api.logFood(today, entry));
    } catch (error: unknown) {
      setProblem(`That food was not logged. ${errorMessage(error)}`);
      return false;
    }
    await refresh(() => api.progress(today), setProgress);
    return true;
  }, [today]);

  const setWater = useCallback(async (glasses: number) => {
    setDay((current) => ({ ...current, water: glasses }));
    try {
      setDay(await api.setWater(today, glasses));
    } catch (error: unknown) {
      setProblem(`Your water count was not saved. ${errorMessage(error)}`);
    }
  }, [today]);

  const shareLocation = useCallback(async () => {
    try {
      const board = await api.findNearby(await currentPosition());
      setStores(board.stores);
      setOrigin(board.origin);
      return null;
    } catch (error: unknown) {
      return errorMessage(error);
    }
  }, []);

  const clearLocation = useCallback(async () => {
    try {
      const board = await api.forgetNearby();
      setStores(board.stores);
      setOrigin(board.origin);
    } catch (error: unknown) {
      setProblem(errorMessage(error));
    }
  }, []);

  const chat = useCallback(async (agent: AgentId, message: string) => {
    try {
      const reply = await api.chat(agent, message);
      setProfile(reply.profile);
      if (reply.changes.length > 0) {
        await refresh(() => api.day(today), setDay);
      }
      return reply;
    } catch (error: unknown) {
      setProblem(errorMessage(error));
      return null;
    }
  }, [today]);

  return {
    isLoading,
    hasLoaded,
    today,
    status,
    fridges,
    stores,
    origin,
    inventory,
    threat,
    profile,
    saved,
    day,
    progress,
    problem,
    clearProblem: useCallback(() => setProblem(null), []),
    reportProblem: setProblem,
    saveInventory,
    saveProfile,
    reloadPlan,
    cook,
    logFood,
    setWater,
    shareLocation,
    clearLocation,
    chat,
  };
}
