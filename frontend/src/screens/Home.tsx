import type { Kitchen } from "../hooks/useKitchen";
import { capitalize, money, plural } from "../lib/food";
import type { Go } from "../nav";
import { AGENT_SPRITES, SPRITE_OUTLINE } from "../pixel/art";
import { PixelSprite } from "../pixel/PixelSprite";
import { AgentBubble, Button, Chip, Icon, SectionTitle, SegBar } from "../ui/kit";

type HomeProps = {
  kitchen: Kitchen;
  go: Go;
};

function chefLine(kitchen: Kitchen): string {
  const { inventory, saved, threat } = kitchen;
  const left = saved.plan ? saved.plan.dishes.filter((dish) => !saved.cooked.includes(dish.id)).length : 0;
  if (inventory.length === 0) {
    return "Show me your fridge and I will find dinner in it.";
  }
  if (!saved.plan) {
    return `${plural(threat.at_risk.length, "ingredient")} to use soon. Confirm your stash and I will get cooking.`;
  }
  if (left === 0) {
    return "Every planned meal is cooked. Scan again when the fridge changes.";
  }
  const hero = threat.at_risk[0];
  const opener = hero ? `Time to use the ${hero}!` : "Your stash is in good shape.";
  return `${opener} I have ${plural(left, "meal")} ready for you.`;
}

function shopperLine(kitchen: Kitchen): string {
  const plan = kitchen.saved.plan;
  if (!plan) {
    return "No shopping yet. I hunt for deals once the Chef picks dinners.";
  }
  if (plan.cart.length === 0) {
    return `Your ${plural(plan.dishes.length, "dinner")} need nothing from the store.`;
  }
  const where = plan.store ? ` at ${plan.store.name}` : "";
  return `Your ${plural(plan.dishes.length, "dinner")} need just ${money(plan.total_cost)} in extras${where}.`;
}

function HeroScene() {
  return (
    <div className="hero-scene" aria-hidden="true">
      <div className="hero-fridge">
        <span />
        <span />
      </div>
      <div className="hero-party">
        <PixelSprite sprite={AGENT_SPRITES.chef} scale={3} outline={SPRITE_OUTLINE} />
        <PixelSprite sprite={AGENT_SPRITES.nutritionist} scale={3} outline={SPRITE_OUTLINE} />
        <PixelSprite sprite={AGENT_SPRITES.bargain_hunter} scale={3} outline={SPRITE_OUTLINE} />
      </div>
      <div className="hero-floor" />
    </div>
  );
}

export function Home({ kitchen, go }: HomeProps) {
  const { profile, progress, saved, status, day } = kitchen;
  const goals = profile.goals;
  const dishes = saved.plan?.dishes ?? [];
  const level = String(progress.level).padStart(2, "0");
  const greeting = profile.name ? `Hey, ${profile.name}` : "Hey there";
  const questTitle = dishes.length > 0 ? `This week's quest · cook ${plural(dishes.length, "rescue meal")}` : "Today's quest · scan your fridge";
  const footnote =
    status?.mode === "gemini"
      ? "Live Gemini agents · sample stores and prices"
      : "Demo adventure · rule-based agents, sample stores and prices";

  return (
    <div className="screen">
      <header className="screen-header">
        <div className="screen-header-text">
          <p className="eyebrow">{`Level ${level} · Food explorer`}</p>
          <h1>Fridge Raid</h1>
        </div>
        <span className="xp-badge">
          <Icon name="star" scale={1.5} />
          {`${progress.xp} XP`}
        </span>
      </header>

      <section className="hero px-box">
        <div className="hero-copy">
          <p className="hero-hello">{greeting}</p>
          <h2>Good food. Great quests.</h2>
          <p className="hero-sub">Your little team for a healthier everyday.</p>
          <span className="streak">
            <Icon name="flame" scale={1.5} />
            {`${progress.streak} day streak`}
          </span>
        </div>
        <HeroScene />
      </section>

      <div className="chip-row">
        {goals.diet !== "none" && <Chip>{capitalize(goals.diet)}</Chip>}
        <Chip>{`${goals.daily_protein_g} g protein`}</Chip>
        <Chip tone="butter">{`${money(goals.budget)} / week`}</Chip>
      </div>

      <Button size="lg" icon="scan" isBlock onClick={() => go({ name: "scan" })}>
        Scan my fridge
      </Button>

      <SectionTitle title="Meet your party" aside="All set to help" />
      <button type="button" className="bubble-link" onClick={() => go({ name: "chef" })}>
        <AgentBubble agent="chef">{chefLine(kitchen)}</AgentBubble>
      </button>
      <button type="button" className="bubble-link" onClick={() => go({ name: "goals" })}>
        <AgentBubble agent="nutritionist">{day.coach || "Tell me your goals and I will keep count."}</AgentBubble>
      </button>
      <button type="button" className="bubble-link" onClick={() => go({ name: "shop" })}>
        <AgentBubble agent="bargain_hunter">{shopperLine(kitchen)}</AgentBubble>
      </button>

      <section className="quest">
        <div className="quest-head">
          <p>{questTitle}</p>
          <span className="quest-xp">{`${progress.items_rescued} saved`}</span>
        </div>
        <SegBar
          filled={saved.cooked.length}
          total={Math.max(dishes.length, 1)}
          label={`${saved.cooked.length} of ${dishes.length} planned meals cooked`}
        />
      </section>
      <p className="fineprint">{footnote}</p>
    </div>
  );
}
