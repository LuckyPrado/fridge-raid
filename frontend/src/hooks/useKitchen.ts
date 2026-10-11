import { useCallback, useEffect, useState } from "react";

import { api, errorMessage, scanPhotoUrl } from "../lib/api";
import { preparePhoto } from "../lib/photo";
import { localDay } from "../lib/plan";
import type {
  CookResult,
  DaySummary,
  DemoFridge,
  DemoState,
  GroceryItem,
  MealEstimate,
  ScanView,
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
const NO_PLAN: SavedPlan = { plan: null, cooked: [], bought: [] };
const NO_PROGRESS: Progress = { xp: 0, level: 1, streak: 0, meals_cooked: 0, items_rescued: 0 };

export const DEFAULT_PROFILE: Profile = {
  name: "",
  onboarded: false,
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
  /** Take a recipe out of the plan. Resolves to whether it worked. */
  removeDish: (dishId: string) => Promise<boolean>;
  logFood: (entry: FoodLogInput) => Promise<boolean>;
  setWater: (glasses: number) => Promise<void>;
  /** Ask the phone for its location and switch the Shopper to real stores nearby. Returns a problem message or null. */
  shareLocation: () => Promise<string | null>;
  clearLocation: () => Promise<void>;
  chat: (agent: AgentId, message: string) => Promise<ChatReply | null>;
  /** Erase everything saved and reload the app as a first-time player. */
  startOver: () => Promise<void>;
  /** The fridge photo and the boxes around what was found, after a photo scan. */
  scanView: ScanView | null;
  /** Read a fridge photo into the stash. Returns a problem message, or null when it worked. */
  scanFridge: (photo: File) => Promise<string | null>;
  clearScanView: () => void;
  estimateMeal: (photo: File) => Promise<MealEstimate | null>;
  grocery: GroceryItem[];
  addGrocery: (name: string) => Promise<void>;
  removeGrocery: (name: string) => Promise<void>;
  /** The player bought these shopping lines. They go into the fridge so recipes can use them. */
  markBought: (names: string[]) => Promise<void>;
  /** The player bought one item from their own grocery list. */
  gotGrocery: (name: string) => Promise<void>;
  demo: DemoState;
  setDemo: (on: boolean) => Promise<void>;
}

const SCAN_SHOWN_KEY = "fridge-raid:scan-shown";
const NO_DEMO: DemoState = { on: false, has_scan: false, has_meal: false };

function rememberScanShown(isShown: boolean): void {
  try {
    if (isShown) {
      window.sessionStorage.setItem(SCAN_SHOWN_KEY, "1");
    } else {
      window.sessionStorage.removeItem(SCAN_SHOWN_KEY);
    }
  } catch {
    // Storage can be blocked. The photo then just does not come back after a reload.
  }
}

function wasScanShown(): boolean {
  try {
    return window.sessionStorage.getItem(SCAN_SHOWN_KEY) === "1";
  } catch {
    return false;
  }
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
  const [scanView, setScanView] = useState<ScanView | null>(null);
  const [grocery, setGrocery] = useState<GroceryItem[]>([]);
  const [demo, setDemoState] = useState<DemoState>(NO_DEMO);

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
      api.grocery(),
      api.demo(),
    ])
      .then(([nextStatus, nextFridges, nextStores, items, nextProfile, plan, nextDay, nextProgress, nextGrocery, nextDemo]) => {
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
        setGrocery(nextGrocery);
        setDemoState(nextDemo);
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

  const removeDish = useCallback(async (dishId: string) => {
    try {
      setSaved(await api.removeDish(dishId));
      return true;
    } catch (error: unknown) {
      setProblem(`That recipe was not removed. ${errorMessage(error)}`);
      return false;
    }
  }, []);

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
      const reply = await api.chat(agent, message, today);
      setProfile(reply.profile);
      if (reply.changes.length > 0) {
        await Promise.all([
          refresh(() => api.grocery(), setGrocery),
          refresh(() => api.day(today), setDay),
          refresh(() => api.plan(), setSaved),
        ]);
      }
      return reply;
    } catch (error: unknown) {
      setProblem(errorMessage(error));
      return null;
    }
  }, [today]);

  const startOver = useCallback(async () => {
    try {
      await api.reset();
    } catch (error: unknown) {
      setProblem(`Nothing was erased. ${errorMessage(error)}`);
      return;
    }
    try {
      window.sessionStorage.clear();
      window.localStorage.clear();
    } catch {
      // Storage can be blocked. The server data is already gone, which is what matters.
    }
    window.location.reload();
  }, []);

  // After a reload, bring back the highlighted fridge photo if one was on screen.
  useEffect(() => {
    if (!hasLoaded || !wasScanShown()) {
      return;
    }
    let isCancelled = false;
    api
      .lastScan()
      .then((scan) => !isCancelled && scan.has_photo && setScanView({ photoUrl: scanPhotoUrl(Date.now()), boxes: scan.boxes }))
      .catch(() => rememberScanShown(false));
    return () => {
      isCancelled = true;
    };
  }, [hasLoaded]);

  const clearScanView = useCallback(() => {
    setScanView(null);
    rememberScanShown(false);
  }, []);

  const scanFridge = useCallback(async (photo: File) => {
    try {
      const scan = await api.scout(await preparePhoto(photo));
      if (scan.items.length === 0) {
        return "No food found in that photo. Open the door wide and try again.";
      }
      setInventory(scan.items);
      await api.saveInventory(scan.items);
      setScanView(scan.has_photo ? { photoUrl: scanPhotoUrl(Date.now()), boxes: scan.boxes } : null);
      rememberScanShown(scan.has_photo);
      await refresh(() => api.demo(), setDemoState);
      return null;
    } catch (error: unknown) {
      return errorMessage(error);
    }
  }, []);

  const estimateMeal = useCallback(async (photo: File) => {
    try {
      return await api.mealPhoto(await preparePhoto(photo));
    } catch (error: unknown) {
      setProblem(errorMessage(error));
      return null;
    }
  }, []);

  const addGrocery = useCallback(async (name: string) => {
    try {
      setGrocery(await api.addGrocery(name));
    } catch (error: unknown) {
      setProblem(`That was not added to your list. ${errorMessage(error)}`);
    }
  }, []);

  const removeGrocery = useCallback(async (name: string) => {
    try {
      const current = await api.grocery();
      setGrocery(await api.saveGrocery(current.filter((item) => item.name !== name)));
    } catch (error: unknown) {
      setProblem(errorMessage(error));
    }
  }, []);

  const markBought = useCallback(async (names: string[]) => {
    if (names.length === 0) {
      return;
    }
    try {
      const result = await api.bought(names);
      setInventory(result.items);
      setSaved(result.saved);
    } catch (error: unknown) {
      setProblem(`That was not saved. ${errorMessage(error)}`);
    }
  }, []);

  const gotGrocery = useCallback(async (name: string) => {
    try {
      const result = await api.groceryBought(name);
      setInventory(result.items);
      setGrocery(result.grocery.items);
    } catch (error: unknown) {
      setProblem(`That was not saved. ${errorMessage(error)}`);
    }
  }, []);

  const setDemo = useCallback(async (on: boolean) => {
    try {
      setDemoState(await api.setDemo(on));
      setStatus(await api.status());
    } catch (error: unknown) {
      setProblem(errorMessage(error));
    }
  }, []);

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
    removeDish,
    logFood,
    setWater,
    shareLocation,
    clearLocation,
    chat,
    startOver,
    scanView,
    scanFridge,
    clearScanView,
    estimateMeal,
    grocery,
    addGrocery,
    removeGrocery,
    markBought,
    gotGrocery,
    demo,
    setDemo,
  };
}
