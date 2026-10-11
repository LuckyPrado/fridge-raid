import { useState } from "react";

import type { Kitchen } from "../hooks/useKitchen";
import { amountLabel, capitalize, money, packLabel, plural } from "../lib/food";
import { cartLineFor, checkIngredients, dishesUsing, readiness, type IngredientCheck } from "../lib/plan";
import type { Go } from "../nav";
import type { CartLine, Dish } from "../types";
import { AgentBubble, Button, Chip, Icon, ScreenHeader, SectionTitle } from "../ui/kit";
import { DishArt } from "./Chef";

const XP_PER_MEAL = 20;
const XP_PER_RESCUE = 20;

type RecipeProps = {
  kitchen: Kitchen;
  dishId: string;
  go: Go;
  notify: (message: string) => void;
};

function IngredientRow({ check, isCooked }: { check: IngredientCheck; isCooked: boolean }) {
  const { ingredient, status } = check;
  const needsBuying = status === "buy" && !isCooked;
  const amount = status === "staple" ? "pantry basic" : amountLabel(ingredient.quantity, ingredient.unit, ingredient.name);
  return (
    <li className="ingredient">
      <Icon name={needsBuying ? "basket" : "check"} scale={1.5} className={needsBuying ? "ingredient-buy" : "ingredient-ok"} />
      <span className="ingredient-name">{capitalize(ingredient.name)}</span>
      {status === "use-soon" && !isCooked && <Chip tone="peach">Use soon</Chip>}
      <span className="ingredient-amount">{amount}</span>
    </li>
  );
}

function BuyCard({ line, dish, dishes }: { line: CartLine; dish: Dish; dishes: readonly Dish[] }) {
  const sharedWith = dishesUsing(line, dishes).filter((name) => name !== dish.name);
  return (
    <div className="buy px-box px-butter">
      <Icon name="basket" />
      <div className="buy-text">
        <strong>{`${capitalize(line.name)} · need to buy`}</strong>
        <small>
          {`${packLabel(line.packs, line.pack_size, line.unit, line.name)} · ${money(line.cost)}`}
          {sharedWith.length > 0 ? ` · shared with ${sharedWith[0]}` : ""}
        </small>
      </div>
      <span className="buy-flag">In plan</span>
    </div>
  );
}

export function Recipe({ kitchen, dishId, go, notify }: RecipeProps) {
  const { saved, inventory, day, profile, cook } = kitchen;
  const [isCooking, setIsCooking] = useState(false);
  const dishes = saved.plan?.dishes ?? [];
  const dish = dishes.find((entry) => entry.id === dishId);

  if (!dish || !saved.plan) {
    return (
      <div className="screen">
        <ScreenHeader eyebrow="Chef · recipe detail" title="That recipe is gone" onBack={() => go({ name: "chef" })} />
        <p className="fineprint">The plan changed. Go back to see your current recipes.</p>
      </div>
    );
  }

  const isCooked = saved.cooked.includes(dish.id);
  const checks = checkIngredients(dish, inventory);
  const ready = readiness(checks);
  const toBuy = ready.toBuy
    .map((name) => cartLineFor(name, saved.plan?.cart ?? []))
    .filter((line): line is CartLine => line !== undefined);
  const xp = XP_PER_MEAL + XP_PER_RESCUE * ready.useSoon.length;
  const proteinAfter = day.protein_g + dish.protein_g;
  const coach = isCooked
    ? `Logged. You are at ${day.protein_g} g of your ${profile.goals.daily_protein_g} g protein goal today.`
    : `This adds ${dish.protein_g} g protein. That takes today from ${day.protein_g} g to ${proteinAfter} g of your ${profile.goals.daily_protein_g} g goal.`;

  const handleCook = async () => {
    setIsCooking(true);
    const result = await cook(dish.id);
    setIsCooking(false);
    if (result) {
      const rescued = result.rescued.length > 0 ? ` · ${plural(result.rescued.length, "ingredient")} saved` : "";
      notify(`+${result.xp} XP${rescued}`);
    }
  };

  return (
    <div className="screen has-cta">
      <ScreenHeader eyebrow="Chef · recipe detail" title={ready.useSoon.length > 0 ? "A fridge-saving favorite" : "A plan favorite"} onBack={() => go({ name: "chef" })} />
      <DishArt dish={dish} tone={dishes.indexOf(dish)} size="hero" />

      {!isCooked && (
        <span className="hero-flag">
          <Icon name="star" scale={1} />
          {ready.useSoon.length > 0 ? `Use-soon hero · +${xp} XP` : `+${xp} XP`}
        </span>
      )}
      <h2 className="recipe-name">{dish.name}</h2>
      <p className="recipe-about">{dish.description || dish.pitch}</p>
      <div className="chip-row">
        <Chip tone="paper">{`${dish.minutes} min`}</Chip>
        <Chip tone="paper">{`${dish.calories} kcal`}</Chip>
        <Chip>{`${dish.protein_g} g protein`}</Chip>
        <Chip tone="paper">{`${dish.sodium_mg} mg sodium`}</Chip>
      </div>

      <SectionTitle title="What goes in" aside="1 serving logged" />
      <ul className="ingredients">
        {checks.map((check) => (
          <IngredientRow key={check.ingredient.name} check={check} isCooked={isCooked} />
        ))}
      </ul>
      {!isCooked && toBuy.map((line) => <BuyCard key={line.name} line={line} dish={dish} dishes={dishes} />)}

      <AgentBubble agent="nutritionist">{coach}</AgentBubble>

      {dish.steps.length > 0 && (
        <>
          <SectionTitle title="Your cooking quest" />
          <ol className="steps">
            {dish.steps.map((step, index) => (
              <li key={step}>
                <span className="step-number">{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="fineprint">Nutrition is estimated per serving. XP is earned when you log a cooked meal.</p>

      <div className="cta-bar">
        <Button size="lg" icon={isCooked ? "check" : "play"} isBlock disabled={isCooked || isCooking} onClick={handleCook}>
          {isCooked ? "Cooked and logged" : `Cook and log it · ${dish.minutes} min`}
        </Button>
      </div>
    </div>
  );
}
