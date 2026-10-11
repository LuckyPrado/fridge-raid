import { lazy, Suspense, useState } from "react";

import { capitalize } from "../lib/food";
import { boundedNumber, dailyTargets, heightCm, HEIGHT_LIMITS, type Aim, type Sex } from "../lib/targets";
import type { AgentId, Diet, Origin, Profile, StoreInfo } from "../types";
import { AgentBubble, Button } from "../ui/kit";
import { Room, Tower } from "../ui/Rooms";
import { parseFavorites } from "./GoalSheets";

const DIETS: ReadonlyArray<{ id: Diet; label: string }> = [
  { id: "none", label: "I eat everything" },
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "pescatarian", label: "Pescatarian" },
  { id: "kosher", label: "Kosher" },
  { id: "halal", label: "Halal" },
];
const STORES_NAMED = 3;

// The street map library is large and only needed once a location is shared.
const RealMap = lazy(() => import("./RealMap").then((module) => ({ default: module.RealMap })));
const ignorePick = () => undefined;
const AIMS: ReadonlyArray<{ id: Aim; label: string }> = [
  { id: "lighter", label: "Eat a little lighter" },
  { id: "balanced", label: "Stay balanced" },
  { id: "muscle", label: "Build muscle" },
];
const SEXES: ReadonlyArray<{ id: Sex; label: string }> = [
  { id: "female", label: "Female" },
  { id: "male", label: "Male" },
  { id: "other", label: "Rather not say" },
];
const MAX_AVOID = 12;
const BUDGET_LIMITS = { min: 0, max: 500, fallback: 25 } as const;
const DINNER_LIMITS = { min: 1, max: 7, fallback: 4 } as const;

interface Step {
  agent: AgentId | null;
  line: (name: string) => string;
}

const STEPS: readonly Step[] = [
  { agent: null, line: () => "" },
  { agent: "chef", line: () => "Welcome to my kitchen! I cook with what you already have. First, who am I cooking for, and what do you love?" },
  { agent: "chef", line: (name) => `Good taste${name ? `, ${name}` : ""}. Now the important part: anything I should never put on your plate?` },
  { agent: "nutritionist", line: (name) => `My turn${name ? `, ${name}` : ""}. Tell me a little about you and what we are working toward, and I will set your daily goals.` },
  { agent: "bargain_hunter", line: () => "And I watch the wallet. First, where are you? I will find the grocery stores around you. Then tell me the budget and how many dinners to plan." },
  { agent: null, line: () => "" },
];

type SetupProps = {
  profile: Profile;
  /** Where the store search was centered, once the player shares a location. */
  origin: Origin | null;
  /** The real stores found near the player. Empty until a location is shared. */
  nearbyStores: readonly StoreInfo[];
  /** Ask the phone for its location and find stores. Resolves to a problem message, or null. */
  onLocate: () => Promise<string | null>;
  onFinish: (profile: Profile) => Promise<boolean>;
};

/** First run: the three agents introduce themselves and take turns asking what the player wants. */
export function Setup({ profile, origin, nearbyStores, onLocate, onFinish }: SetupProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.name);
  const [favoritesText, setFavoritesText] = useState(profile.goals.favorites.join(", "));
  const [avoidText, setAvoidText] = useState(profile.goals.avoid.join(", "));
  const [isLocating, setIsLocating] = useState(false);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  const [diet, setDiet] = useState<Diet>(profile.goals.diet);
  const [sex, setSex] = useState<Sex>("other");
  const [feet, setFeet] = useState("5");
  const [inches, setInches] = useState("7");
  const [aim, setAim] = useState<Aim>("balanced");
  const [budgetText, setBudgetText] = useState(String(profile.goals.budget));
  const [mealsText, setMealsText] = useState(String(profile.goals.meals));
  const [isSaving, setIsSaving] = useState(false);

  const current = STEPS[step];
  const cleanName = name.trim();
  const cm = heightCm(boundedNumber(feet, HEIGHT_LIMITS.minFeet, HEIGHT_LIMITS.maxFeet, 5), boundedNumber(inches, 0, 11, 0));
  const chosen = dailyTargets(sex, cm, aim);
  const budget = Math.round(boundedNumber(budgetText, BUDGET_LIMITS.min, BUDGET_LIMITS.max, BUDGET_LIMITS.fallback) * 100) / 100;
  const meals = Math.round(boundedNumber(mealsText, DINNER_LIMITS.min, DINNER_LIMITS.max, DINNER_LIMITS.fallback));
  const allFavorites = parseFavorites(favoritesText);
  const allAvoid = parseFavorites(avoidText, MAX_AVOID);

  const handleLocate = async () => {
    setIsLocating(true);
    setLocationProblem(null);
    setLocationProblem(await onLocate());
    setIsLocating(false);
  };
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
            <h2><label htmlFor="setup-favorites">Foods you love</label></h2>
            <input id="setup-favorites" className="setup-input" value={favoritesText} placeholder="tacos, pasta, curry" autoComplete="off" onChange={(event) => setFavoritesText(event.target.value)} />
            <p className="fineprint">Separate them with commas. I will tell you when a recipe is here because of one.</p>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="setup-question">
            <h2><label htmlFor="setup-avoid">Foods to avoid</label></h2>
            <input id="setup-avoid" className="setup-input" value={avoidText} placeholder="mushrooms, shrimp" autoComplete="off" onChange={(event) => setAvoidText(event.target.value)} />
            <p className="fineprint">Dislikes or allergies, separated with commas. No recipe will use them.</p>
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
            <p className="fineprint">Kosher and halal are checked by ingredient only. Look for certification on the package.</p>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="setup-question">
            <h2>About you</h2>
            <div className="choice-row" role="group" aria-label="Sex">
              {SEXES.map((entry) => (
                <button type="button" key={entry.id} className={`choice ${sex === entry.id ? "is-picked" : ""}`} aria-pressed={sex === entry.id} onClick={() => setSex(entry.id)}>
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="number-row">
              <label className="number-field">
                <span>Height, feet</span>
                <input className="setup-input" type="number" inputMode="numeric" min={HEIGHT_LIMITS.minFeet} max={HEIGHT_LIMITS.maxFeet} value={feet} onChange={(event) => setFeet(event.target.value)} />
              </label>
              <label className="number-field">
                <span>Inches</span>
                <input className="setup-input" type="number" inputMode="numeric" min={0} max={11} value={inches} onChange={(event) => setInches(event.target.value)} />
              </label>
            </div>
          </div>
          <div className="setup-question">
            <h2>Your goal</h2>
            <div className="choice-row" role="group" aria-label="Your goal">
              {AIMS.map((entry) => (
                <button type="button" key={entry.id} className={`choice ${aim === entry.id ? "is-picked" : ""}`} aria-pressed={aim === entry.id} onClick={() => setAim(entry.id)}>
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <section className="target px-box px-mint" aria-live="polite">
            <p className="eyebrow">Your daily goals</p>
            <strong>{`${chosen.calories} kcal · ${chosen.protein} g protein`}</strong>
            <small>{`Worked out for ${cm} cm. An estimate, not medical advice. Fine-tune it by talking to me later.`}</small>
          </section>
        </>
      )}

      {step === 4 && (
        <div className="setup-question">
          <h2>Stores near you</h2>
          {origin && nearbyStores.length > 0 ? (
            <>
              <Suspense fallback={<div className="real-map px-box" />}>
                <RealMap origin={origin} stores={nearbyStores} pickedId={nearbyStores[0].id} onPick={ignorePick} />
              </Suspense>
              <section className="target px-box px-butter" aria-live="polite">
                <strong>{`${nearbyStores.length} stores found`}</strong>
                <small>{`${nearbyStores.slice(0, STORES_NAMED).map((store) => store.name).join(", ")}${nearbyStores.length > STORES_NAMED ? " and more" : ""}. I will price your list at each one.`}</small>
              </section>
            </>
          ) : (
            <>
              <Button tone="butter" icon="pin" isBlock disabled={isLocating} onClick={handleLocate}>
                {isLocating ? "Finding stores near you" : "Use my location"}
              </Button>
              <p className="fineprint">Skip this and I will use sample stores. You can share your location later on the Shop tab.</p>
            </>
          )}
          {locationProblem && <p className="scan-problem scan-problem-light" role="alert">{locationProblem}</p>}
          <div className="number-row">
            <label className="number-field">
              <span>Weekly budget, $</span>
              <input className="setup-input" type="number" inputMode="decimal" min={BUDGET_LIMITS.min} max={BUDGET_LIMITS.max} step="any" value={budgetText} onChange={(event) => setBudgetText(event.target.value)} onBlur={() => setBudgetText(String(budget))} />
              <small>{`Up to $${BUDGET_LIMITS.max}`}</small>
            </label>
            <label className="number-field">
              <span>Dinners to plan</span>
              <input className="setup-input" type="number" inputMode="numeric" min={DINNER_LIMITS.min} max={DINNER_LIMITS.max} value={mealsText} onChange={(event) => setMealsText(event.target.value)} onBlur={() => setMealsText(String(meals))} />
              <small>{`${DINNER_LIMITS.min} to ${DINNER_LIMITS.max}`}</small>
            </label>
          </div>
        </div>
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
