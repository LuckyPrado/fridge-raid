import { useState } from "react";

import { capitalize } from "../lib/food";
import type { AgentId, Diet, Profile } from "../types";
import { AgentBubble, Button } from "../ui/kit";
import { Room, Tower } from "../ui/Rooms";
import { parseFavorites } from "./GoalSheets";

const FAVORITE_IDEAS = ["tacos", "pasta", "eggs", "rice bowls", "curry", "chicken", "salad", "soup"] as const;
const AVOID_IDEAS = ["mushrooms", "shrimp", "bacon", "tofu", "onion", "cilantro"] as const;
const DIETS: ReadonlyArray<{ id: Diet; label: string }> = [
  { id: "none", label: "I eat everything" },
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "pescatarian", label: "Pescatarian" },
];
const TARGETS = [
  { id: "lighter", label: "Eat a little lighter", calories: 1600, protein: 90 },
  { id: "balanced", label: "Stay balanced", calories: 2000, protein: 100 },
  { id: "muscle", label: "Build muscle", calories: 2400, protein: 140 },
] as const;
const BUDGETS = [15, 25, 40, 60] as const;
const DINNER_COUNTS = [3, 4, 5] as const;
const MAX_AVOID = 12;

type TargetId = (typeof TARGETS)[number]["id"];

interface Step {
  agent: AgentId | null;
  line: (name: string) => string;
}

const STEPS: readonly Step[] = [
  { agent: null, line: () => "" },
  { agent: "chef", line: () => "Welcome to my kitchen! I cook with what you already have. First, who am I cooking for, and what do you love?" },
  { agent: "chef", line: (name) => `Good taste${name ? `, ${name}` : ""}. Now the important part: anything I should never put on your plate?` },
  { agent: "nutritionist", line: (name) => `My turn${name ? `, ${name}` : ""}. I keep count so you do not have to. What are we working toward?` },
  { agent: "bargain_hunter", line: () => "And I watch the wallet. How much can we spend on groceries each week, and how many dinners should we plan?" },
  { agent: null, line: () => "" },
];

type SetupProps = {
  profile: Profile;
  onFinish: (profile: Profile) => Promise<boolean>;
};

function toggled(list: readonly string[], item: string): string[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

/** First run: the three agents introduce themselves and take turns asking what the player wants. */
export function Setup({ profile, onFinish }: SetupProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.name);
  const [favorites, setFavorites] = useState<string[]>(profile.goals.favorites);
  const [moreFavorites, setMoreFavorites] = useState("");
  const [avoid, setAvoid] = useState<string[]>(profile.goals.avoid);
  const [moreAvoid, setMoreAvoid] = useState("");
  const [diet, setDiet] = useState<Diet>(profile.goals.diet);
  const [target, setTarget] = useState<TargetId>("balanced");
  const [budget, setBudget] = useState<number>(profile.goals.budget);
  const [meals, setMeals] = useState<number>(profile.goals.meals);
  const [isSaving, setIsSaving] = useState(false);

  const current = STEPS[step];
  const cleanName = name.trim();
  const chosen = TARGETS.find((entry) => entry.id === target) ?? TARGETS[1];
  const allFavorites = parseFavorites([...favorites, moreFavorites].join(","));
  const allAvoid = parseFavorites([...avoid, moreAvoid].join(","), MAX_AVOID);
  const isLast = step === STEPS.length - 1;

  const handleFinish = async () => {
    setIsSaving(true);
    await onFinish({
      name: cleanName,
      onboarded: true,
      goals: {
        ...profile.goals,
        favorites: allFavorites,
        avoid: allAvoid,
        diet,
        daily_calories: chosen.calories,
        daily_protein_g: chosen.protein,
        budget,
        meals,
      },
    });
    setIsSaving(false);
  };

  return (
    <div className="screen setup">
      <div className="setup-steps" role="img" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((_, index) => (
          <span key={index} className={index <= step ? "is-done" : ""} />
        ))}
      </div>

      {step === 0 && (
        <>
          <header className="greeting">
            <p className="eyebrow">Welcome</p>
            <h2>Fridge Raid</h2>
            <p className="greeting-row">Three little helpers who turn your fridge into dinner, goals and a smart shopping list.</p>
          </header>
          <Tower />
          <AgentBubble agent="chef">I am your Chef. I cook from what you already have, so nothing goes to waste.</AgentBubble>
          <AgentBubble agent="nutritionist">I am your Nutritionist. I keep every meal on track with your goals.</AgentBubble>
          <AgentBubble agent="bargain_hunter">I am your Shopper. I find the cheapest stop for whatever is missing.</AgentBubble>
        </>
      )}

      {current.agent && (
        <>
          <Room agent={current.agent} />
          <AgentBubble agent={current.agent} isSpeaking>{current.line(cleanName)}</AgentBubble>
        </>
      )}

      {step === 1 && (
        <>
          <div className="setup-question">
            <h2><label htmlFor="setup-name">Your name</label></h2>
            <input id="setup-name" className="setup-input" value={name} maxLength={24} placeholder="Alex" autoComplete="given-name" onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="setup-question">
            <h2>Foods you love</h2>
            <div className="choice-row" role="group" aria-label="Foods you love">
              {FAVORITE_IDEAS.map((food) => (
                <button type="button" key={food} className={`choice ${favorites.includes(food) ? "is-picked" : ""}`} aria-pressed={favorites.includes(food)} onClick={() => setFavorites(toggled(favorites, food))}>
                  {capitalize(food)}
                </button>
              ))}
            </div>
            <input className="setup-input" aria-label="Other foods you love" value={moreFavorites} placeholder="Anything else? Separate with commas" onChange={(event) => setMoreFavorites(event.target.value)} />
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="setup-question">
            <h2>Foods to avoid</h2>
            <div className="choice-row" role="group" aria-label="Foods to avoid">
              {AVOID_IDEAS.map((food) => (
                <button type="button" key={food} className={`choice ${avoid.includes(food) ? "is-picked" : ""}`} aria-pressed={avoid.includes(food)} onClick={() => setAvoid(toggled(avoid, food))}>
                  {capitalize(food)}
                </button>
              ))}
            </div>
            <input className="setup-input" aria-label="Other foods to avoid" value={moreAvoid} placeholder="Dislikes or allergies, separated with commas" onChange={(event) => setMoreAvoid(event.target.value)} />
          </div>
          <div className="setup-question">
            <h2>How you eat</h2>
            <div className="choice-row" role="group" aria-label="How you eat">
              {DIETS.map((entry) => (
                <button type="button" key={entry.id} className={`choice ${diet === entry.id ? "is-picked" : ""}`} aria-pressed={diet === entry.id} onClick={() => setDiet(entry.id)}>
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {step === 3 && (
        <div className="setup-question">
          <h2>Your goal</h2>
          <div className="choice-row" role="group" aria-label="Your goal">
            {TARGETS.map((entry) => (
              <button type="button" key={entry.id} className={`choice choice-wide ${target === entry.id ? "is-picked" : ""}`} aria-pressed={target === entry.id} onClick={() => setTarget(entry.id)}>
                {entry.label}
                <small>{`${entry.calories} kcal and ${entry.protein} g protein a day`}</small>
              </button>
            ))}
          </div>
          <p className="fineprint">These are starting points, not medical advice. You can fine-tune them by talking to me later.</p>
        </div>
      )}

      {step === 4 && (
        <>
          <div className="setup-question">
            <h2>Weekly grocery budget</h2>
            <div className="choice-row" role="group" aria-label="Weekly grocery budget">
              {BUDGETS.map((amount) => (
                <button type="button" key={amount} className={`choice ${budget === amount ? "is-picked" : ""}`} aria-pressed={budget === amount} onClick={() => setBudget(amount)}>
                  {`$${amount}`}
                </button>
              ))}
            </div>
          </div>
          <div className="setup-question">
            <h2>Dinners to plan</h2>
            <div className="choice-row" role="group" aria-label="Dinners to plan">
              {DINNER_COUNTS.map((count) => (
                <button type="button" key={count} className={`choice ${meals === count ? "is-picked" : ""}`} aria-pressed={meals === count} onClick={() => setMeals(count)}>
                  {`${count} dinners`}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {isLast && (
        <>
          <header className="greeting">
            <p className="eyebrow">All set</p>
            <h2>{cleanName ? `Nice to meet you, ${cleanName}` : "Nice to meet you"}</h2>
          </header>
          <AgentBubble agent="chef">
            {allFavorites.length > 0 ? `${capitalize(allFavorites[0])} is on my list.` : "I will surprise you."}
            {allAvoid.length > 0 ? ` No ${allAvoid.join(", no ")}. Promise.` : ""}
          </AgentBubble>
          <AgentBubble agent="nutritionist">{`${chosen.calories} kcal and ${chosen.protein} g of protein a day. I will keep count.`}</AgentBubble>
          <AgentBubble agent="bargain_hunter">{`$${budget} a week for ${meals} dinners. Watch me make it stretch.`}</AgentBubble>
          <p className="fineprint">Now show us your fridge and we will get to work.</p>
        </>
      )}

      <div className="setup-nav">
        {step > 0 && <Button tone="paper" size="lg" onClick={() => setStep(step - 1)}>Back</Button>}
        {isLast ? (
          <Button size="lg" icon="scan" disabled={isSaving} onClick={handleFinish}>Scan my fridge</Button>
        ) : (
          <Button size="lg" icon="next" onClick={() => setStep(step + 1)}>{step === 0 ? "Meet your party" : "Next"}</Button>
        )}
      </div>
    </div>
  );
}
