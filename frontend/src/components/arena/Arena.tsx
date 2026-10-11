import { useDroppable } from "@dnd-kit/core";
import { AnimatePresence } from "framer-motion";

import type { RaidState } from "../../lib/raid";
import { spriteFor } from "../../lib/sprites";
import type { InventoryItem } from "../../types";
import { DishCard } from "./DishCard";
import { Party } from "./Party";
import "./arena.css";

export const ARENA_DROP_ID = "arena";

interface DropZoneProps {
  picked: InventoryItem[];
  onRemove: (id: string) => void;
}

function DropZone({ picked, onRemove }: DropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: ARENA_DROP_ID });
  return (
    <div ref={setNodeRef} className={`dropzone${isOver ? " dropzone--over" : ""}`}>
      {picked.length === 0 ? (
        <p className="dropzone__hint">
          Drag food here to force the Chef to cook with it. Leave it empty and the party picks what is closest to
          spoiling.
        </p>
      ) : (
        <ul className="dropzone__items" aria-label="Food the Chef must use">
          {picked.map((item) => (
            <li key={item.id}>
              <button type="button" className="chip" onClick={() => onRemove(item.id)}>
                <span aria-hidden="true">{spriteFor(item)}</span> {item.name}
                <span className="chip__x" aria-hidden="true">
                  ×
                </span>
                <span className="visually-hidden">Remove from arena</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ArenaProps {
  raid: RaidState;
  picked: InventoryItem[];
  canStart: boolean;
  onRemove: (id: string) => void;
  onStart: () => void;
  onSkip: () => void;
}

export function Arena({ raid, picked, canStart, onRemove, onStart, onSkip }: ArenaProps) {
  const isRaiding = raid.phase === "raiding";
  const isIdle = raid.phase === "idle";
  const plannedIds = raid.plan ? new Set(raid.plan.dishes.map((dish) => dish.id)) : null;

  return (
    <section className="arena" aria-label="Cooking arena">
      <Party bubbles={raid.bubbles} speaker={raid.speaker} isRaiding={isRaiding} />

      {isIdle ? (
        <>
          <DropZone picked={picked} onRemove={onRemove} />
          <button type="button" className="button button--raid" disabled={!canStart} onClick={onStart}>
            Start the raid
          </button>
        </>
      ) : null}

      {raid.notes.length > 0 ? (
        <ul className="arena__notes">
          {raid.notes.map((note, index) => (
            <li key={`${index}-${note}`}>{note}</li>
          ))}
        </ul>
      ) : null}

      {!isIdle ? (
        <ul className="dishes" aria-label="Dishes on the table">
          <AnimatePresence initial={false}>
            {raid.dishes.map((entry) => (
              <DishCard
                key={entry.dish.id}
                entry={entry}
                isInPlan={plannedIds ? plannedIds.has(entry.dish.id) : null}
              />
            ))}
          </AnimatePresence>
        </ul>
      ) : null}

      {isRaiding ? (
        <button type="button" className="button button--ghost-dark arena__skip" onClick={onSkip}>
          Skip to the result
        </button>
      ) : null}
    </section>
  );
}
