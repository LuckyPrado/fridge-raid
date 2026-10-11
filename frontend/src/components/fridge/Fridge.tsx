import { useDraggable } from "@dnd-kit/core";

import { amount, daysLabel, isAtRisk, shelfOf, SHELVES, spriteFor } from "../../lib/sprites";
import type { InventoryItem } from "../../types";
import "./fridge.css";

interface SpriteProps {
  item: InventoryItem;
  inArena: boolean;
  locked: boolean;
  onToggle: (id: string) => void;
}

function IngredientSprite({ item, inArena, locked, onToggle }: SpriteProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled: locked });
  const risky = isAtRisk(item.days_left);
  const classes = [
    "sprite",
    risky ? "sprite--risky" : "",
    inArena ? "sprite--picked" : "",
    isDragging ? "sprite--dragging" : "",
  ];
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={classes.filter(Boolean).join(" ")}
      {...attributes}
      {...listeners}
      aria-pressed={inArena}
      aria-label={`${item.name}, ${amount(item.quantity, item.unit)}, ${daysLabel(item.days_left)}`}
      disabled={locked}
      onClick={() => onToggle(item.id)}
    >
      <span className="sprite__emoji" aria-hidden="true">
        {spriteFor(item)}
      </span>
      <span className="sprite__name">{item.name}</span>
      <span className="sprite__days">{daysLabel(item.days_left)}</span>
    </button>
  );
}

interface FridgeProps {
  inventory: InventoryItem[];
  arena: string[];
  locked: boolean;
  onToggle: (id: string) => void;
}

export function Fridge({ inventory, arena, locked, onToggle }: FridgeProps) {
  const picked = new Set(arena);
  return (
    <div className="fridge" aria-label="Fridge contents">
      <div className="fridge__bulb" aria-hidden="true" />
      {SHELVES.map((shelf) => {
        const items = inventory
          .filter((item) => shelfOf(item.category) === shelf.id)
          .sort((a, b) => a.days_left - b.days_left);
        return (
          <section key={shelf.id} className={`shelf shelf--${shelf.id}`} aria-label={shelf.label}>
            <ul className="shelf__items">
              {items.map((item) => (
                <li key={item.id}>
                  <IngredientSprite item={item} inArena={picked.has(item.id)} locked={locked} onToggle={onToggle} />
                </li>
              ))}
            </ul>
            <p className="shelf__label">{shelf.label}</p>
          </section>
        );
      })}
    </div>
  );
}
