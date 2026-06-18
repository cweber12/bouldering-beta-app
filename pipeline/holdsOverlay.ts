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
const DEFAULT_HOLD_RADIUS = 0.35;
/** Disc fill opacity — faint, so the actual wall hold reads through. */
const DEFAULT_FILL_OPACITY = 0.15;
/** Ring stroke width as a fraction of the disc radius (thin border). */
const RING_WIDTH_FRAC = 0.08;
/** Glow blur as a fraction of the disc radius. */
const GLOW_BLUR_FRAC = 0.55;
/** Leader-line width as a fraction of the disc radius. */
const LEADER_WIDTH_FRAC = 0.06;
/** Number label font size × body scale. */
const LABEL_FONT_FRAC = 0.26;
/**
 * A Hand Hold and a Foot Hold whose centres fall within this fraction of body
 * scale are co-drawn as one split disc (top hand, bottom foot). Mirrors the
 * detection same-place merge radius factor (`DEFAULT_MERGE_RADIUS_FACTOR` in
 * `holdDetection.ts`, ADR 0008) — keep the two in sync.
 */
const DEFAULT_COMBINE_FACTOR = 0.35;

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
  /** Cross-kind combine radius × body scale. Default {@link DEFAULT_COMBINE_FACTOR}. */
  combineFactor?: number;
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

/** A disc to draw: a full single-kind disc, or a split top(hand)/bottom(foot). */
interface DiscUnit {
  cx: number;
  cy: number;
  /** "full" until both halves of a pair are revealed, then "top"+"bottom". */
  segments: { half: "full" | "top" | "bottom"; color: string }[];
}

/** A number label to place, tethered to a point on its disc by a leader. */
interface LabelUnit {
  order: number;
  color: string;
  /** Disc centre (for the full-disc leader to start at the edge). */
  dcx: number;
  dcy: number;
  /** Tether point the leader emanates from (half edge for a split disc). */
  ax: number;
  ay: number;
  /** Preferred placement direction so a split disc's numbers sit by their half. */
  prefer: "up" | "down" | "any";
}

interface Placed {
  unit: LabelUnit;
  /** Label rect. */
  rect: Rect;
  /** Label centre. */
  cx: number;
  cy: number;
}

/** Candidate label directions biased upward / downward for split-disc halves. */
const UP_ANGLES = [-Math.PI / 2, -Math.PI / 4, (-3 * Math.PI) / 4, 0, Math.PI];
const DOWN_ANGLES = [Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4, 0, Math.PI];

/** Path a (optionally rounded) rect, falling back to a plain rect on engines
 *  without `roundRect` (jsdom / older canvas). */
function pathRoundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  else ctx.rect(r.x, r.y, r.w, r.h);
}

// ---------------------------------------------------------------------------
// Cached render plan
//
// The greedy label layout is the per-frame cost the static-Holds change removes
// (ADR 0009). The plan — disc geometry + placed label rects — depends only on
// the Holds, the canvas size, the style sizes, and *which* Holds are revealed.
// With high-water reveal the revealed set only grows, so the plan is recomputed
// at most once per reveal and reused on every frame in between, keyed per canvas.
// ---------------------------------------------------------------------------

/** The time-independent geometry rendered each frame for a given revealed set. */
interface RenderPlan {
  discs: DiscUnit[];
  placed: Placed[];
}

interface PlanCacheEntry {
  holds: Hold[];
  sig: string;
  plan: RenderPlan;
}

/** Per-canvas plan cache. WeakMap so a discarded canvas frees its entry. */
const planCache = new WeakMap<HTMLCanvasElement, PlanCacheEntry>();

/** Sizes the plan geometry depends on (derived from style + body scale). */
interface PlanSizes {
  r: number;
  fontPx: number;
  combineR: number;
  handColor: string;
  footColor: string;
  w: number;
  h: number;
}

/**
 * Build the disc + label geometry for the currently-revealed Holds. Pure
 * geometry — no drawing — so the result can be cached and replayed each frame.
 */
function buildHoldsPlan(
  ctx: CanvasRenderingContext2D,
  holds: Hold[],
  revealed: (hold: Hold) => boolean,
  sizes: PlanSizes,
): RenderPlan {
  const { r, fontPx, combineR, handColor, footColor, w, h } = sizes;

  // ── Pairing — a Hand Hold and its nearest Foot Hold within the combine radius
  //    are co-drawn as one split disc. Same-kind Holds already merged in
  //    detection, so pairing is strictly 1:1 hand↔foot (ADR 0008). ──
  const partnerOf = new Map<string, Hold>();
  const usedFoot = new Set<string>();
  const feet = holds.filter((hold) => hold.kind === "foot");
  for (const hand of holds.filter((hold) => hold.kind === "hand")) {
    let best: Hold | null = null;
    let bestD = Infinity;
    for (const foot of feet) {
      if (usedFoot.has(foot.id)) continue;
      const d = Math.hypot(hand.x - foot.x, hand.y - foot.y);
      if (d <= combineR && d < bestD) {
        best = foot;
        bestD = d;
      }
    }
    if (best) {
      partnerOf.set(hand.id, best);
      partnerOf.set(best.id, hand);
      usedFoot.add(best.id);
    }
  }

  // ── Build the discs + labels actually visible. Each half of a pair reveals
  //    independently: a single-kind disc until the partner lands, then a split
  //    disc at the midpoint (ADR 0008). ──
  const discs: DiscUnit[] = [];
  const labels: LabelUnit[] = [];
  const done = new Set<string>();
  const single = (hold: Hold, color: string) => {
    discs.push({ cx: hold.x, cy: hold.y, segments: [{ half: "full", color }] });
    labels.push({ order: hold.order, color, dcx: hold.x, dcy: hold.y, ax: hold.x, ay: hold.y, prefer: "any" });
  };
  for (const hold of [...holds].sort((a, b) => a.order - b.order)) {
    if (done.has(hold.id)) continue;
    const partner = partnerOf.get(hold.id);
    if (!partner) {
      done.add(hold.id);
      if (revealed(hold)) single(hold, hold.kind === "hand" ? handColor : footColor);
      continue;
    }
    done.add(hold.id);
    done.add(partner.id);
    const hand = hold.kind === "hand" ? hold : partner;
    const foot = hold.kind === "hand" ? partner : hold;
    const handVis = revealed(hand);
    const footVis = revealed(foot);
    if (handVis && footVis) {
      const cx = (hand.x + foot.x) / 2;
      const cy = (hand.y + foot.y) / 2;
      discs.push({
        cx,
        cy,
        segments: [
          { half: "top", color: handColor },
          { half: "bottom", color: footColor },
        ],
      });
      labels.push({ order: hand.order, color: handColor, dcx: cx, dcy: cy, ax: cx, ay: cy - r, prefer: "up" });
      labels.push({ order: foot.order, color: footColor, dcx: cx, dcy: cy, ax: cx, ay: cy + r, prefer: "down" });
    } else if (handVis) {
      single(hand, handColor);
    } else if (footVis) {
      single(foot, footColor);
    }
  }
  if (discs.length === 0) return { discs, placed: [] };

  // Font must be set before measureText so label widths are correct.
  ctx.font = `bold ${fontPx}px sans-serif`;

  // ── Label placement — greedy, in first-use order, so earlier labels keep a
  //    stable spot and never overlap a later one or a disc. ──
  const padX = fontPx * 0.55;
  const padY = fontPx * 0.34;
  const placed: Placed[] = [];
  for (const unit of [...labels].sort((a, b) => a.order - b.order)) {
    const text = String(unit.order);
    const tw = ctx.measureText(text).width;
    const lw = Math.max(tw + 2 * padX, fontPx + 2 * padY);
    const lh = fontPx + 2 * padY;
    const angles = unit.prefer === "up" ? UP_ANGLES : unit.prefer === "down" ? DOWN_ANGLES : LABEL_ANGLES;

    let best: Rect | null = null;
    let bestC = { x: 0, y: 0 };
    // Expanding rings of candidate offsets around the tether point.
    outer: for (let ring = 0; ring < 6; ring++) {
      const off = (0.5 + ring * 0.75) * Math.max(lw, lh);
      for (const angle of angles) {
        const cx = unit.ax + Math.cos(angle) * off;
        const cy = unit.ay + Math.sin(angle) * off;
        const rect: Rect = { x: cx - lw / 2, y: cy - lh / 2, w: lw, h: lh };
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > w || rect.y + rect.h > h) continue;
        const hitsLabel = placed.some((p) => rectsOverlap(rect, p.rect));
        const hitsDisc = discs.some((d) => rectCircleOverlap(rect, d.cx, d.cy, r));
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
      const cx = unit.ax + r + lw;
      best = { x: cx - lw / 2, y: unit.ay - lh / 2, w: lw, h: lh };
      bestC = { x: cx, y: unit.ay };
    }
    placed.push({ unit, rect: best, cx: bestC.x, cy: bestC.y });
  }

  return { discs, placed };
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

  const combineR = Math.max(1, (style?.combineFactor ?? DEFAULT_COMBINE_FACTOR) * bodyScale);

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const inBounds = (hold: Hold) => hold.x >= 0 && hold.x <= w && hold.y >= 0 && hold.y <= h;
  const revealed = (hold: Hold) => hold.firstUseTime <= t && inBounds(hold);

  // Build (or reuse) the render plan. The greedy label layout depends only on the
  // Holds, the canvas, the style sizes, and which Holds are revealed; with
  // high-water reveal that revealed set only grows, so the plan is recomputed at
  // most once per reveal and reused on every frame in between (ADR 0009).
  const revealedSig = holds.filter(revealed).map((hold) => hold.id).join(",");
  const sig = `${w}x${h}|${r}|${fontPx}|${combineR}|${handColor}|${footColor}|${revealedSig}`;
  const cached = planCache.get(ctx.canvas);
  let plan: RenderPlan;
  if (cached && cached.holds === holds && cached.sig === sig) {
    plan = cached.plan;
  } else {
    plan = buildHoldsPlan(ctx, holds, revealed, { r, fontPx, combineR, handColor, footColor, w, h });
    planCache.set(ctx.canvas, { holds, sig, plan });
  }
  const { discs, placed } = plan;
  if (discs.length === 0) return;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fontPx}px sans-serif`;

  // ── Pass 1 — discs with a soft glow (drawn first so labels/leaders sit on top).
  //    A split disc fills each half under a clip and draws a colour-coded ring per
  //    half plus a divider so the hand/foot split reads at a glance. ──
  for (const d of discs) {
    for (const seg of d.segments) {
      ctx.save();
      if (seg.half !== "full") {
        ctx.beginPath();
        if (seg.half === "top") ctx.rect(d.cx - r, d.cy - r, 2 * r, r);
        else ctx.rect(d.cx - r, d.cy, 2 * r, r);
        ctx.clip();
      }
      ctx.shadowColor = seg.color;
      ctx.shadowBlur = glowBlur;
      ctx.globalAlpha = fillOpacity;
      ctx.fillStyle = seg.color;
      ctx.beginPath();
      ctx.arc(d.cx, d.cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Colour-coded ring (full circle, or two semicircle arcs + divider for a split).
    ctx.save();
    ctx.lineWidth = ringWidth;
    if (d.segments.length === 1) {
      ctx.strokeStyle = d.segments[0].color;
      ctx.beginPath();
      ctx.arc(d.cx, d.cy, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const top = d.segments.find((s) => s.half === "top")!;
      const bottom = d.segments.find((s) => s.half === "bottom")!;
      ctx.strokeStyle = top.color;
      ctx.beginPath();
      ctx.arc(d.cx, d.cy, r, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = bottom.color;
      ctx.beginPath();
      ctx.arc(d.cx, d.cy, r, 0, Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(d.cx - r, d.cy);
      ctx.lineTo(d.cx + r, d.cy);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Pass 2 — leader lines + black-on-white number labels. ──
  for (const p of placed) {
    const { unit } = p;
    // Leader toward the label centre. A full disc's tether is its centre, so the
    // leader starts at the edge; a split half tethers at the half edge already.
    let sx = unit.ax;
    let sy = unit.ay;
    if (unit.prefer === "any") {
      const dx = p.cx - unit.dcx;
      const dy = p.cy - unit.dcy;
      const len = Math.hypot(dx, dy) || 1;
      sx = unit.dcx + (dx / len) * r;
      sy = unit.dcy + (dy / len) * r;
    }
    ctx.lineWidth = leaderWidth;
    ctx.strokeStyle = unit.color;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(p.cx, p.cy);
    ctx.stroke();

    // Label background — white rounded rect.
    pathRoundRect(ctx, p.rect, Math.min(p.rect.h / 2, fontPx * 0.4));
    ctx.fillStyle = labelColor;
    ctx.fill();

    // Number — near-black, centred in the label.
    ctx.fillStyle = numberColor;
    ctx.fillText(String(unit.order), p.cx, p.cy);
  }

  ctx.restore();
}
