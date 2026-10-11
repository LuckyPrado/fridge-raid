// End-to-end walk through the phone flow against running dev servers.
// Usage: node e2e/demo.mjs [screenshot-dir]   (needs Chrome installed; servers on 5173 and 8000)
// The walk expects offline mode (no GEMINI_API_KEY) and resets the saved fridge before it starts.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5173/";
const shots = process.argv[2] ?? "e2e/screenshots";
mkdirSync(shots, { recursive: true });

const problems = [];
const check = (condition, message) => {
  if (!condition) {
    problems.push(message);
  }
};

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on("console", (message) => message.type() === "error" && problems.push(`console: ${message.text()}`));
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
const noSidewaysScroll = async (label) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${label}: page scrolls sideways by ${overflow}px`);
};
const tab = (name) => page.getByRole("navigation", { name: "Main" }).getByRole("button", { name });

// Start from an empty fridge so the walk is repeatable.
await page.request.put(new URL("/api/inventory", APP_URL).href, { data: { items: [] } });
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
await page.request.put(new URL(`/api/day/${today}/water`, APP_URL).href, { data: { glasses: 0 } });

await page.goto(APP_URL);
await page.getByRole("heading", { name: "Fridge Raid" }).waitFor();
await shot("1-home");
await noSidewaysScroll("home");

// Scan: the demo camera reads the sample dorm fridge.
await page.getByRole("button", { name: "Scan my fridge" }).click();
await page.getByRole("heading", { name: "Fridge scan" }).waitFor();
await page.getByRole("button", { name: "Dorm Fridge" }).click();
await shot("2-scan");
await noSidewaysScroll("scan");
await page.getByRole("button", { name: "Scan the sample fridge" }).click();

// Review the stash and fix one amount.
await page.getByRole("heading", { name: "Look what we found!" }).waitFor();
await page.getByText(/of food we can save/).waitFor();
await shot("3-fridge");
await noSidewaysScroll("fridge");
await page.getByRole("button", { name: "Edit spinach" }).click();
await page.getByLabel("Amount").fill("5");
await page.getByRole("button", { name: "Save changes" }).click();
await page.getByText("5 cup · produce").waitFor();

// The party plans. The Nutritionist vetoes one dish and the Chef revises.
await page.getByRole("button", { name: /Confirm stash/ }).click();
await page.getByText("Vetoed").first().waitFor({ timeout: 30000 });
await shot("4-huddle");
await page.getByRole("button", { name: "Skip to the plan" }).click();
await page.getByRole("button", { name: /See my \d recipes/ }).waitFor({ timeout: 30000 });
check(await page.getByText(/Take 2/).count() > 0, "huddle: no revised dish after the veto");
await shot("5-huddle-done");
await noSidewaysScroll("huddle");
await page.getByRole("button", { name: /See my \d recipes/ }).click();

// Chef list, then cook the featured recipe.
await page.getByRole("heading", { name: "Made for your fridge" }).waitFor();
await shot("6-chef");
await noSidewaysScroll("chef");
await page.locator(".feature").click();
await page.getByRole("heading", { name: "Your cooking quest" }).waitFor();
await shot("7-recipe");
await noSidewaysScroll("recipe");
await page.getByRole("button", { name: /Cook and log it/ }).click();
await page.getByRole("button", { name: "Cooked and logged" }).waitFor();
check(await page.getByText(/\+\d+ XP/).count() > 0, "recipe: no XP toast after cooking");

// Goals: the cooked meal is logged; add water and a snack; set a favorite food.
await tab("Goals").click();
await page.getByText("Cooked from your plan").first().waitFor();
await page.getByRole("button", { name: "Log glass 3" }).click();
await page.getByText("3 / 8 glasses").waitFor();
await page.getByRole("button", { name: "+ Log food" }).click();
await page.getByLabel("What did you eat?").fill("Yogurt bowl");
await page.getByRole("dialog").getByRole("button", { name: "Log food" }).click();
await page.getByText("Logged by hand").first().waitFor();
await page.getByRole("button", { name: "Edit goals", exact: true }).first().click();
await page.getByLabel("Your name").fill("Alex");
await page.getByLabel("Favorite foods").fill("tacos, pasta");
await shot("8-goals-sheet");
await page.getByRole("button", { name: "Save goals" }).click();
await page.getByText("Tacos", { exact: true }).waitFor();
await shot("9-goals");
await noSidewaysScroll("goals");

// Shop and the shopping plan.
await tab("Shop").click();
await page.getByRole("heading", { name: "Good finds, close by" }).waitFor();
await shot("10-shop");
await noSidewaysScroll("shop");
await page.getByRole("button", { name: /View my \$[\d.]+ shopping plan/ }).click();
await page.getByRole("heading", { name: "Your shopping loot" }).waitFor();
await page.getByRole("checkbox").first().click();
check(await page.getByRole("checkbox", { checked: true }).count() === 1, "plan: checking an item did not stick");
await shot("11-plan");
await noSidewaysScroll("plan");

// Everything survives a reload.
await page.reload();
await page.getByRole("heading", { name: "Fridge Raid" }).waitFor();
await page.getByText("Hey, Alex").waitFor();
await tab("Chef").click();
await page.getByText("Cooked and logged").first().waitFor();
await tab("Home").click();
await shot("12-home-after");

// A narrow phone still fits.
await page.setViewportSize({ width: 320, height: 640 });
await noSidewaysScroll("home at 320px");
await tab("Goals").click();
await noSidewaysScroll("goals at 320px");

await browser.close();
if (problems.length > 0) {
  process.stderr.write(`FAILED\n${problems.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`PASSED. Screenshots in ${shots}\n`);
