import { describe, expect, it } from "vitest";

import type { Dish, RaidEvent, WeekPlan } from "../types";
import { applyEvent, beginRaid, IDLE_RAID } from "./raid";
import { parseFrame } from "./stream";

const dish = (id: string, name: string): Dish => ({
  id,
  name,
  pitch: "Bold!",
  description: "",
  ingredients: [{ name: "egg", quantity: 2, unit: "egg" }],
  calories: 400,
  protein_g: 20,
  sodium_mg: 300,
  minutes: 10,
  diets: [],
  steps: [],
});

const plan: WeekPlan = {
  dishes: [dish("d1", "Scramble")],
  cart: [],
  total_cost: 4.5,
  budget: 25,
  rescued: ["spinach"],
  waste_value_total: 6,
  waste_value_saved: 5,
  benched: [],
  store: null,
};

const play = (events: RaidEvent[]) => events.reduce(applyEvent, beginRaid());

describe("applyEvent", () => {
  it("sets the boss health when the raid opens", () => {
    const state = play([{ type: "boss", max_hp: 12, hp: 12, party: "offline", at_risk: ["spinach"] }]);

    expect(state).toMatchObject({ phase: "raiding", bossMax: 12, bossHp: 12, party: "offline" });
  });

  it("adds a proposed dish and gives the chef the floor", () => {
    const state = play([{ type: "proposal", agent: "chef", round: 1, dish: dish("d1", "Scramble"), text: "Eggs!" }]);

    expect(state.dishes).toHaveLength(1);
    expect(state.speaker).toBe("chef");
    expect(state.bubbles.chef).toBe("Eggs!");
  });

  it("attaches a verdict and a cost to the right dish only", () => {
    const state = play([
      { type: "proposal", agent: "chef", round: 1, dish: dish("d1", "Scramble"), text: "a" },
      { type: "proposal", agent: "chef", round: 1, dish: dish("d2", "Ramen"), text: "b" },
      { type: "verdict", agent: "nutritionist", dish_id: "d2", dish_name: "Ramen", score: 20, veto: true, text: "No." },
      { type: "cost", agent: "bargain_hunter", dish_id: "d1", dish_name: "Scramble", cost: 3.5, text: "Adds $3.50." },
    ]);

    expect(state.dishes[0]).toMatchObject({ verdict: null, cost: 3.5 });
    expect(state.dishes[1]).toMatchObject({ verdict: { veto: true, score: 20 }, cost: null });
    expect(state.speaker).toBe("bargain_hunter");
  });

  it("drops boss health and raises spend on a strike", () => {
    const state = play([
      { type: "boss", max_hp: 12, hp: 12, party: "offline", at_risk: [] },
      { type: "proposal", agent: "chef", round: 1, dish: dish("d1", "Scramble"), text: "a" },
      { type: "strike", dish_id: "d1", dish_name: "Scramble", damage: 5, hp: 7, spent: 2.5 },
    ]);

    expect(state).toMatchObject({ bossHp: 7, spent: 2.5, strikes: 1 });
    expect(state.dishes[0].damage).toBe(5);
  });

  it("settles with the plan when the stream finishes", () => {
    const state = play([{ type: "plan", plan }, { type: "done" }]);

    expect(state).toMatchObject({ phase: "settled", spent: 4.5 });
    expect(state.plan?.dishes).toHaveLength(1);
  });

  it("stays failed when an error is followed by done", () => {
    const state = play([{ type: "error", text: "The raid fell apart." }, { type: "done" }]);

    expect(state).toMatchObject({ phase: "failed", error: "The raid fell apart." });
  });

  it("collects system notes without changing the speaker", () => {
    const state = play([{ type: "system", text: "Chef lost the signal." }]);

    expect(state.notes).toEqual(["Chef lost the signal."]);
    expect(state.speaker).toBeNull();
  });

  it("never mutates the previous state", () => {
    const before = beginRaid();
    applyEvent(before, { type: "proposal", agent: "chef", round: 1, dish: dish("d1", "Scramble"), text: "a" });

    expect(before.dishes).toHaveLength(0);
    expect(IDLE_RAID.phase).toBe("idle");
  });
});

describe("parseFrame", () => {
  it("reads a data frame", () => {
    expect(parseFrame('data: {"type":"done"}')).toEqual({ type: "done" });
  });

  it.each(["", ": keep-alive", "data: not json", 'data: {"no_type":1}', "data: 42"])(
    "ignores a frame that is not an event: %s",
    (frame) => {
      expect(parseFrame(frame)).toBeNull();
    },
  );
});
