import type { Kitchen } from "../hooks/useKitchen";
import { capitalize, dishSprite, plural } from "../lib/food";
import { checkIngredients, readiness } from "../lib/plan";
import type { Go } from "../nav";
import { PixelEmoji } from "../pixel/PixelEmoji";
import type { Dish } from "../types";
import { AgentBubble, Button, Chip, Icon, IconButton, ScreenHeader, SectionTitle } from "../ui/kit";

const ART_TONES = 3;

type ChefProps = {
  kitchen: Kitchen;
  go: Go;
  onPlan: () => void;
};

type DishArtProps = {
  dish: Dish;
  tone: number;
  size: "hero" | "thumb";
};

/** The picture of a dish: its pixel icon on a checkered tablecloth. */
export function DishArt({ dish, tone, size }: DishArtProps) {
  return (
    <div className={`dish-art dish-art-${size} dish-art-tone-${tone % ART_TONES}`}>
      <PixelEmoji emoji={dishSprite(dish.name)} grid={size === "hero" ? 24 : 16} size={size === "hero" ? 144 : 56} />
    </div>
  );
}

function readyLine(ready: number, total: number, toBuy: number): string {
  if (toBuy === 0) {
    return "All ingredients in your stash";
  }
  return `${ready} of ${total} ingredients ready · ${plural(toBuy, "extra")} to buy`;
}

export function Chef({ kitchen, go, onPlan }: ChefProps) {
  const { saved, inventory, profile } = kitchen;
  const goals = profile.goals;
  const dishes = saved.plan?.dishes ?? [];

  if (dishes.length === 0) {
    const hasStash = inventory.length > 0;
    return (
      <div className="screen">
        <ScreenHeader eyebrow="Your chef · recipe quests" title="Let's cook a little joy" />
        <AgentBubble agent="chef">
          {saved.plan
            ? "Nothing fit your budget and goals this time. Loosen one in Goals and I will try again."
            : "I cook from what you already have. Show me your fridge and I will find dinner in it."}
        </AgentBubble>
        <Button size="lg" icon={hasStash ? "next" : "scan"} isBlock onClick={hasStash ? onPlan : () => go({ name: "scan" })}>
          {hasStash ? "Find recipes for my stash" : "Scan my fridge"}
        </Button>
      </div>
    );
  }

  const featured = dishes.find((dish) => !saved.cooked.includes(dish.id)) ?? dishes[0];
  const others = dishes.filter((dish) => dish.id !== featured.id);
  const favorite = goals.favorites[0];
  const featuredReady = readiness(checkIngredients(featured, inventory));
  const isFeaturedCooked = saved.cooked.includes(featured.id);
  const intro = favorite
    ? `${capitalize(favorite)} is a favorite, so I leaned that way. These ${plural(dishes.length, "recipe")} give your use-soon food a happy ending.`
    : `These ${plural(dishes.length, "recipe")} give your use-soon food a happy ending. Tell me your favorite foods in Goals.`;

  return (
    <div className="screen">
      <ScreenHeader
        eyebrow="Your chef · recipe quests"
        title="Let's cook a little joy"
        action={<IconButton icon="chat" label="Talk to the Chef" onClick={() => go({ name: "chat", agent: "chef" })} />}
      />
      <AgentBubble agent="chef">{intro}</AgentBubble>

      <div className="chip-row">
        {goals.diet !== "none" && <Chip>{capitalize(goals.diet)}</Chip>}
        <Chip>{`Up to ${goals.max_calories} kcal`}</Chip>
        <Chip tone="paper">{`${goals.min_protein_g} g protein or more`}</Chip>
      </div>

      <SectionTitle title="Made for your fridge" aside={plural(dishes.length, "match")} />

      <button type="button" className="feature px-box" onClick={() => go({ name: "recipe", dishId: featured.id })}>
        <DishArt dish={featured} tone={0} size="hero" />
        {featuredReady.useSoon.length > 0 && !isFeaturedCooked && (
          <span className="feature-flag">
            <Icon name="star" scale={1} />
            {`Saves ${plural(featuredReady.useSoon.length, "use-soon item")}`}
          </span>
        )}
        <span className="feature-body">
          <strong>{featured.name}</strong>
          <small>{`${featured.minutes} min · ${featured.protein_g} g protein · ${featured.calories} kcal`}</small>
          <em>{isFeaturedCooked ? "Cooked and logged" : readyLine(featuredReady.ready, featuredReady.total, featuredReady.toBuy.length)}</em>
        </span>
      </button>

      <ul className="dish-list">
        {others.map((dish, index) => {
          const ready = readiness(checkIngredients(dish, inventory));
          const isCooked = saved.cooked.includes(dish.id);
          return (
            <li key={dish.id}>
              <button type="button" className="dish-row px-box" onClick={() => go({ name: "recipe", dishId: dish.id })}>
                <DishArt dish={dish} tone={index + 1} size="thumb" />
                <span className="dish-row-text">
                  <strong>{dish.name}</strong>
                  <small>{`${dish.minutes} min · ${dish.protein_g} g protein`}</small>
                  <em>{isCooked ? "Cooked and logged" : readyLine(ready.ready, ready.total, ready.toBuy.length)}</em>
                </span>
                <Icon name="next" scale={1.5} />
              </button>
            </li>
          );
        })}
      </ul>

      <Button tone="paper" isBlock onClick={onPlan} disabled={inventory.length === 0}>Plan again with my current stash</Button>
      <p className="fineprint">Nutrition is an estimate per serving.</p>
    </div>
  );
}
