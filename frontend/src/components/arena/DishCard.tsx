import { motion } from "framer-motion";

import type { DishEntry } from "../../lib/raid";
import { money } from "../../lib/sprites";

interface DishCardProps {
  entry: DishEntry;
  isInPlan: boolean | null;
}

function stampFor(entry: DishEntry, isInPlan: boolean | null): { text: string; tone: string } | null {
  if (!entry.verdict) {
    return null;
  }
  if (entry.verdict.veto) {
    return { text: "Vetoed", tone: "veto" };
  }
  if (isInPlan === false) {
    return { text: "Benched", tone: "bench" };
  }
  return { text: `Approved ${entry.verdict.score}`, tone: "ok" };
}

export function DishCard({ entry, isInPlan }: DishCardProps) {
  const { dish, verdict, cost, damage, round } = entry;
  const stamp = stampFor(entry, isInPlan);
  const isOut = verdict?.veto === true || isInPlan === false;

  return (
    <motion.li
      layout
      className={`dish${isOut ? " dish--out" : ""}${damage !== null ? " dish--struck" : ""}`}
      initial={{ opacity: 0, y: 18, rotate: -1.5 }}
      animate={{ opacity: 1, y: 0, rotate: 0, x: verdict?.veto ? [0, -6, 6, -3, 0] : 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="dish__head">
        <h3 className="dish__name">{dish.name}</h3>
        {round > 1 ? <span className="dish__round">Take {round}</span> : null}
      </div>
      <p className="dish__facts">
        {dish.calories} cal, {dish.protein_g} g protein, {dish.sodium_mg} mg sodium, {dish.minutes} min
      </p>
      <p className="dish__ingredients">{dish.ingredients.map((ingredient) => ingredient.name).join(", ")}</p>
      <div className="dish__tags">
        {stamp ? <span className={`stamp stamp--${stamp.tone}`}>{stamp.text}</span> : null}
        {cost !== null ? <span className="tag tag--coin">+{money(cost)} to buy</span> : null}
        {verdict && !verdict.veto && cost === null ? <span className="tag tag--free">All in the fridge</span> : null}
        {damage !== null && damage > 0 ? <span className="tag tag--hit">−{money(damage)} waste</span> : null}
      </div>
    </motion.li>
  );
}
