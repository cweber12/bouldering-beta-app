/**
 * Holds overlay drawing for CanvasRenderingContext2D.
 *
 * Draws the **Holds** pass: a numbered marker at each inferred Hold on the Route
 * Photo — a filled disc (Hand Hold cyan, Foot Hold orange) with a dark ring and a
 * white centred number for legibility over an arbitrary wall photo. Markers
 * reveal progressively: only Holds whose `firstUseTime ≤ t` are drawn, so a
 * marker pops in when the limb first lands and persists to the end.
 *
 * Sizes are multipliers of the photo-space `bodyScale`, mirroring the Skeleton
 * overlay, so markers look identical at any photo resolution.
 *
 * Framework-agnostic — no React imports. Keep it that way so a future baked-in
 * WebM path can reuse it.
 */

import type { Hold } from "@/pipeline/holdDetection";

// ---------------------------------------------------------------------------
// Defaults (× body scale unless noted)
// ---------------------------------------------------------------------------

/** Hand Hold disc colour — cyan (mirrors `--color-hand-hold`). */
const DEFAULT_HAND_COLOR = "#22d3ee";
/** Foot Hold disc colour — orange (mirrors `--color-foot-hold`). */
const DEFAULT_FOOT_COLOR = "#fb923c";
/** Dark ring around every disc — near-black for contrast on any wall. */
const DEFAULT_RING_COLOR = "#0b0f14";
/** White centred number. */
const DEFAULT_NUMBER_COLOR = "#ffffff";
/** Disc radius × body scale (big enough to hold a one/two-digit number). */
const DEFAULT_HOLD_RADIUS = 0.3;
/** Ring stroke width as a fraction of the disc radius. */
const RING_WIDTH_FRAC = 0.18;

/** Style options for the Holds pass. All optional; unset fields use defaults. */
export interface HoldStyle {
  /** Draw the Holds pass. Default true (callers usually gate via the panel). */
  holdsVisible?: boolean;
  /** Hand Hold disc colour. Default {@link DEFAULT_HAND_COLOR}. */
  handColor?: string;
  /** Foot Hold disc colour. Default {@link DEFAULT_FOOT_COLOR}. */
  footColor?: string;
  /** Disc ring colour. Default {@link DEFAULT_RING_COLOR}. */
  ringColor?: string;
  /** Number colour. Default {@link DEFAULT_NUMBER_COLOR}. */
  numberColor?: string;
  /** Disc radius × body scale. Default {@link DEFAULT_HOLD_RADIUS}. */
  radius?: number;
}

/**
 * Draw the Holds markers gated by playback time.
 *
 * @param ctx       - Canvas 2D context (drawn in photo pixel space).
 * @param holds     - Detected Holds, each with a photo-space `{x, y}`, `order`,
 *                    and `firstUseTime` in the same clock as `t`.
 * @param t         - Current playback time (seconds). Holds first used after this
 *                    are not yet drawn (progressive, cumulative reveal).
 * @param style     - Optional colour / size overrides.
 * @param bodyScale - Photo-space body scale (px) the disc radius multiplies by.
 */
export function drawHolds(
  ctx: CanvasRenderingContext2D,
  holds: Hold[],
  t: number,
  style: HoldStyle | undefined,
  bodyScale: number,
): void {
  if (style?.holdsVisible === false) return;
  if (holds.length === 0) return;

  const handColor = style?.handColor ?? DEFAULT_HAND_COLOR;
  const footColor = style?.footColor ?? DEFAULT_FOOT_COLOR;
  const ringColor = style?.ringColor ?? DEFAULT_RING_COLOR;
  const numberColor = style?.numberColor ?? DEFAULT_NUMBER_COLOR;
  const r = Math.max(2, (style?.radius ?? DEFAULT_HOLD_RADIUS) * bodyScale);
  const ringWidth = Math.max(1, r * RING_WIDTH_FRAC);

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.save();
  ctx.lineWidth = ringWidth;
  ctx.strokeStyle = ringColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.max(8, Math.round(r))}px sans-serif`;

  for (const hold of holds) {
    // Progressive reveal: not yet first used.
    if (hold.firstUseTime > t) continue;
    // Drop markers whose projected point falls outside the Route Photo bounds.
    if (hold.x < 0 || hold.x > w || hold.y < 0 || hold.y > h) continue;

    ctx.fillStyle = hold.kind === "hand" ? handColor : footColor;
    ctx.beginPath();
    ctx.arc(hold.x, hold.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = numberColor;
    ctx.fillText(String(hold.order), hold.x, hold.y);
  }

  ctx.restore();
}
