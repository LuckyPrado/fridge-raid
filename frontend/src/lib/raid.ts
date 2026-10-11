import type { AgentId, Dish, RaidEvent, StoreQuote, WeekPlan } from "../types";

export type RaidPhase = "idle" | "raiding" | "settled" | "failed";

export interface DishVerdict {
  score: number;
  veto: boolean;
  text: string;
}

export interface DishEntry {
  dish: Dish;
  round: number;
  verdict: DishVerdict | null;
  cost: number | null;
  damage: number | null;
}

export interface RaidState {
  phase: RaidPhase;
  party: string | null;
  bossMax: number;
  bossHp: number;
  spent: number;
  dishes: DishEntry[];
  bubbles: Partial<Record<AgentId, string>>;
  speaker: AgentId | null;
  notes: string[];
  quotes: StoreQuote[];
  plan: WeekPlan | null;
  error: string | null;
  strikes: number;
}

export const IDLE_RAID: RaidState = {
  phase: "idle",
  party: null,
  bossMax: 0,
  bossHp: 0,
  spent: 0,
  dishes: [],
  bubbles: {},
  speaker: null,
  notes: [],
  quotes: [],
  plan: null,
  error: null,
  strikes: 0,
};

/**
 * Which agent the app is waiting on right now, judged from what has arrived so far.
 * The Chef pitches first, the Nutritionist reviews open pitches, and the Shopper settles the plan.
 */
export function waitingOn(state: RaidState): AgentId | null {
  if (state.phase !== "raiding") {
    return null;
  }
  if (state.dishes.length === 0) {
    return "chef";
  }
  if (state.dishes.some((entry) => entry.verdict === null)) {
    return "nutritionist";
  }
  const openVetoes = state.dishes.filter((entry) => entry.verdict?.veto).length;
  const revisions = state.dishes.filter((entry) => entry.round > 1).length;
  if (openVetoes > revisions && state.quotes.length === 0 && state.strikes === 0) {
    return "chef";
  }
  return "bargain_hunter";
}

export function beginRaid(): RaidState {
  return { ...IDLE_RAID, phase: "raiding" };
}

function say(state: RaidState, agent: AgentId, text: string): RaidState {
  return { ...state, speaker: agent, bubbles: { ...state.bubbles, [agent]: text } };
}

function updateDish(state: RaidState, dishId: string, patch: Partial<DishEntry>): RaidState {
  return {
    ...state,
    dishes: state.dishes.map((entry) => (entry.dish.id === dishId ? { ...entry, ...patch } : entry)),
  };
}

/** Fold one streamed event into the raid state. Pure: always returns a new state. */
export function applyEvent(state: RaidState, event: RaidEvent): RaidState {
  switch (event.type) {
    case "boss":
      return { ...state, party: event.party, bossMax: event.max_hp, bossHp: event.hp };
    case "proposal": {
      const entry: DishEntry = { dish: event.dish, round: event.round, verdict: null, cost: null, damage: null };
      return say({ ...state, dishes: [...state.dishes, entry] }, "chef", event.text);
    }
    case "verdict": {
      const verdict = { score: event.score, veto: event.veto, text: event.text };
      return say(updateDish(state, event.dish_id, { verdict }), "nutritionist", event.text);
    }
    case "cost":
      return say(updateDish(state, event.dish_id, { cost: event.cost }), "bargain_hunter", event.text);
    case "strike": {
      const struck = updateDish(state, event.dish_id, { damage: event.damage });
      return { ...struck, bossHp: event.hp, spent: event.spent, strikes: state.strikes + 1, speaker: null };
    }
    case "stores":
      return say({ ...state, quotes: event.quotes }, "bargain_hunter", event.text);
    case "system":
      return { ...state, notes: [...state.notes, event.text] };
    case "summary":
      return say(state, "bargain_hunter", event.text);
    case "plan":
      return { ...state, plan: event.plan, spent: event.plan.total_cost };
    case "done":
      return { ...state, phase: state.phase === "failed" ? "failed" : "settled", speaker: null };
    case "error":
      return { ...state, phase: "failed", error: event.text, speaker: null };
  }
}

/** Milliseconds to hold each event on screen so the debate reads as a conversation. */
export const EVENT_PACE_MS: Record<RaidEvent["type"], number> = {
  boss: 700,
  proposal: 1500,
  verdict: 1400,
  cost: 1100,
  strike: 1000,
  stores: 1800,
  system: 900,
  summary: 600,
  plan: 0,
  done: 0,
  error: 0,
};
