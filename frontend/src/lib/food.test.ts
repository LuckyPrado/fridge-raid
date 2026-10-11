import { describe, expect, it } from "vitest";

import {
  amountLabel,
  capitalize,
  daysLabel,
  dishSprite,
  ingredientLabel,
  isAtRisk,
  isPantry,
  listOf,
  money,
  packLabel,
  plural,
  spriteFor,
  spriteForName,
} from "./food";

describe("food icons", () => {
  it("matches an item by keyword and falls back to the category", () => {
    expect(spriteFor({ name: "baby spinach", category: "produce" })).toBe("🥬");
    expect(spriteFor({ name: "mystery jar", category: "condiment" })).toBe("🥫");
    expect(spriteForName("lemon")).toBe("🍋");
  });

  it("picks a dish icon from the dish name", () => {
    const icons = [dishSprite("Spinach and Egg Scramble Tacos"), dishSprite("Tofu Coconut Curry"), dishSprite("Mystery Plate")];

    expect(icons).toEqual(["🌮", "🍛", "🍽️"]);
  });
});

describe("food labels", () => {
  it("labels days left in plain words", () => {
    expect([daysLabel(-1), daysLabel(0), daysLabel(1), daysLabel(5), daysLabel(200)]).toEqual([
      "expired",
      "today",
      "1 day",
      "5 days",
      "pantry",
    ]);
  });

  it("flags food expiring within three days and food that keeps", () => {
    expect([isAtRisk(3), isAtRisk(4)]).toEqual([true, false]);
    expect([isPantry(59), isPantry(60)]).toEqual([false, true]);
  });

  it("drops units that only repeat the food name", () => {
    expect(ingredientLabel(4, "egg", "egg")).toBe("4 egg");
    expect(ingredientLabel(2, "whole", "zucchini")).toBe("2 zucchini");
    expect(ingredientLabel(0.5, "cup", "feta")).toBe("0.5 cup feta");
    expect([amountLabel(4, "egg", "egg"), amountLabel(1.5, "cup", "rice")]).toEqual(["4", "1.5 cup"]);
  });

  it("describes how a grocery line is sold", () => {
    expect(packLabel(1, 12, "egg", "egg")).toBe("1 pack of 12");
    expect(packLabel(2, 1, "whole", "zucchini")).toBe("2");
    expect(packLabel(1, 10, "cup", "oats")).toBe("1 × 10 cup");
  });

  it("formats money, lists, and plurals", () => {
    expect(money(3.5)).toBe("$3.50");
    expect([listOf([]), listOf(["a"]), listOf(["a", "b"]), listOf(["a", "b", "c"])]).toEqual(["", "a", "a and b", "a, b and c"]);
    expect([plural(1, "meal"), plural(3, "meal"), plural(2, "match")]).toEqual(["1 meal", "3 meals", "2 matches"]);
    expect(capitalize("spinach")).toBe("Spinach");
  });
});
