import { motion } from "framer-motion";

import { money } from "../../lib/sprites";
import "./hud.css";

interface MeterProps {
  tone: "rot" | "coin";
  fraction: number;
  flashKey?: number;
}

function Meter({ tone, fraction, flashKey }: MeterProps) {
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <div className={`meter meter--${tone}`}>
      <motion.div
        className="meter__fill"
        initial={false}
        animate={{ scaleX: clamped }}
        transition={{ type: "spring", stiffness: 140, damping: 20 }}
      />
      {flashKey ? (
        <motion.div
          key={flashKey}
          className="meter__flash"
          initial={{ opacity: 0.9 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
        />
      ) : null}
    </div>
  );
}

interface HudProps {
  bossMax: number;
  bossHp: number;
  atRiskCount: number;
  spent: number;
  budget: number;
  strikes: number;
  settled: boolean;
}

export function Hud({ bossMax, bossHp, atRiskCount, spent, budget, strikes, settled }: HudProps) {
  const defeated = settled && bossMax > 0 && bossHp <= 0.005;
  const bossLine =
    bossMax <= 0
      ? "Nothing is about to spoil"
      : defeated
        ? "Defeated. Nothing goes in the bin this week"
        : `${money(bossHp)} of food about to spoil`;
  const overBudget = spent > budget;

  return (
    <section className="hud" aria-label="Raid status">
      <div className="hud__boss">
        <div className="hud__row">
          <h2 className="hud__name">
            <span aria-hidden="true">{defeated ? "💀" : "🦠"}</span> The Rot
          </h2>
          <p className="hud__value" aria-live="polite">
            {bossLine}
          </p>
        </div>
        <Meter tone="rot" fraction={bossMax > 0 ? bossHp / bossMax : 0} flashKey={strikes} />
        <p className="hud__hint">
          {bossMax > 0
            ? `${atRiskCount} item${atRiskCount === 1 ? "" : "s"} expiring within 3 days. Cook them to deal damage.`
            : "Stock the fridge to wake the boss."}
        </p>
      </div>
      <div className="hud__budget">
        <div className="hud__row">
          <h2 className="hud__name">
            <span aria-hidden="true">🪙</span> Cart
          </h2>
          <p className={`hud__value${overBudget ? " hud__value--bad" : ""}`} aria-live="polite">
            {money(spent)} of {money(budget)}
          </p>
        </div>
        <Meter tone="coin" fraction={budget > 0 ? spent / budget : 0} />
      </div>
    </section>
  );
}
