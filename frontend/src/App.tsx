import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { Arena, ARENA_DROP_ID } from "./components/arena/Arena";
import { Fridge } from "./components/fridge/Fridge";
import { FridgePicker } from "./components/fridge/FridgePicker";
import { Hud } from "./components/hud/Hud";
import { DEFAULT_GOALS, GoalsPanel } from "./components/panels/GoalsPanel";
import { InventoryEditor } from "./components/panels/InventoryEditor";
import { WeekPlanPanel } from "./components/panels/WeekPlanPanel";
import { useKitchen } from "./hooks/useKitchen";
import { useRaid } from "./hooks/useRaid";
import { api, errorMessage } from "./lib/api";
import { money, spriteFor } from "./lib/sprites";
import type { DemoFridge, Goals, InventoryItem, RaidStat, StatusInfo } from "./types";

const DRAG_START_DISTANCE_PX = 6;

interface EditorSession {
  title: string;
  note?: string;
  items: InventoryItem[];
}

interface MastheadProps {
  status: StatusInfo | null;
  stats: RaidStat[];
  forceOffline: boolean;
  onToggleOffline: (value: boolean) => void;
}

function Masthead({ status, stats, forceOffline, onToggleOffline }: MastheadProps) {
  const isLive = status?.mode === "gemini" && !forceOffline;
  const saved = stats.reduce((total, stat) => total + stat.waste_value_saved, 0);
  const agentsLine = isLive ? `Agents run on ${status?.model}` : "Agents run offline, on built-in rules";
  return (
    <header className="masthead">
      <div>
        <h1 className="masthead__title">Fridge Raid</h1>
        <p className="masthead__tag">Your fridge is the dungeon. The enemy is food waste.</p>
      </div>
      <div className="masthead__meta">
        {stats.length > 0 ? (
          <p>
            {money(saved)} of food saved across {stats.length} raid{stats.length === 1 ? "" : "s"}
          </p>
        ) : null}
        <p>{agentsLine}</p>
        {status?.mode === "gemini" ? (
          <label className="switch">
            <input type="checkbox" checked={forceOffline} onChange={(event) => onToggleOffline(event.target.checked)} />
            Use offline agents
          </label>
        ) : null}
      </div>
    </header>
  );
}

export function App() {
  const kitchen = useKitchen();
  const { raid, start, skip, reset } = useRaid();
  const [arena, setArena] = useState<string[]>([]);
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [forceOffline, setForceOffline] = useState(false);
  const [editor, setEditor] = useState<EditorSession | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState<InventoryItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_START_DISTANCE_PX } }));

  const { inventory } = kitchen;
  const isIdle = raid.phase === "idle";
  const picked = inventory.filter((item) => arena.includes(item.id));

  const replaceFridge = (items: InventoryItem[]) => {
    reset();
    setArena([]);
    setNotice(null);
    void kitchen.saveInventory(items);
  };

  const handleToggle = (id: string) =>
    setArena((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const handleDragStart = (event: DragStartEvent) =>
    setDragging(inventory.find((item) => item.id === event.active.id) ?? null);

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const id = String(event.active.id);
    if (event.over?.id === ARENA_DROP_ID) {
      setArena((current) => (current.includes(id) ? current : [...current, id]));
    }
  };

  const handleScan = async (photo: File) => {
    setIsScanning(true);
    try {
      const items = await api.scout(photo);
      setEditor({
        title: items.length > 0 ? "Check what the Scout found" : "The Scout found no food",
        note: "Photo scans miss things. Fix anything that looks wrong before you raid.",
        items,
      });
    } catch (error: unknown) {
      kitchen.reportProblem(errorMessage(error));
    } finally {
      setIsScanning(false);
    }
  };

  const handleAccept = async () => {
    if (!raid.plan) {
      return;
    }
    setIsSaving(true);
    try {
      const result = await api.acceptPlan(inventory, raid.plan);
      kitchen.adoptInventory(result.items);
      await kitchen.refreshStats();
      setNotice(`Plan accepted. ${money(result.stat.waste_value_saved)} of food saved and the fridge is updated.`);
      setArena([]);
      reset();
    } catch (error: unknown) {
      kitchen.reportProblem(`The plan was not saved. ${errorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="app">
        <Masthead
          status={kitchen.status}
          stats={kitchen.stats}
          forceOffline={forceOffline}
          onToggleOffline={setForceOffline}
        />

        {kitchen.problem ? (
          <p className="banner banner--bad" role="alert">
            {kitchen.problem}
            <button type="button" onClick={kitchen.clearProblem}>
              Dismiss
            </button>
          </p>
        ) : null}
        {notice ? (
          <p className="banner banner--good" role="status">
            {notice}
            <button type="button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </p>
        ) : null}

        <Hud
          bossMax={isIdle ? kitchen.threat.waste_value_total : raid.bossMax}
          bossHp={isIdle ? kitchen.threat.waste_value_total : raid.bossHp}
          atRiskCount={kitchen.threat.at_risk.length}
          spent={raid.spent}
          budget={goals.budget}
          strikes={raid.strikes}
          settled={raid.phase === "settled"}
        />

        <FridgePicker
          fridges={kitchen.fridges}
          canScan={kitchen.status?.mode === "gemini"}
          scanning={isScanning}
          locked={!isIdle}
          hasItems={inventory.length > 0}
          onPick={(fridge: DemoFridge) => replaceFridge(fridge.items)}
          onScan={(photo) => void handleScan(photo)}
          onEdit={() => setEditor({ title: "Edit fridge contents", items: inventory })}
        />

        <main className="board">
          <section className="board__fridge" aria-label="Fridge">
            {inventory.length > 0 ? (
              <Fridge inventory={inventory} arena={arena} locked={!isIdle} onToggle={handleToggle} />
            ) : (
              <p className="board__empty">
                {kitchen.loading ? "Opening the fridge…" : "The fridge is empty. Pick a demo fridge above to start."}
              </p>
            )}
          </section>

          <div className="board__stage">
            <Arena
              raid={raid}
              picked={picked}
              canStart={inventory.length > 0}
              onRemove={handleToggle}
              onStart={() => void start({ inventory, arena, goals, offline: forceOffline })}
              onSkip={skip}
            />
            {isIdle ? <GoalsPanel goals={goals} onChange={setGoals} /> : null}
            {raid.phase === "settled" && raid.plan ? (
              <WeekPlanPanel plan={raid.plan} isSaving={isSaving} onAccept={() => void handleAccept()} onRetry={reset} />
            ) : null}
            {raid.phase === "failed" ? (
              <section className="plan plan--empty" role="alert">
                <h2 className="plan__title">The raid was interrupted</h2>
                <p>{raid.error}</p>
                <button type="button" className="button button--light" onClick={reset}>
                  Back to the fridge
                </button>
              </section>
            ) : null}
          </div>
        </main>

        <DragOverlay dropAnimation={null}>
          {dragging ? <span className="drag-ghost">{spriteFor(dragging)}</span> : null}
        </DragOverlay>

        {editor ? (
          <InventoryEditor
            title={editor.title}
            note={editor.note}
            initial={editor.items}
            onCancel={() => setEditor(null)}
            onSave={(items) => {
              setEditor(null);
              replaceFridge(items);
            }}
          />
        ) : null}
      </div>
    </DndContext>
  );
}
