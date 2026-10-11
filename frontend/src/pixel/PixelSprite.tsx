import { useMemo } from "react";

import { drawSprite, type Sprite } from "./sprite";

interface PixelSpriteProps {
  sprite: Sprite;
  /** Screen pixels per sprite pixel. */
  scale?: number;
  outline?: string;
  label?: string;
  className?: string;
}

/** Draws a hand-authored pixel sprite as crisp SVG rectangles. */
export function PixelSprite({ sprite, scale = 3, outline, label, className }: PixelSpriteProps) {
  const drawing = useMemo(() => drawSprite(sprite, outline), [sprite, outline]);
  return (
    <svg
      className={className}
      width={drawing.width * scale}
      height={drawing.height * scale}
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {drawing.rects.map((rect) => (
        <rect key={`${rect.x}-${rect.y}`} x={rect.x} y={rect.y} width={rect.width} height={1} fill={rect.color} />
      ))}
    </svg>
  );
}
