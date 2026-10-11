import { useState } from "react";

import type { Kitchen } from "../hooks/useKitchen";
import { capitalize } from "../lib/food";
import { filledSegments, nextDish } from "../lib/plan";
import type { Go } from "../nav";
import { PixelEmoji } from "../pixel/PixelEmoji";
import { AgentBubble, Chip, Icon, IconButton, ScreenHeader, SectionTitle, SegBar } from "../ui/kit";
import { GoalsSheet, LogSheet } from "./GoalSheets";

const ENERGY_SEGMENTS = 10;
const TILE_SEGMENTS = 10;
const WATER_GOAL = 8;
const ML_PER_GLASS = 250;
// A common daily sodium ceiling, used only to draw the bar.
const DAILY_SODIUM_MG = 2300;

type GoalsProps = {
  kitchen: Kitchen;
  go: Go;
};

type OpenSheet = "goals" | "log" | null;

function dateTitle(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  return `Today · ${date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`;
}

export function Goals({ kitchen, go }: GoalsProps) {
  const { day, profile, saved, today, setWater, saveProfile, logFood } = kitchen;
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);
  const goals = profile.goals;
  const energyLeft = goals.daily_calories - day.calories;
  const upcoming = nextDish(saved);
  const energyNote =
    energyLeft >= 0
      ? `${energyLeft} kcal left${upcoming ? ` · room for ${upcoming.name}` : ""}`
      : `${-energyLeft} kcal over your goal`;

  const handleGlass = (index: number) => {
    const isLastFilled = index === day.water - 1;
    void setWater(isLastFilled ? index : index + 1);
  };

  return (
    <div className="screen">
      <ScreenHeader
        eyebrow="Your nutritionist · daily stats"
        title="Small steps, strong you"
        action={<IconButton icon="sliders" label="Edit goals" onClick={() => setOpenSheet("goals")} />}
      />
      <AgentBubble agent="nutritionist">{day.coach || "Log a meal and I will keep count."}</AgentBubble>
      <p className="date-title">{dateTitle(today)}</p>

      <section className="energy px-box">
        <PixelEmoji emoji="🍎" size={72} />
        <div className="energy-text">
          <p>Daily energy</p>
          <strong>{`${day.calories.toLocaleString()} kcal`}</strong>
          <small>{`of your ${goals.daily_calories.toLocaleString()} kcal goal`}</small>
        </div>
        <SegBar
          tone="teal"
          filled={filledSegments(day.calories, goals.daily_calories, ENERGY_SEGMENTS)}
          total={ENERGY_SEGMENTS}
          label={`${day.calories} of ${goals.daily_calories} kcal`}
        />
        <p className="energy-note">{energyNote}</p>
      </section>

      <div className="tiles">
        <section className="stat px-box">
          <p className="stat-label"><Icon name="drop" scale={1.5} />Protein</p>
          <strong>{`${day.protein_g} g`}</strong>
          <small>{`/ ${goals.daily_protein_g} g daily goal`}</small>
          <SegBar tone="teal" filled={filledSegments(day.protein_g, goals.daily_protein_g, TILE_SEGMENTS)} total={TILE_SEGMENTS} label={`${day.protein_g} of ${goals.daily_protein_g} g protein`} />
        </section>
        <section className="stat px-box">
          <p className="stat-label"><Icon name="star" scale={1.5} />Sodium</p>
          <strong>{`${day.sodium_mg} mg`}</strong>
          <small>{`/ ${DAILY_SODIUM_MG} mg daily cap`}</small>
          <SegBar tone="gold" filled={filledSegments(day.sodium_mg, DAILY_SODIUM_MG, TILE_SEGMENTS)} total={TILE_SEGMENTS} label={`${day.sodium_mg} of ${DAILY_SODIUM_MG} mg sodium`} />
        </section>
      </div>

      <SectionTitle title="Water quest" aside={`${day.water} / ${WATER_GOAL} glasses · ${ML_PER_GLASS} ml`} />
      <div className="water" role="group" aria-label="Glasses of water today">
        {Array.from({ length: WATER_GOAL }, (_, index) => {
          const isFull = index < day.water;
          return (
            <button
              type="button"
              key={index}
              className={`glass ${isFull ? "is-full" : ""}`}
              aria-label={isFull ? `Glass ${index + 1}, drunk` : `Log glass ${index + 1}`}
              aria-pressed={isFull}
              onClick={() => handleGlass(index)}
            >
              <Icon name={isFull ? "drop" : "plus"} scale={1.5} />
            </button>
          );
        })}
      </div>

      <SectionTitle
        title="Today's fuel"
        aside={<button type="button" className="text-link" onClick={() => setOpenSheet("log")}>+ Log food</button>}
      />
      {day.entries.length === 0 && <p className="fineprint">Nothing logged yet today. Cook a planned recipe or log food by hand.</p>}
      <ul className="fuel">
        {day.entries.map((entry) => (
          <li key={entry.id}>
            <Icon name="check" scale={1.5} className="ingredient-ok" />
            <span className="fuel-text">
              <small>{entry.kind === "meal" ? "Cooked from your plan" : "Logged by hand"}</small>
              <strong>{entry.name}</strong>
            </span>
            <span className="fuel-kcal">{`${entry.calories} kcal`}</span>
          </li>
        ))}
      </ul>

      {upcoming && (
        <button type="button" className="tonight px-box px-mint" onClick={() => go({ name: "recipe", dishId: upcoming.id })}>
          <strong>{`Up next · ${upcoming.name}`}</strong>
          <small>{`Planned, not logged · +${upcoming.protein_g} g protein · ${upcoming.calories} kcal`}</small>
        </button>
      )}

      <div className="chip-row">
        {goals.diet !== "none" && <Chip>{capitalize(goals.diet)}</Chip>}
        {goals.favorites.map((favorite) => (
          <Chip key={favorite} tone="peach">{capitalize(favorite)}</Chip>
        ))}
        <button type="button" className="chip chip-paper chip-button" onClick={() => setOpenSheet("goals")}>
          <Icon name="pencil" scale={1} />
          Edit goals
        </button>
      </div>
      <p className="fineprint">Self-set goals and estimated nutrition. This is not medical advice.</p>

      {openSheet === "goals" && <GoalsSheet profile={profile} onSave={saveProfile} onClose={() => setOpenSheet(null)} />}
      {openSheet === "log" && <LogSheet onSave={logFood} onClose={() => setOpenSheet(null)} />}
    </div>
  );
}
