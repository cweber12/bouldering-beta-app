/**
 * Holds overlay drawing for CanvasRenderingContext2D.
 *
 * Draws the **Holds** pass: a marker at each inferred Hold on the Route Photo. To
 * mark the spot the climber used *without covering it up*, the marker is a large,
 * thin-bordered, faintly-filled disc with a soft cyan (hand) / orange (foot)
 * glow; the number is set off to the side as black-on-white, tethered to the disc
 * by a short leader line. Labels are placed greedily in first-use order so they
 * never overlap one another or another Hold's disc.
 *
 * Markers reveal progressively: only Holds whose `firstUseTime ≤ t` are drawn, so
 * a marker pops in when the limb first lands and persists to the end.
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
/** Number label background — white. */
const DEFAULT_LABEL_COLOR = "#ffffff";
/** Number text — near-black for contrast on the white label. */
const DEFAULT_NUMBER_COLOR = "#0b0f14";
/** Disc radius × body scale (slightly larger so the marked spot is obvious). */
const DEFAULT_HOLD_RADIUS = 0.34;
/** Disc fill opacity — faint, so the actual wall hold reads through. */
const DEFAULT_FILL_OPACITY = 0.3;
/** Ring stroke width as a fraction of the disc radius (thin border). */
const RING_WIDTH_FRAC = 0.08;
/** Glow blur as a fraction of the disc radius. */
const GLOW_BLUR_FRAC = 0.55;
/** Leader-line width as a fraction of the disc radius. */
const LEADER_WIDTH_FRAC = 0.06;
/** Number label font size × body scale. */
const LABEL_FONT_FRAC = 0.26;

/** Style options for the Holds pass. All optional; unset fields use defaults. */
export interface HoldStyle {
  /** Draw the Holds pass. Default true (callers usually gate via the panel). */
  holdsVisible?: boolean;
  /** Hand Hold disc colour. Default {@link DEFAULT_HAND_COLOR}. */
  handColor?: string;
  /** Foot Hold disc colour. Default {@link DEFAULT_FOOT_COLOR}. */
  footColor?: string;
  /** Number label background colour. Default {@link DEFAULT_LABEL_COLOR}. */
  labelColor?: string;
  /** Number text colour. Default {@link DEFAULT_NUMBER_COLOR}. */
  numberColor?: string;
  /** Disc radius × body scale. Default {@link DEFAULT_HOLD_RADIUS}. */
  radius?: number;
  /** Disc fill opacity in [0, 1]. Default {@link DEFAULT_FILL_OPACITY}. */
  fillOpacity?: number;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Does an axis-aligned rect overlap a circle? */
function rectCircleOverlap(r: Rect, cx: number, cy: number, cr: number): boolean {
  const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
  return Math.hypot(cx - nx, cy - ny) < cr;
}

/** Candidate label directions, in preference order (up-right first). */
const LABEL_ANGLES = [
  -Math.PI / 4, 0, -Math.PI / 2, Math.PI / 4,
  (-3 * Math.PI) / 4, Math.PI / 2, Math.PI, (3 * Math.PI) / 4,
];

interface Placed {
  hold: Hold;
  color: string;
  /** Label rect. */
  rect: Rect;
  /** Label centre. */
  cx: number;
  cy: number;
}

/** Path a (optionally rounded) rect, falling back to a plain rect on engines
 *  without `roundRect` (jsdom / older canvas). */
function pathRoundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  else ctx.rect(r.x, r.y, r.w, r.h);
}

// ---------------------------------------------------------------------------
// Public draw entry point
// ---------------------------------------------------------------------------

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
  const labelColor = style?.labelColor ?? DEFAULT_LABEL_COLOR;
  const numberColor = style?.numberColor ?? DEFAULT_NUMBER_COLOR;
  const r = Math.max(3, (style?.radius ?? DEFAULT_HOLD_RADIUS) * bodyScale);
  const ringWidth = Math.max(1, r * RING_WIDTH_FRAC);
  const leaderWidth = Math.max(1, r * LEADER_WIDTH_FRAC);
  const glowBlur = r * GLOW_BLUR_FRAC;
  const fillOpacity = style?.fillOpacity ?? DEFAULT_FILL_OPACITY;
  const fontPx = Math.max(9, Math.round(bodyScale * LABEL_FONT_FRAC));

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // Visible, in-bounds Holds in first-use order (the order labels are placed).
  const visible = holds
    .filter((hold) => hold.firstUseTime <= t && hold.x >= 0 && hold.x <= w && hold.y >= 0 && hold.y <= h)
    .sort((a, b) => a.order - b.order);
  if (visible.length === 0) return;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fontPx}px sans-serif`;

  // ── Label placement — greedy, in first-use order, so earlier labels keep a
  //    stable spot and never overlap a later one or another Hold's disc. ──
  const padX = fontPx * 0.55;
  const padY = fontPx * 0.34;
  const placed: Placed[] = [];
  for (const hold of visible) {
    const text = String(hold.order);
    const tw = ctx.measureText(text).width;
    const lw = Math.max(tw + 2 * padX, fontPx + 2 * padY);
    const lh = fontPx + 2 * padY;

    let best: Rect | null = null;
    let bestC = { x: 0, y: 0 };
    // Expanding rings of candidate offsets around the disc.
    outer: for (let ring = 0; ring < 6; ring++) {
      const off = r + (0.5 + ring * 0.75) * Math.max(lw, lh);
      for (const angle of LABEL_ANGLES) {
        const cx = hold.x + Math.cos(angle) * off;
        const cy = hold.y + Math.sin(angle) * off;
        const rect: Rect = { x: cx - lw / 2, y: cy - lh / 2, w: lw, h: lh };
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > w || rect.y + rect.h > h) continue;
        const hitsLabel = placed.some((p) => rectsOverlap(rect, p.rect));
        const hitsDisc = visible.some((v) => rectCircleOverlap(rect, v.x, v.y, r));
        if (!hitsLabel && !hitsDisc) {
          best = rect;
          bestC = { x: cx, y: cy };
          break outer;
        }
        // Remember the first candidate as a fallback if nothing fits cleanly.
        if (!best) {
          best = rect;
          bestC = { x: cx, y: cy };
        }
      }
    }
    if (!best) {
      const cx = hold.x + r + lw;
      best = { x: cx - lw / 2, y: hold.y - lh / 2, w: lw, h: lh };
      bestC = { x: cx, y: hold.y };
    }
    placed.push({ hold, color: hold.kind === "hand" ? handColor : footColor, rect: best, cx: bestC.x, cy: bestC.y });
  }

  // ── Pass 1 — discs with a soft glow (drawn first so labels/leaders sit on top). ──
  for (const p of placed) {
    ctx.save();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = glowBlur;
    ctx.globalAlpha = fillOpacity;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.hold.x, p.hold.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Thin opaque border (keeps the glow from the shadow on the stroke too).
    ctx.globalAlpha = 1;
    ctx.lineWidth = ringWidth;
    ctx.strokeStyle = p.color;
    ctx.stroke();
    ctx.restore();
  }

  // ── Pass 2 — leader lines + black-on-white number labels. ──
  for (const p of placed) {
    // Leader from the disc edge toward the label centre; the opaque label is
    // drawn on top, hiding the inner end of the line.
    const dx = p.cx - p.hold.x;
    const dy = p.cy - p.hold.y;
    const len = Math.hypot(dx, dy) || 1;
    const ex = p.hold.x + (dx / len) * r;
    const ey = p.hold.y + (dy / len) * r;
    ctx.lineWidth = leaderWidth;
    ctx.strokeStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(p.cx, p.cy);
    ctx.stroke();

    // Label background — white rounded rect with a thin tinted border.
    pathRoundRect(ctx, p.rect, Math.min(p.rect.h / 2, fontPx * 0.4));
    ctx.fillStyle = labelColor;
    ctx.fill();
    ctx.lineWidth = Math.max(1, leaderWidth);
    ctx.strokeStyle = p.color;
    ctx.stroke();

    // Number — black, centred in the label.
    ctx.fillStyle = numberColor;
    ctx.fillText(String(p.hold.order), p.cx, p.cy);
  }

  ctx.restore();
}
