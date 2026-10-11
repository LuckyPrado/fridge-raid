import { describe, expect, it } from "vitest";

import { tabOf, TABS } from "../nav";
import { parseFavorites } from "../screens/GoalSheets";
import { AGENT_SPRITES, ICONS } from "./art";
import { hardenPixels } from "./pixelate";
import { drawSprite, type Sprite } from "./sprite";
import { buildTownMap, MAP_HEIGHT, MAP_WIDTH, STORE_POSITION } from "./townMap";

const DOT: Sprite = { rows: ["AA.", ".B."], palette: { A: "red", B: "blue" } };

describe("drawSprite", () => {
  it("merges neighbors of one color into a single run and skips transparent cells", () => {
    expect(drawSprite(DOT)).toEqual({
      width: 3,
      height: 2,
      rects: [
        { x: 0, y: 0, width: 2, color: "red" },
        { x: 1, y: 1, width: 1, color: "blue" },
      ],
    });
  });

  it("adds a one-pixel outline around the shape when asked", () => {
    const drawing = drawSprite({ rows: ["A"], palette: { A: "red" } }, "black");
    const outline = drawing.rects.filter((rect) => rect.color === "black");

    expect([drawing.width, drawing.height]).toEqual([3, 3]);
    expect(outline.reduce((sum, rect) => sum + rect.width, 0)).toBe(4);
    expect(drawing.rects).toContainEqual({ x: 1, y: 1, width: 1, color: "red" });
  });

  it("ignores keys that are missing from the palette", () => {
    expect(drawSprite({ rows: ["?A"], palette: { A: "red" } }).rects).toEqual([{ x: 1, y: 0, width: 1, color: "red" }]);
  });
});

describe("pixel art data", () => {
  const sprites: Array<[string, Sprite]> = Object.entries({ ...AGENT_SPRITES, ...ICONS });

  it.each(sprites)("%s has rows of equal width and only known colors", (_name, sprite) => {
    const widths = new Set(sprite.rows.map((row) => row.length));
    const keys = new Set(sprite.rows.join("").replace(/\./g, ""));

    expect(widths.size).toBe(1);
    expect([...keys].filter((key) => !(key in sprite.palette))).toEqual([]);
  });

  it("draws icons on a 12 by 12 grid", () => {
    for (const icon of Object.values(ICONS)) {
      expect([icon.rows.length, icon.rows[0].length]).toEqual([12, 12]);
    }
  });
});

describe("hardenPixels", () => {
  it("drops faint pixels and makes the rest solid with flattened colors", () => {
    const data = new Uint8ClampedArray([200, 100, 50, 40, 201, 99, 51, 180]);

    hardenPixels(data);

    expect(data[3]).toBe(0);
    expect(Array.from(data.slice(4))).toEqual([192, 96, 48, 255]);
  });
});

describe("buildTownMap", () => {
  it("builds a full map with the store where the pin points", () => {
    const map = buildTownMap();
    const storeRow = map.rows[STORE_POSITION.y];

    expect(map.rows).toHaveLength(MAP_HEIGHT);
    expect(map.rows.every((row) => row.length === MAP_WIDTH)).toBe(true);
    expect(storeRow.slice(STORE_POSITION.x, STORE_POSITION.x + STORE_POSITION.width)).toBe("SSSSSSSSSS");
    expect([...new Set(map.rows.join(""))].filter((key) => !(key in map.palette))).toEqual([]);
  });
});

describe("navigation", () => {
  it("highlights the right tab and hides the bar on full-screen flows", () => {
    expect([tabOf("home"), tabOf("recipe"), tabOf("plan"), tabOf("scan"), tabOf("huddle")]).toEqual([
      "home",
      "chef",
      "shop",
      null,
      null,
    ]);
    expect(TABS.map((tab) => tab.id)).toEqual(["home", "fridge", "chef", "goals", "shop"]);
  });
});

describe("parseFavorites", () => {
  it("cleans, dedupes, and caps the list", () => {
    expect(parseFavorites(" Pasta, tacos ,, pasta,EGGS")).toEqual(["pasta", "tacos", "eggs"]);
    expect(parseFavorites("a,b,c,d,e,f,g,h,i,j")).toHaveLength(8);
    expect(parseFavorites("x".repeat(50))[0]).toHaveLength(30);
  });
});
