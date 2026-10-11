import { useState, type FormEvent } from "react";

import { capitalize } from "../lib/food";
import type { DemoState, Diet, FoodLogInput, MealEstimate, Profile } from "../types";
import { Button, Field, Sheet } from "../ui/kit";

const DIETS: readonly Diet[] = ["none", "vegetarian", "vegan", "pescatarian", "kosher", "halal"];
const MAX_FAVORITES = 8;
const MAX_AVOID = 12;
const MAX_FAVORITE_CHARS = 30;

/** "pasta, Tacos ,  eggs" becomes ["pasta", "tacos", "eggs"], trimmed to what the server accepts. */
export function parseFavorites(text: string, limit: number = MAX_FAVORITES): string[] {
  const cleaned = text
    .split(",")
    .map((entry) => entry.trim().toLowerCase().slice(0, MAX_FAVORITE_CHARS))
    .filter(Boolean);
  return [...new Set(cleaned)].slice(0, limit);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
}

type GoalsSheetProps = {
  profile: Profile;
  onSave: (profile: Profile) => Promise<boolean>;
  onStartOver: () => Promise<void>;
  demo: DemoState;
  onDemo: (on: boolean) => Promise<void>;
  onClose: () => void;
};

export function GoalsSheet({ profile, onSave, onStartOver, demo, onDemo, onClose }: GoalsSheetProps) {
  const [name, setName] = useState(profile.name);
  const [goals, setGoals] = useState(profile.goals);
  const [favorites, setFavorites] = useState(profile.goals.favorites.join(", "));
  const [avoid, setAvoid] = useState(profile.goals.avoid.join(", "));
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  const setNumber = (key: keyof Profile["goals"]) => (event: { target: { value: string } }) =>
    setGoals({ ...goals, [key]: Number(event.target.value) });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    const next: Profile = {
      ...profile,
      name: name.trim(),
      goals: {
        ...goals,
        budget: clamp(goals.budget, 0, 500),
        meals: Math.round(clamp(goals.meals, 1, 7)),
        daily_calories: Math.round(clamp(goals.daily_calories, 800, 6000)),
        daily_protein_g: Math.round(clamp(goals.daily_protein_g, 10, 400)),
        max_calories: Math.round(clamp(goals.max_calories, 200, 3000)),
        max_sodium_mg: Math.round(clamp(goals.max_sodium_mg, 100, 5000)),
        favorites: parseFavorites(favorites),
        avoid: parseFavorites(avoid, MAX_AVOID),
      },
    };
    const isSaved = await onSave(next);
    setIsSaving(false);
    if (isSaved) {
      onClose();
    }
  };

  return (
    <Sheet title="Edit goals" onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Your name">
          <input value={name} maxLength={24} placeholder="Alex" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Favorite foods" hint="Separate with commas. The Chef leans toward these.">
          <input value={favorites} placeholder="pasta, tacos, eggs" onChange={(event) => setFavorites(event.target.value)} />
        </Field>
        <Field label="Foods to avoid" hint="Dislikes and allergies. No recipe will use these.">
          <input value={avoid} placeholder="mushrooms, shrimp" onChange={(event) => setAvoid(event.target.value)} />
        </Field>
        <div className="form-row">
          <Field label="Diet">
            <select value={goals.diet} onChange={(event) => setGoals({ ...goals, diet: event.target.value as Diet })}>
              {DIETS.map((diet) => (
                <option key={diet} value={diet}>{diet === "none" ? "No restriction" : capitalize(diet)}</option>
              ))}
            </select>
          </Field>
          <Field label="Dinners to plan">
            <input type="number" inputMode="numeric" min={1} max={7} value={goals.meals} onChange={setNumber("meals")} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Weekly budget ($)">
            <input type="number" inputMode="decimal" min={0} max={500} step="any" value={goals.budget} onChange={setNumber("budget")} />
          </Field>
          <Field label="Daily kcal goal">
            <input type="number" inputMode="numeric" min={800} max={6000} value={goals.daily_calories} onChange={setNumber("daily_calories")} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Daily protein (g)">
            <input type="number" inputMode="numeric" min={10} max={400} value={goals.daily_protein_g} onChange={setNumber("daily_protein_g")} />
          </Field>
          <Field label="Max kcal per meal">
            <input type="number" inputMode="numeric" min={200} max={3000} value={goals.max_calories} onChange={setNumber("max_calories")} />
          </Field>
        </div>
        <Field label="Max sodium per meal (mg)">
          <input type="number" inputMode="numeric" min={100} max={5000} value={goals.max_sodium_mg} onChange={setNumber("max_sodium_mg")} />
        </Field>
        <div className="form-actions">
          <Button type="submit" disabled={isSaving}>Save goals</Button>
        </div>
        <div className="danger-zone">
          <p className="fineprint">
            {demo.on
              ? "Demo mode is on. Planning and chat answer instantly, and the camera replays your recorded scan."
              : "Demo mode answers instantly with no live AI calls. Scan your fridge once first so there is a scan to replay."}
            {demo.has_scan ? " A fridge scan is recorded." : " No fridge scan is recorded yet."}
            {demo.has_meal ? " A meal photo is recorded." : ""}
          </p>
          <Button tone="paper" onClick={() => void onDemo(!demo.on)}>{demo.on ? "Turn demo mode off" : "Turn demo mode on"}</Button>
        </div>
        <div className="danger-zone">
          <p className="fineprint">Start over erases your fridge, plan, food log, XP and preferences. It cannot be undone.</p>
          {isConfirmingReset ? (
            <div className="form-actions">
              <Button tone="paper" onClick={() => setIsConfirmingReset(false)}>Keep my data</Button>
              <Button tone="butter" onClick={() => void onStartOver()}>Yes, erase everything</Button>
            </div>
          ) : (
            <Button tone="paper" onClick={() => setIsConfirmingReset(true)}>Start over</Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

type LogSheetProps = {
  /** Values read from a meal photo, for the player to check before logging. */
  estimate?: MealEstimate | null;
  onSave: (entry: FoodLogInput) => Promise<boolean>;
  onClose: () => void;
};

export function LogSheet({ estimate, onSave, onClose }: LogSheetProps) {
  const [name, setName] = useState(estimate?.name ?? "");
  const [calories, setCalories] = useState(estimate?.calories ?? 300);
  const [protein, setProtein] = useState(estimate?.protein_g ?? 10);
  const [isSaving, setIsSaving] = useState(false);
  const isValid = name.trim().length > 0 && calories >= 0 && protein >= 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValid) {
      return;
    }
    setIsSaving(true);
    const isSaved = await onSave({
      name: name.trim(),
      calories: Math.round(clamp(calories, 0, 5000)),
      protein_g: Math.round(clamp(protein, 0, 500)),
      sodium_mg: estimate?.sodium_mg ?? 0,
    });
    setIsSaving(false);
    if (isSaved) {
      onClose();
    }
  };

  return (
    <Sheet title={estimate ? "Check your meal" : "Log food"} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        {estimate && <p className="fineprint">Estimated from your photo. Fix anything that looks off, then log it.</p>}
        <Field label="What did you eat?">
          <input value={name} maxLength={80} autoFocus placeholder="Yogurt and oat bowl" onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="form-row">
          <Field label="Energy (kcal)">
            <input type="number" inputMode="numeric" min={0} max={5000} value={calories} onChange={(event) => setCalories(Number(event.target.value))} />
          </Field>
          <Field label="Protein (g)">
            <input type="number" inputMode="numeric" min={0} max={500} value={protein} onChange={(event) => setProtein(Number(event.target.value))} />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="submit" disabled={!isValid || isSaving}>Log food</Button>
        </div>
      </form>
    </Sheet>
  );
}
