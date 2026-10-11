import type { Diet, Goals } from "../../types";
import "./panels.css";

export const DEFAULT_GOALS: Goals = {
  budget: 25,
  diet: "none",
  max_calories: 800,
  max_sodium_mg: 900,
  min_protein_g: 15,
  meals: 4,
};

const DIETS: ReadonlyArray<{ value: Diet; label: string }> = [
  { value: "none", label: "No restriction" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "pescatarian", label: "Pescatarian" },
];

interface SliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

function Slider({ id, label, value, min, max, step, display, onChange }: SliderProps) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <output htmlFor={id}>{display}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

interface GoalsPanelProps {
  goals: Goals;
  onChange: (goals: Goals) => void;
}

export function GoalsPanel({ goals, onChange }: GoalsPanelProps) {
  const set = (patch: Partial<Goals>) => onChange({ ...goals, ...patch });
  return (
    <form className="goals" aria-label="Your rules for the party" onSubmit={(event) => event.preventDefault()}>
      <Slider
        id="goal-budget"
        label="Shopping budget"
        value={goals.budget}
        min={0}
        max={80}
        step={1}
        display={`$${goals.budget}`}
        onChange={(budget) => set({ budget })}
      />
      <Slider
        id="goal-meals"
        label="Meals to plan"
        value={goals.meals}
        min={1}
        max={6}
        step={1}
        display={String(goals.meals)}
        onChange={(meals) => set({ meals })}
      />
      <Slider
        id="goal-calories"
        label="Calories per serving, at most"
        value={goals.max_calories}
        min={300}
        max={1400}
        step={50}
        display={String(goals.max_calories)}
        onChange={(max_calories) => set({ max_calories })}
      />
      <Slider
        id="goal-sodium"
        label="Sodium per serving, at most"
        value={goals.max_sodium_mg}
        min={300}
        max={2400}
        step={100}
        display={`${goals.max_sodium_mg} mg`}
        onChange={(max_sodium_mg) => set({ max_sodium_mg })}
      />
      <div className="field">
        <label htmlFor="goal-diet">Diet</label>
        <select id="goal-diet" value={goals.diet} onChange={(event) => set({ diet: event.target.value as Diet })}>
          {DIETS.map((diet) => (
            <option key={diet.value} value={diet.value}>
              {diet.label}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
