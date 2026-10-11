import { useState } from "react";

import type { Kitchen } from "../hooks/useKitchen";
import { capitalize, listOf, money, packLabel, plural } from "../lib/food";
import { checkIngredients, dayTag, dishesUsing, filledSegments, isDeal, readiness } from "../lib/plan";
import type { Go } from "../nav";
import { PixelEmoji } from "../pixel/PixelEmoji";
import type { Dish, InventoryItem } from "../types";
import { AgentBubble, Button, Chip, Icon, ScreenHeader, SectionTitle, SegBar } from "../ui/kit";

const BUDGET_SEGMENTS = 10;
const DAY_TONES = ["peach", "mint", "butter"] as const;

type PlanProps = {
  kitchen: Kitchen;
  go: Go;
};

function dinnerNote(dish: Dish, inventory: readonly InventoryItem[], isCooked: boolean): string {
  if (isCooked) {
    return "Cooked and logged";
  }
  const ready = readiness(checkIngredients(dish, inventory));
  if (ready.useSoon.length > 0) {
    return `Uses ${listOf(ready.useSoon.slice(0, 3))} first`;
  }
  return ready.toBuy.length === 0 ? "Everything ready · no extras needed" : `${plural(ready.toBuy.length, "extra")} from the store`;
}

export function Plan({ kitchen, go }: PlanProps) {
  const { saved, inventory } = kitchen;
  const plan = saved.plan;
  const bought = saved.bought;
  const [isSaving, setIsSaving] = useState(false);

  if (!plan) {
    return (
      <div className="screen">
        <ScreenHeader eyebrow="Shopper · your smart plan" title="No plan yet" onBack={() => go({ name: "shop" })} />
        <AgentBubble agent="bargain_hunter">Scan your fridge first. I only shop for what your dinners still need.</AgentBubble>
        <Button size="lg" icon="scan" isBlock onClick={() => go({ name: "scan" })}>Scan my fridge</Button>
      </div>
    );
  }

  const buy = async (names: string[]) => {
    setIsSaving(true);
    await kitchen.markBought(names);
    setIsSaving(false);
  };
  const remaining = plan.cart.filter((line) => !bought.includes(line.name)).map((line) => line.name);
  const isAllBought = plan.cart.length > 0 && plan.cart.every((line) => bought.includes(line.name));
  const reserve = Math.max(0, plan.budget - plan.total_cost);
  const listSaving = plan.cart.reduce((sum, line) => sum + Math.max(0, line.list_cost - line.cost), 0);
  const today = new Date();
  const line =
    plan.cart.length === 0
      ? `Your Chef picked ${plural(plan.dishes.length, "dinner")} that need nothing from the store.`
      : `Your Chef picked ${plural(plan.dishes.length, "dinner")}. I filled only the gaps: ${plural(plan.cart.length, "item")}, one stop.`;

  return (
    <div className="screen">
      <ScreenHeader eyebrow="Shopper · your smart plan" title="A little goes a long way" onBack={() => go({ name: "shop" })} />
      <AgentBubble agent="bargain_hunter">{line}</AgentBubble>

      <section className="pouch px-box px-mint">
        <div className="pouch-head">
          <p className="eyebrow">Weekly coin pouch</p>
          <button type="button" className="text-link" onClick={() => go({ name: "goals" })}>{`Edit ${money(plan.budget)}`}</button>
        </div>
        <div className="pouch-main">
          <div>
            <strong>{money(plan.total_cost)}</strong>
            <small>{`for ${plural(plan.cart.length, "shopping item")}`}</small>
          </div>
          <PixelEmoji emoji="🧺" size={64} />
        </div>
        <SegBar filled={filledSegments(plan.total_cost, plan.budget, BUDGET_SEGMENTS)} total={BUDGET_SEGMENTS} label={`${money(plan.total_cost)} of a ${money(plan.budget)} budget`} />
        <dl className="pouch-stats">
          <div><dt>This plan</dt><dd>{money(plan.total_cost)}</dd></div>
          <div><dt>Deals save</dt><dd>{money(listSaving)}</dd></div>
          <div><dt>Still in reserve</dt><dd className="is-good">{money(reserve)}</dd></div>
        </dl>
      </section>

      <SectionTitle title={`${plural(plan.dishes.length, "dinner")}, one happy fridge`} />
      <ul className="dinners">
        {plan.dishes.map((dish, index) => (
          <li key={dish.id}>
            <button type="button" className="dinner" onClick={() => go({ name: "recipe", dishId: dish.id })}>
              <span className={`day-tag day-tag-${DAY_TONES[index % DAY_TONES.length]}`}>{dayTag(today, index)}</span>
              <span className="dinner-text">
                <strong>{dish.name}</strong>
                <small>{dinnerNote(dish, inventory, saved.cooked.includes(dish.id))}</small>
              </span>
              <Icon name="next" scale={1.5} />
            </button>
          </li>
        ))}
      </ul>

      {plan.cart.length > 0 && (
        <>
          <SectionTitle title="Your shopping loot" aside={plural(plan.cart.length, "item")} />
          {plan.store && (
            <p className="loot-store"><Icon name="basket" scale={1.5} />{`${plan.store.name} · ${plan.store.distance_mi} mi · one stop`}</p>
          )}
          <ul className="loot">
            {plan.cart.map((entry) => {
              const isBought = bought.includes(entry.name);
              return (
                <li key={entry.name}>
                  <button type="button" className={`loot-row ${isBought ? "is-bought" : ""}`} role="checkbox" aria-checked={isBought} disabled={isBought || isSaving} onClick={() => void buy([entry.name])}>
                    <span className="checkbox">{isBought && <Icon name="check" scale={1.5} />}</span>
                    <span className="loot-text">
                      <strong>{capitalize(entry.name)} <small>{packLabel(entry.packs, entry.pack_size, entry.unit, entry.name)}</small></strong>
                      <small>{isBought ? "Bought · now in your fridge" : dishesUsing(entry, plan.dishes).join(" + ")}</small>
                    </span>
                    <span className="loot-price">
                      <b>{money(entry.cost)}</b>
                      {isDeal(entry) && <em>Deal</em>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="loot-total">
            <span>Estimated total</span>
            <strong>{money(plan.total_cost)}</strong>
          </div>
        </>
      )}

      <div className="chip-row">
        <Chip tone="butter">Fridge-first</Chip>
        {plan.rescued.length > 0 && <Chip>{`Saves ${plural(plan.rescued.length, "ingredient")}`}</Chip>}
      </div>

      {plan.cart.length > 0 && (
        <Button size="lg" icon={isAllBought ? "next" : "check"} isBlock disabled={isSaving} onClick={isAllBought ? () => go({ name: "chef" }) : () => void buy(remaining)}>
          {isAllBought ? "All bought · back to recipes" : `I bought ${remaining.length === plan.cart.length ? "all" : "the other"} ${plural(remaining.length, "item")}`}
        </Button>
      )}
      <p className="fineprint">Tick an item once you have bought it. It goes into your fridge so the Chef can cook with it. Sample prices before tax.</p>
    </div>
  );
}
