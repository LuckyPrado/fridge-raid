import type { Sprite } from "./sprite";

export const MAP_WIDTH = 56;
export const MAP_HEIGHT = 28;

const PALETTE = {
  g: "#a9cf7a", G: "#97c16a", r: "#ecdcab", e: "#d9c68d",
  R: "#c8643c", o: "#a84e2c", w: "#fbeed0", d: "#7a4a2b", n: "#8fc1d6",
  t: "#3f7d4a", T: "#63a55f", S: "#2f6b4a", s: "#1d4a32", a: "#f6cf3d", b: "#7cc3d6", B: "#a3d9e6",
} as const;

const HOUSE = [".RRRR.", "RRRRRR", "oooooo", "wnwwnw", "wwwdww"];
const TREE = ["tT", "tt"];
const STORE = ["SSSSSSSSSS", "SSSSSSSSSS", "ssssssssss", "awawawawaw", "wnnwddwnnw", "wnnwddwnnw"];
const POND = [".bbbb.", "bBbbbb", "bbbbBb", ".bbbb."];

const ROAD_ROWS = [13, 14];
const ROAD_COLUMNS = [18, 19, 38, 39];

const HOUSES: ReadonlyArray<[number, number]> = [
  [3, 2], [10, 6], [22, 1], [29, 6], [42, 2], [49, 7], [3, 17], [10, 22], [42, 17], [49, 22], [29, 21],
];
const TREES: ReadonlyArray<[number, number]> = [
  [1, 9], [15, 2], [15, 10], [26, 10], [35, 3], [46, 11], [53, 3], [1, 24], [15, 18], [35, 24],
  [53, 18], [22, 24], [8, 12], [34, 10], [46, 25],
];

export const STORE_POSITION = { x: 23, y: 16, width: STORE[0].length, height: STORE.length } as const;

function stamp(grid: string[][], shape: readonly string[], left: number, top: number): void {
  shape.forEach((row, dy) => {
    Array.from(row).forEach((cell, dx) => {
      const y = top + dy;
      const x = left + dx;
      if (cell !== "." && grid[y]?.[x] !== undefined) {
        grid[y][x] = cell;
      }
    });
  });
}

/** Grass with a fixed scatter of darker tufts, so the map looks the same on every render. */
function grass(x: number, y: number): string {
  return (x * 7 + y * 13) % 11 === 0 ? "G" : "g";
}

/** A small top-down neighborhood drawn in code: roads, houses, trees, and the store. */
export function buildTownMap(): Sprite {
  const grid = Array.from({ length: MAP_HEIGHT }, (_, y) => Array.from({ length: MAP_WIDTH }, (_, x) => grass(x, y)));
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      if (ROAD_ROWS.includes(y) || ROAD_COLUMNS.includes(x)) {
        grid[y][x] = (x + y) % 5 === 0 ? "e" : "r";
      }
    }
  }
  stamp(grid, POND, 47, 14);
  HOUSES.forEach(([x, y]) => stamp(grid, HOUSE, x, y));
  TREES.forEach(([x, y]) => stamp(grid, TREE, x, y));
  stamp(grid, STORE, STORE_POSITION.x, STORE_POSITION.y);
  return { rows: grid.map((row) => row.join("")), palette: PALETTE };
}
