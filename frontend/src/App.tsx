import { useCallback, useEffect, useRef, useState } from "react";

import { useKitchen } from "./hooks/useKitchen";
import { useRaid } from "./hooks/useRaid";
import { TABS, tabOf, type Screen, type TabId } from "./nav";
import type { ChatMessage } from "./types";
import { AGENT_SPRITES, SPRITE_OUTLINE } from "./pixel/art";
import { PixelSprite } from "./pixel/PixelSprite";
import { Chat } from "./screens/Chat";
import { Chef } from "./screens/Chef";
import { Fridge } from "./screens/Fridge";
import { Goals } from "./screens/Goals";
import { Home } from "./screens/Home";
import { Huddle } from "./screens/Huddle";
import { Plan } from "./screens/Plan";
import { Recipe } from "./screens/Recipe";
import { Scan } from "./screens/Scan";
import { Shop } from "./screens/Shop";
import { Button, Icon, IconButton } from "./ui/kit";

const TOAST_MS = 2600;
const SCREEN_KEY = "fridge-raid:screen";
const SCREEN_NAMES: readonly string[] = ["home", "scan", "fridge", "huddle", "chef", "recipe", "goals", "shop", "plan", "chat"];

/** Phones reload a page that was left in the background. Remember the screen so the player lands where they were. */
function restoreScreen(): Screen {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(SCREEN_KEY) ?? "null");
    if (typeof stored === "object" && stored !== null) {
      const { name, dishId } = stored as { name?: unknown; dishId?: unknown };
      if (name === "recipe" && typeof dishId === "string") {
        return { name, dishId };
      }
      if (typeof name === "string" && name !== "recipe" && SCREEN_NAMES.includes(name)) {
        return { name } as Screen;
      }
    }
  } catch {
    // Storage is blocked or holds something unreadable. Start on Home.
  }
  return { name: "home" };
}

function rememberScreen(screen: Screen): void {
  try {
    window.sessionStorage.setItem(SCREEN_KEY, JSON.stringify(screen));
  } catch {
    // Private browsing can block storage. The app still works without it.
  }
}

export function App() {
  const kitchen = useKitchen();
  const raid = useRaid();
  const [screen, setScreen] = useState<Screen>(restoreScreen);
  const [toast, setToast] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const toastTimer = useRef<number | null>(null);
  const { reloadPlan } = kitchen;
  const raidPhase = raid.raid.phase;

  const go = useCallback((next: Screen) => {
    setScreen(next);
    rememberScreen(next);
    window.scrollTo({ top: 0 });
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
  }, []);

  // The server saves the settled plan. Pull it so the Chef and Shop tabs show the same thing after a reload.
  useEffect(() => {
    if (raidPhase === "settled") {
      void reloadPlan();
      // If the phone reloads the page now, land on the finished recipes instead of planning again.
      rememberScreen({ name: "chef" });
    }
  }, [raidPhase, reloadPlan]);

  const startPlanning = () => {
    if (kitchen.inventory.length === 0) {
      go({ name: "scan" });
      return;
    }
    void raid.start({ inventory: kitchen.inventory, arena: [], goals: kitchen.profile.goals, offline: false });
    go({ name: "huddle" });
  };

  // After a reload in the middle of planning there is no plan in progress any more, so start it again.
  const hasResumed = useRef(false);
  useEffect(() => {
    if (!kitchen.hasLoaded || hasResumed.current) {
      return;
    }
    hasResumed.current = true;
    if (screen.name === "huddle" && raidPhase === "idle") {
      startPlanning();
    }
    // Runs once, when the first load finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitchen.hasLoaded]);

  const handleTab = (tab: TabId) => go({ name: tab });
  const activeTab = tabOf(screen.name);

  if (kitchen.isLoading) {
    return (
      <div className="phone">
        <div className="loading" role="status">
          <PixelSprite sprite={AGENT_SPRITES.chef} scale={5} outline={SPRITE_OUTLINE} />
          <p>Waking up your party</p>
        </div>
      </div>
    );
  }

  if (!kitchen.hasLoaded) {
    return (
      <div className="phone">
        <div className="loading" role="alert">
          <PixelSprite sprite={AGENT_SPRITES.chef} scale={5} outline={SPRITE_OUTLINE} />
          <p>{kitchen.problem ?? "The kitchen did not load."}</p>
          <Button onClick={() => window.location.reload()}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`phone ${activeTab === null ? "is-immersive" : ""}`}>
      {kitchen.problem && (
        <div className="problem" role="alert">
          <p>{kitchen.problem}</p>
          <IconButton icon="close" label="Dismiss" tone="plain" onClick={kitchen.clearProblem} />
        </div>
      )}

      <main>
        {screen.name === "home" && <Home kitchen={kitchen} go={go} />}
        {screen.name === "scan" && <Scan kitchen={kitchen} go={go} />}
        {screen.name === "fridge" && <Fridge kitchen={kitchen} go={go} isAdding={screen.isAdding} onPlan={startPlanning} />}
        {screen.name === "huddle" && <Huddle raid={raid} go={go} onRetry={startPlanning} />}
        {screen.name === "chef" && <Chef kitchen={kitchen} go={go} onPlan={startPlanning} />}
        {screen.name === "recipe" && <Recipe kitchen={kitchen} dishId={screen.dishId} go={go} notify={notify} />}
        {screen.name === "goals" && <Goals kitchen={kitchen} go={go} />}
        {screen.name === "shop" && <Shop kitchen={kitchen} go={go} onPlan={startPlanning} />}
        {screen.name === "chat" && (
          <Chat kitchen={kitchen} go={go} agent={screen.agent} messages={messages} onMessages={setMessages} onPlan={startPlanning} />
        )}
        {screen.name === "plan" && <Plan kitchen={kitchen} go={go} />}
      </main>

      {toast && <p className="toast" role="status">{toast}</p>}

      {activeTab !== null && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={`tab ${tab.id === activeTab ? "is-active" : ""}`}
              aria-current={tab.id === activeTab ? "page" : undefined}
              onClick={() => handleTab(tab.id)}
            >
              <span className="tab-icon"><Icon name={tab.icon} /></span>
              {tab.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
