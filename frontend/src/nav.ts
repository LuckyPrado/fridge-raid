import type { IconName } from "./pixel/art";

export type Screen =
  | { name: "home" }
  | { name: "scan" }
  | { name: "fridge"; isAdding?: boolean }
  | { name: "huddle" }
  | { name: "chef" }
  | { name: "recipe"; dishId: string }
  | { name: "goals" }
  | { name: "shop" }
  | { name: "plan" };

export type ScreenName = Screen["name"];
export type Go = (screen: Screen) => void;

export type TabId = "home" | "fridge" | "chef" | "goals" | "shop";

export const TABS: ReadonlyArray<{ id: TabId; label: string; icon: IconName }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "fridge", label: "Fridge", icon: "fridge" },
  { id: "chef", label: "Chef", icon: "chef" },
  { id: "goals", label: "Goals", icon: "heart" },
  { id: "shop", label: "Shop", icon: "basket" },
];

const TAB_OF_SCREEN: Record<ScreenName, TabId | null> = {
  home: "home",
  scan: null,
  fridge: "fridge",
  huddle: null,
  chef: "chef",
  recipe: "chef",
  goals: "goals",
  shop: "shop",
  plan: "shop",
};

/** The tab to highlight for a screen, or null for full-screen flows that hide the tab bar. */
export function tabOf(screen: ScreenName): TabId | null {
  return TAB_OF_SCREEN[screen];
}
