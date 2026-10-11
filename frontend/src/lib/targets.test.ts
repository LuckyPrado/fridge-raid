import { describe, expect, it } from "vitest";

import { boundedNumber, dailyTargets, heightCm } from "./targets";

describe("heightCm", () => {
  it("converts feet and inches and keeps the result in a human range", () => {
    expect([heightCm(5, 6), heightCm(6, 0), heightCm(0, 0), heightCm(9, 30)]).toEqual([168, 183, 120, 220]);
  });
});

describe("dailyTargets", () => {
  it("gives a taller person and a man higher goals", () => {
    const short = dailyTargets("female", 160, "balanced");
    const tall = dailyTargets("female", 180, "balanced");
    const man = dailyTargets("male", 180, "balanced");

    expect(tall.calories).toBeGreaterThan(short.calories);
    expect(tall.protein).toBeGreaterThan(short.protein);
    expect(man.calories).toBeGreaterThan(tall.calories);
  });

  it("moves calories and protein with the aim", () => {
    const lighter = dailyTargets("other", 170, "lighter");
    const balanced = dailyTargets("other", 170, "balanced");
    const muscle = dailyTargets("other", 170, "muscle");

    expect(balanced.calories - lighter.calories).toBe(350);
    expect(muscle.calories - balanced.calories).toBe(300);
    expect(muscle.protein).toBeGreaterThan(balanced.protein);
  });

  it("returns round, plausible numbers for a typical adult", () => {
    expect(dailyTargets("male", 178, "balanced")).toEqual({ calories: 2400, protein: 100 });
    expect(dailyTargets("female", 165, "lighter")).toEqual({ calories: 1550, protein: 70 });
  });

  it("stays inside what the app accepts for extreme heights", () => {
    const tiny = dailyTargets("female", 50, "lighter");
    const huge = dailyTargets("male", 400, "muscle");

    expect(tiny.calories).toBeGreaterThanOrEqual(1200);
    expect(huge.calories).toBeLessThanOrEqual(4000);
    expect(huge.protein).toBeLessThanOrEqual(250);
  });
});

describe("boundedNumber", () => {
  it("clamps typed numbers and falls back on junk", () => {
    expect([
      boundedNumber("40", 0, 500, 25),
      boundedNumber("99999", 0, 500, 25),
      boundedNumber("-3", 1, 7, 4),
      boundedNumber("", 1, 7, 4),
      boundedNumber("abc", 1, 7, 4),
    ]).toEqual([40, 500, 1, 4, 4]);
  });
});
