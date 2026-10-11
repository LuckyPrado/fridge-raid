const ALPHA_CUTOFF = 96;
const COLOR_STEP = 24;
const EMOJI_FONTS = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
// Emoji glyphs sit slightly above the text middle line, so nudge them down to center.
const BASELINE_NUDGE = 0.08;
const GLYPH_FILL = 0.82;

const cache = new Map<string, string | null>();

function quantize(channel: number): number {
  return Math.min(255, Math.round(channel / COLOR_STEP) * COLOR_STEP);
}

/** Snap soft edges to fully on or off and flatten colors, so the result reads as pixel art. */
export function hardenPixels(data: Uint8ClampedArray): void {
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < ALPHA_CUTOFF) {
      data[index + 3] = 0;
      continue;
    }
    data[index] = quantize(data[index]);
    data[index + 1] = quantize(data[index + 1]);
    data[index + 2] = quantize(data[index + 2]);
    data[index + 3] = 255;
  }
}

function render(emoji: string, grid: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = grid;
  canvas.height = grid;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.font = `${Math.round(grid * GLYPH_FILL)}px ${EMOJI_FONTS}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(emoji, grid / 2, grid / 2 + grid * BASELINE_NUDGE);
  const image = context.getImageData(0, 0, grid, grid);
  hardenPixels(image.data);
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Draw an emoji onto a tiny canvas and return it as an image URL.
 * Shown enlarged with nearest-neighbor scaling, every food gets a pixel-art icon without an asset pack.
 * Returns null where a canvas is unavailable, and callers fall back to the plain emoji.
 */
export function pixelateEmoji(emoji: string, grid: number): string | null {
  const key = `${grid}:${emoji}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let url: string | null = null;
  try {
    url = render(emoji, grid);
  } catch {
    url = null;
  }
  cache.set(key, url);
  return url;
}
