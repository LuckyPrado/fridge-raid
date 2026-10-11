/** A sprite is rows of single-character color keys. "." is transparent. */
export interface Sprite {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
}

export interface SpriteRect {
  x: number;
  y: number;
  width: number;
  color: string;
}

export interface SpriteDrawing {
  width: number;
  height: number;
  rects: SpriteRect[];
}

const EMPTY = ".";
const OUTLINE_KEY = "\u0000";

function padded(rows: readonly string[]): string[] {
  const width = Math.max(...rows.map((row) => row.length));
  const blank = EMPTY.repeat(width + 2);
  return [blank, ...rows.map((row) => `${EMPTY}${row.padEnd(width, EMPTY)}${EMPTY}`), blank];
}

function withOutline(rows: readonly string[]): string[] {
  const grid = padded(rows);
  const filled = (x: number, y: number): boolean => {
    const cell = grid[y]?.[x];
    return cell !== undefined && cell !== EMPTY;
  };
  return grid.map((row, y) =>
    Array.from(row, (cell, x) => {
      const touches = filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1);
      return cell === EMPTY && touches ? OUTLINE_KEY : cell;
    }).join(""),
  );
}

/**
 * Turn a sprite into horizontal runs of one color, ready to draw as rectangles.
 * With an outline color, every empty cell that touches a filled one is painted with it.
 */
export function drawSprite(sprite: Sprite, outline?: string): SpriteDrawing {
  const rows = outline ? withOutline(sprite.rows) : [...sprite.rows];
  const colorOf = (key: string): string | undefined => (key === OUTLINE_KEY ? outline : sprite.palette[key]);
  const rects: SpriteRect[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      const color = key === EMPTY ? undefined : colorOf(key);
      let end = x + 1;
      while (end < row.length && row[end] === key) {
        end += 1;
      }
      if (color) {
        rects.push({ x, y, width: end - x, color });
      }
      x = end;
    }
  });
  return { width: Math.max(0, ...rows.map((row) => row.length)), height: rows.length, rects };
}
