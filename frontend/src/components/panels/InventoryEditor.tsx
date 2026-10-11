import { useState } from "react";

import { CATEGORIES, type Category, type InventoryItem } from "../../types";
import "./panels.css";

interface Row {
  id: string;
  name: string;
  category: Category;
  quantity: string;
  unit: string;
  days_left: string;
}

const MAX_QUANTITY = 1000;
const MAX_DAYS = 3650;
const MIN_DAYS = -30;

function toRow(item: InventoryItem): Row {
  return { ...item, quantity: String(item.quantity), days_left: String(item.days_left) };
}

/** crypto.randomUUID is missing on non-secure origins, such as a LAN address over http. */
function newRowId(): string {
  const random = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return random.replace(/[^a-z0-9]/gi, "").slice(0, 12);
}

function blankRow(): Row {
  return { id: newRowId(), name: "", category: "produce", quantity: "1", unit: "unit", days_left: "5" };
}

/** Convert edited rows to inventory. Returns the first problem found instead of items. */
export function rowsToItems(rows: Row[]): { items: InventoryItem[] } | { problem: string } {
  const items: InventoryItem[] = [];
  for (const row of rows) {
    const name = row.name.trim().toLowerCase();
    if (!name) {
      continue;
    }
    const quantity = Number(row.quantity);
    const days = Number(row.days_left);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      return { problem: `Enter an amount above 0 for ${name}.` };
    }
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      return { problem: `Enter whole days left for ${name}.` };
    }
    items.push({ id: row.id, name, category: row.category, quantity, unit: row.unit.trim() || "unit", days_left: days });
  }
  return { items };
}

interface InventoryEditorProps {
  title: string;
  note?: string;
  initial: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
  onCancel: () => void;
}

export function InventoryEditor({ title, note, initial, onSave, onCancel }: InventoryEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => (initial.length > 0 ? initial.map(toRow) : [blankRow()]));
  const [problem, setProblem] = useState<string | null>(null);

  const patch = (id: string, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)));

  const handleSave = () => {
    const result = rowsToItems(rows);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    onSave(result.items);
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <div className="modal__sheet">
        <h2 id="editor-title" className="modal__title">
          {title}
        </h2>
        {note ? <p className="modal__note">{note}</p> : null}
        <div className="editor" role="group" aria-label="Fridge contents">
          {rows.map((row) => (
            <div className="editor__row" key={row.id}>
              <input
                aria-label="Food"
                placeholder="Food"
                value={row.name}
                maxLength={60}
                onChange={(event) => patch(row.id, { name: event.target.value })}
              />
              <input
                aria-label="Amount"
                type="number"
                min="0"
                step="0.5"
                value={row.quantity}
                onChange={(event) => patch(row.id, { quantity: event.target.value })}
              />
              <input
                aria-label="Unit"
                value={row.unit}
                maxLength={20}
                onChange={(event) => patch(row.id, { unit: event.target.value })}
              />
              <input
                aria-label="Days left"
                type="number"
                step="1"
                value={row.days_left}
                onChange={(event) => patch(row.id, { days_left: event.target.value })}
              />
              <select
                aria-label="Category"
                value={row.category}
                onChange={(event) => patch(row.id, { category: event.target.value as Category })}
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="editor__remove"
                aria-label={`Remove ${row.name || "row"}`}
                onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <p className="editor__legend">Columns: food, amount, unit, days left, category.</p>
        {problem ? (
          <p className="modal__problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={() => setRows((current) => [...current, blankRow()])}>
            Add a row
          </button>
          <span className="modal__spacer" />
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button--light" onClick={handleSave}>
            Save fridge
          </button>
        </div>
      </div>
    </div>
  );
}
