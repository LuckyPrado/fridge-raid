// End-to-end walk through the demo script against running dev servers.
// Usage: node e2e/demo.mjs [screenshot-dir]   (needs Chrome installed; servers on 5173 and 8000)
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (message) => message.type() === "error" && problems.push(`console: ${message.text()}`));
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

await page.goto(APP_URL);
await page.getByRole("button", { name: /The Dorm Fridge/ }).click();
await page.getByRole("button", { name: /^spinach/ }).waitFor();
await page.waitForFunction(() => /\$\d+\.\d\d of food about to spoil/.test(document.body.innerText));
await page.screenshot({ path: join(shots, "1-fridge.png"), fullPage: true });

// Drag spinach into the arena with the mouse.
await page.getByRole("button", { name: /^spinach/ }).scrollIntoViewIfNeeded();
const spinach = await page.getByRole("button", { name: /^spinach/ }).boundingBox();
const zone = await page.locator(".dropzone").boundingBox();
await page.mouse.move(spinach.x + spinach.width / 2, spinach.y + spinach.height / 2);
await page.mouse.down();
await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 12 });
await page.mouse.up();
check((await page.locator(".chip").count()) === 1, "dragging spinach did not add it to the arena");

// Click a second ingredient to add it, the keyboard-friendly path.
await page.getByRole("button", { name: /^egg/ }).click();
check((await page.locator(".chip").count()) === 2, "clicking egg did not add it to the arena");
await page.screenshot({ path: join(shots, "2-arena.png"), fullPage: true });

await page.getByRole("button", { name: "Start the raid" }).click();
await page.locator(".stamp--veto").first().waitFor({ timeout: 60_000 });
await page.screenshot({ path: join(shots, "3-debate.png"), fullPage: true });

await page.getByRole("button", { name: "Skip to the result" }).click();
await page.getByRole("button", { name: /Accept plan/ }).waitFor({ timeout: 60_000 });
await page.waitForTimeout(900);
await page.screenshot({ path: join(shots, "4-plan.png"), fullPage: true });
const title = await page.locator(".plan__title").innerText();
check(/\d meals/.test(title), `unexpected plan title: ${title}`);
check((await page.locator(".tag--hit").count()) > 0, "no dish dealt damage to the boss");

await page.getByRole("button", { name: /Accept plan/ }).click();
await page.getByText(/Plan accepted/).waitFor();
check(await page.getByText(/of food saved across \d+ raid/).isVisible(), "raid history did not update");
await page.screenshot({ path: join(shots, "5-accepted.png"), fullPage: true });

await page.reload();
await page.locator(".sprite").first().waitFor();
check((await page.locator(".sprite").count()) > 0, "inventory did not survive a reload");

await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(shots, "6-mobile.png"), fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 1, `page overflows horizontally by ${overflow}px at 375px wide`);

await browser.close();
if (problems.length > 0) {
  process.stderr.write(`FAILED\n${problems.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`PASSED: demo flow works. Screenshots in ${shots}\n`);
