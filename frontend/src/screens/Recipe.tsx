import { useEffect, useState } from "react";

import type { Kitchen } from "../hooks/useKitchen";
import { api } from "../lib/api";
import { amountLabel, capitalize, money, packLabel, plural } from "../lib/food";
import { cartLineFor, checkIngredients, dishesUsing, readiness, whySuggested, type IngredientCheck } from "../lib/plan";
import type { Go } from "../nav";
import type { CartLine, Dish, Quote } from "../types";
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

type WhereToBuyProps = {
  quote: Quote;
  isListed: boolean;
  onAdd: () => void;
};

/** A missing ingredient with the best store the Shopper found for it. */
function WhereToBuy({ quote, isListed, onAdd }: WhereToBuyProps) {
  const isOnSale = quote.price < quote.list_price;
  return (
    <div className="buy px-box px-butter">
      <Icon name="pin" />
      <div className="buy-text">
        <strong>{`${capitalize(quote.name)} · ${money(quote.price)} at ${quote.store}`}</strong>
        <small>{`${quote.distance_mi} mi away${isOnSale ? ` · on sale, was ${money(quote.list_price)}` : ""}`}</small>
      </div>
      {isListed ? (
        <span className="buy-flag">On your list</span>
      ) : (
        <Button size="sm" tone="paper" onClick={onAdd}>Add to list</Button>
      )}
    </div>
  );
}

export function Recipe({ kitchen, dishId, go, notify }: RecipeProps) {
  const { saved, inventory, day, profile, cook } = kitchen;
  const [isCooking, setIsCooking] = useState(false);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const dishes = saved.plan?.dishes ?? [];
  const dish = dishes.find((entry) => entry.id === dishId);

  // Ask the Shopper where to get whatever this recipe is still missing. It changes as other meals use food up.
  const missingKey = dish && !saved.cooked.includes(dish.id) ? readiness(checkIngredients(dish, inventory)).toBuy.join("|") : "";
  useEffect(() => {
    if (!missingKey) {
      setQuotes([]);
      return;
    }
    let isCancelled = false;
    api
      .quote(missingKey.split("|"))
      .then((found) => !isCancelled && setQuotes(found))
      .catch(() => !isCancelled && setQuotes([]));
    return () => {
      isCancelled = true;
    };
  }, [missingKey, kitchen.stores]);

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
      {!isCooked && whySuggested(dish, inventory, profile.goals).length > 0 && (
        <section className="why-box px-box px-peach">
          <p className="eyebrow">Why the Chef picked this</p>
          <span className="why-row">
            {whySuggested(dish, inventory, profile.goals).map((reason) => (
              <span key={reason} className="why">{reason}</span>
            ))}
          </span>
        </section>
      )}
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
      {!isCooked && quotes.length > 0 && (
        <>
          <SectionTitle title="Where to get what is missing" aside={plural(quotes.length, "item")} />
          {quotes.map((quote) => (
            <WhereToBuy
              key={quote.name}
              quote={quote}
              isListed={kitchen.grocery.some((item) => item.name === quote.name)}
              onAdd={() => void kitchen.addGrocery(quote.name)}
            />
          ))}
        </>
      )}

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
