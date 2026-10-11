import { useMemo } from "react";

import { pixelateEmoji } from "./pixelate";

interface PixelEmojiProps {
  emoji: string;
  /** Rendered width and height in CSS pixels. */
  size?: number;
  /** Pixels across the tiny source grid. Lower is chunkier. */
  grid?: number;
  className?: string;
}

/** A food or dish icon: an emoji redrawn on a small grid and scaled up with hard pixel edges. */
export function PixelEmoji({ emoji, size = 40, grid = 16, className }: PixelEmojiProps) {
  const url = useMemo(() => pixelateEmoji(emoji, grid), [emoji, grid]);
  if (!url) {
    return (
      <span className={className} style={{ fontSize: size * 0.8, lineHeight: 1 }} aria-hidden="true">
        {emoji}
      </span>
    );
  }
  return <img className={`pixelated ${className ?? ""}`} src={url} width={size} height={size} alt="" />;
}
