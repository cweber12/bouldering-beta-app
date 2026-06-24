import { HOLD_GLYPH_PATH, HOLD_GLYPH_VIEWBOX } from "@/pipeline/holdsOverlay";

export interface HoldGlyphIconProps {
  kind: "hand" | "foot";
  /** Mirrors the glyph for the left side, matching the overlay marker. */
  side?: "left" | "right";
  className?: string;
}

/**
 * Outlined hand / foot glyph icon, drawn with `currentColor` so it follows the
 * surrounding text colour in the UI. It echoes the Holds overlay marker, which
 * differentiates holds by **shape** (hand vs foot) and **orientation** (mirrored
 * for the left side) in a single colour — so legends and the editor read the same
 * way as the marks on the wall.
 */
export default function HoldGlyphIcon({ kind, side = "right", className }: HoldGlyphIconProps) {
  const vb = HOLD_GLYPH_VIEWBOX[kind];
  const strokeWidth = vb * 0.08;
  return (
    <svg
      viewBox={`0 0 ${vb} ${vb}`}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path
        d={HOLD_GLYPH_PATH[kind]}
        transform={side === "left" ? `translate(${vb} 0) scale(-1 1)` : undefined}
      />
    </svg>
  );
}
