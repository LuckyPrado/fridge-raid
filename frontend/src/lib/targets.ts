export type Sex = "female" | "male" | "other";
export type Aim = "lighter" | "balanced" | "muscle";

export interface DailyTargets {
  calories: number;
  protein: number;
}

const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;
// Reference weight at the middle of the healthy BMI range. Weight is not asked, so height stands in for it.
const REFERENCE_BMI = 22;
// The Mifflin-St Jeor resting energy equation, with an assumed age because age is not asked.
const ASSUMED_AGE = 30;
const SEX_OFFSET: Record<Sex, number> = { male: 5, female: -161, other: -78 };
// Light daily activity.
const ACTIVITY_FACTOR = 1.45;
const CALORIE_SHIFT: Record<Aim, number> = { lighter: -350, balanced: 0, muscle: 300 };
const PROTEIN_PER_KG: Record<Aim, number> = { lighter: 1.2, balanced: 1.4, muscle: 1.8 };

export const HEIGHT_LIMITS = { minFeet: 4, maxFeet: 7, minCm: 120, maxCm: 220 } as const;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function heightCm(feet: number, inches: number): number {
  const total = (clamp(feet, 0, 8) * INCHES_PER_FOOT + clamp(inches, 0, 11)) * CM_PER_INCH;
  return clamp(Math.round(total), HEIGHT_LIMITS.minCm, HEIGHT_LIMITS.maxCm);
}

/**
 * Starting daily goals from sex, height and aim. An estimate for meal planning, not medical advice:
 * it assumes a mid-range weight for the height, age 30 and light activity.
 */
export function dailyTargets(sex: Sex, cm: number, aim: Aim): DailyTargets {
  const height = clamp(cm, HEIGHT_LIMITS.minCm, HEIGHT_LIMITS.maxCm);
  const weightKg = REFERENCE_BMI * (height / 100) ** 2;
  const resting = 10 * weightKg + 6.25 * height - 5 * ASSUMED_AGE + SEX_OFFSET[sex];
  return {
    calories: clamp(roundTo(resting * ACTIVITY_FACTOR + CALORIE_SHIFT[aim], 50), 1200, 4000),
    protein: clamp(roundTo(weightKg * PROTEIN_PER_KG[aim], 5), 40, 250),
  };
}

/** Keep a typed number inside a range, falling back when the field is empty or not a number. */
export function boundedNumber(text: string, low: number, high: number, fallback: number): number {
  const value = Number(text);
  return text.trim() === "" || !Number.isFinite(value) ? fallback : clamp(value, low, high);
}
