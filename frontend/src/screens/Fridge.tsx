import { useState, type FormEvent } from "react";

import type { Kitchen } from "../hooks/useKitchen";
import { amountLabel, capitalize, daysLabel, isAtRisk, isPantry, listOf, plural, spriteFor } from "../lib/food";
import type { Go } from "../nav";
import { PixelEmoji } from "../pixel/PixelEmoji";
import { CATEGORIES, type Category, type InventoryItem } from "../types";
import { Button, Field, Icon, IconButton, ScreenHeader, SectionTitle, Sheet } from "../ui/kit";

type Filter = "all" | "soon" | "pantry";

type FridgeProps = {
  kitchen: Kitchen;
  go: Go;
  isAdding?: boolean;
  onPlan: () => void;
};

const NAMED_AT_ONCE = 3;

function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 12)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function blankItem(): InventoryItem {
  return { id: newId(), name: "", category: "produce", quantity: 1, unit: "unit", days_left: 5 };
}

function matches(filter: Filter, item: InventoryItem): boolean {
  if (filter === "soon") {
    return isAtRisk(item.days_left);
  }
  if (filter === "pantry") {
    return isPantry(item.days_left);
  }
  return true;
}

type ItemSheetProps = {
  item: InventoryItem;
  isNew: boolean;
  onSave: (item: InventoryItem) => void;
  onRemove: () => void;
  onClose: () => void;
};

function ItemSheet({ item, isNew, onSave, onRemove, onClose }: ItemSheetProps) {
  const [draft, setDraft] = useState(item);
  const isValid = draft.name.trim().length > 0 && draft.quantity > 0 && draft.unit.trim().length > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isValid) {
      onSave({ ...draft, name: draft.name.trim().toLowerCase(), unit: draft.unit.trim().toLowerCase() });
    }
  };

  return (
    <Sheet title={isNew ? "Add an ingredient" : `Edit ${item.name}`} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Name">
          <input
            value={draft.name}
            maxLength={60}
            autoFocus={isNew}
            placeholder="spinach"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>
        <div className="form-row">
          <Field label="Amount">
            <input
              type="number"
              inputMode="decimal"
              min={0.1}
              max={1000}
              step="any"
              value={draft.quantity}
              onChange={(event) => setDraft({ ...draft, quantity: Number(event.target.value) })}
            />
          </Field>
          <Field label="Unit">
            <input value={draft.unit} maxLength={20} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Days left">
            <input
              type="number"
              inputMode="numeric"
              min={-30}
              max={3650}
              value={draft.days_left}
              onChange={(event) => setDraft({ ...draft, days_left: Math.round(Number(event.target.value)) })}
            />
          </Field>
          <Field label="Kind">
            <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Category })}>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>{capitalize(category)}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-actions">
          {!isNew && <Button tone="paper" onClick={onRemove}>Remove</Button>}
          <Button type="submit" disabled={!isValid}>{isNew ? "Add to stash" : "Save changes"}</Button>
        </div>
      </form>
    </Sheet>
  );
}

export function Fridge({ kitchen, go, isAdding = false, onPlan }: FridgeProps) {
  const { inventory, threat, saveInventory, scanView } = kitchen;
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<InventoryItem | null>(isAdding ? blankItem() : null);
  const soon = inventory.filter((item) => isAtRisk(item.days_left));
  const pantry = inventory.filter((item) => isPantry(item.days_left));
  const shown = [...inventory].sort((a, b) => a.days_left - b.days_left).filter((item) => matches(filter, item));
  const isNew = editing !== null && !inventory.some((item) => item.id === editing.id);

  const handleSave = (item: InventoryItem) => {
    const next = isNew ? [...inventory, item] : inventory.map((entry) => (entry.id === item.id ? item : entry));
    void saveInventory(next);
    setEditing(null);
  };

  const handleRemove = () => {
    void saveInventory(inventory.filter((entry) => entry.id !== editing?.id));
    setEditing(null);
  };

  const addButton = <IconButton icon="plus" label="Add an ingredient" onClick={() => setEditing(blankItem())} />;
  const sheet = editing && (
    <ItemSheet key={editing.id} item={editing} isNew={isNew} onSave={handleSave} onRemove={handleRemove} onClose={() => setEditing(null)} />
  );

  if (inventory.length === 0) {
    return (
      <div className="screen">
        <ScreenHeader eyebrow="Your fridge" title="Nothing in the stash yet" action={addButton} />
        <section className="empty px-box">
          <PixelEmoji emoji="🧊" size={72} />
          <p>Scan your fridge and your party will list what is inside, with the food to use first on top.</p>
          <Button size="lg" icon="scan" isBlock onClick={() => go({ name: "scan" })}>Scan my fridge</Button>
        </section>
        {sheet}
      </div>
    );
  }

  const namedSoon = listOf(soon.slice(0, NAMED_AT_ONCE).map((item) => item.name));
  const filters: ReadonlyArray<{ id: Filter; label: string; tone: string }> = [
    { id: "all", label: `All ${inventory.length}`, tone: "mint" },
    { id: "soon", label: `Use soon ${soon.length}`, tone: "peach" },
    { id: "pantry", label: `Pantry ${pantry.length}`, tone: "paper" },
  ];

  return (
    <div className="screen has-cta">
      <ScreenHeader eyebrow="Scan review · 02" title="Look what we found!" onBack={() => go({ name: "scan" })} action={addButton} />

      {scanView && (
        <figure className="scan-photo px-box">
          <img src={scanView.photoUrl} alt="Your fridge photo" />
          {scanView.boxes.map((box, index) => (
            <span
              key={box.item_id}
              className="found-box"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
                animationDelay: `${index * 140}ms`,
              }}
            >
              <b>{capitalize(box.name)}</b>
            </span>
          ))}
          <figcaption>{`${plural(scanView.boxes.length, "item")} spotted in your photo`}</figcaption>
        </figure>
      )}

      <section className="summary px-box px-mint">
        <span className="summary-icon"><Icon name="scan" scale={3} /></span>
        <div>
          <h2>{`${inventory.length - pantry.length} found + ${plural(pantry.length, "pantry item")}`}</h2>
          <p>Check the amounts before your Chef gets cooking.</p>
        </div>
      </section>

      {soon.length > 0 && (
        <section className="notice px-box px-peach">
          <h2>{`${plural(soon.length, "ingredient")} ${soon.length === 1 ? "needs" : "need"} a little love`}</h2>
          <p>{`Use ${namedSoon}${soon.length > NAMED_AT_ONCE ? " and more" : ""} first. That is $${threat.waste_value_total.toFixed(2)} of food we can save.`}</p>
        </section>
      )}

      <SectionTitle title="Your ingredient stash" />
      <div className="chip-row" role="group" aria-label="Filter ingredients">
        {filters.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={`chip chip-${entry.tone} chip-button ${filter === entry.id ? "is-picked" : ""}`}
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <ul className="stash">
        {shown.map((item) => (
          <li key={item.id}>
            <button type="button" className="stash-row" aria-label={`Edit ${item.name}`} onClick={() => setEditing(item)}>
              <span className="tile"><PixelEmoji emoji={spriteFor(item)} size={36} /></span>
              <span className="stash-text">
                <strong>{capitalize(item.name)}</strong>
                <small>{`${amountLabel(item.quantity, item.unit, item.name)} · ${item.category}`}</small>
              </span>
              <span className={`days ${isAtRisk(item.days_left) ? "days-soon" : ""}`}>{daysLabel(item.days_left)}</span>
              <Icon name="pencil" scale={1.5} className="stash-edit" />
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="fineprint">Nothing in this group.</p>}
      <p className="fineprint">Freshness windows are estimates, not safety checks. Inspect food before eating.</p>

      <div className="cta-bar">
        <Button size="lg" icon="next" isBlock onClick={onPlan}>Confirm stash · find recipes</Button>
      </div>
      {sheet}
    </div>
  );
}
