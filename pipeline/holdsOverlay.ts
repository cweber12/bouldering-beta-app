/**
 * Holds overlay drawing for CanvasRenderingContext2D.
 *
 * Draws the **Holds** pass: a marker at each inferred Hold on the Route Photo /
 * Detection Preview. The unit on the wall is a **single thin colour-coded ring**
 * placed at the hold's *exact* photo-space location — rings never move to make
 * room, so the circle always frames the wall hold it names, and its interior stays
 * clear so the rock reads through. **Blue marks a Hand Hold, orange a Foot Hold**
 * (ADR 0012): colour carries the kind, the only thing the marker says. There is no
 * number, no hand/foot glyph, and no left/right side on the wall — `order` and
 * `side` live in the data but are not painted. The Skeleton already narrates
 * progression, and the reveal timing (below) carries the sequence, so a digit the
 * climber could not read at overlay scale earns nothing.
 *
 * **Coincident Holds of one kind share a ring (clustering).** Left and right limbs
 * are never merged in detection, so a hold used by both hands yields several Holds
 * at one spot; at draw time the Holds within ~one ring radius collapse into a
 * **single ring** rather than a pile of overlapping circles. A spot used by **both
 * a hand and a foot** draws **two concentric rings** (blue outer, orange inner)
 * centred on the spot — both kinds shown, no nudge.
 *
 * Each ring carries a thin dark halo so it reads on light granite or chalky holds
 * as well as on dark rock. Rings reveal progressively: a kind's ring appears when
 * its earliest member of that kind has `firstUseTime ≤ t`, so a ring popping in as
 * the limb lands narrates the sequence as playback advances.
 *
 * The layout is solved against **all in-bounds Holds** up front — ring centres are
 * fixed from the start — so nothing jumps when a later Hold reveals.
 *
 * Sizes are multipliers of the photo-space `bodyScale`, mirroring the Skeleton
 * overlay, so markers look identical at any photo resolution. The per-frame cost is
 * trivial, so geometry is computed inline without a cache.
 *
 * Framework-agnostic — no React imports. Keep it that way so a future baked-in WebM
 * path can reuse it.
 */

import type { Hold } from "@/pipeline/holdDetection";

// ---------------------------------------------------------------------------
// Marker colours — the single source of truth for the Holds look.
//
// Kind is shown by colour: blue = Hand Hold, orange = Foot Hold. A blue/orange
// pair is colour-blind-safe and sits clear of the green pose overlay, so a hold
// ring never blends into the Skeleton when they overlap. Mirror these in
// `app/globals.css` (--color-hand-hold / --color-foot-hold) and `utils/theme.ts`
// (handHold / footHold) for the legend and editor swatches.
// ---------------------------------------------------------------------------

/** Ring colour per limb kind — the whole payload of a Hold marker (ADR 0012). */
export const HOLD_RING_COLOR: Record<"hand" | "foot", string> = {
  hand: "#4BE3AC", // mirror of --color-hand-hold
  foot: "#FFCC29", // mirror of --color-foot-hold
};

/** Thin dark halo stroked just outside the coloured ring so the mark reads on light
 *  or dark rock alike. Overlay-only (drawn over the photo, not theme chrome). */
const HOLD_RING_HALO = "rgba(11, 15, 20, 0.25)";

// ---------------------------------------------------------------------------
// Sizing & layout defaults (× body scale unless noted)
// ---------------------------------------------------------------------------

/** Ring radius × body scale (the marked hold's footprint). */
const DEFAULT_HOLD_RADIUS = 0.45;
/** Ring colour-stroke width as a fraction of the ring radius. */
const CIRCLE_STROKE_FRAC = 0.07;
/** Dark halo width, each side of the colour stroke, as a fraction of that stroke. */
const RING_HALO_FRAC = 0.6;
/** Cluster Holds whose centres fall within this × body scale into one spot — set to
 *  the ring radius, i.e. group only Holds whose rings would visibly overlap. */
const CLUSTER_RADIUS_FRAC = DEFAULT_HOLD_RADIUS;
/** Inner concentric ring radius (the foot ring at a spot used by both kinds) as a
 *  fraction of the outer ring radius — kept well inside so the two rings read apart
 *  while the innermost interior still shows rock. */
const INNER_RING_FRAC = 0.62;

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Clustering — coincident Holds share one spot
//
// Single-link union by centre distance: any two Holds within `clusterDist` join the
// same cluster, so a hold used by both hands (two coincident Holds) reads as one
// ring rather than two stacked circles. A cluster carrying both kinds becomes two
// concentric rings on the shared centroid.
// ---------------------------------------------------------------------------

function clusterHolds(holds: Hold[], clusterDist: number): Hold[][] {
  const n = holds.length;
  const parent = holds.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(holds[i].x - holds[j].x, holds[i].y - holds[j].y) <= clusterDist) {
        union(i, j);
      }
    }
  }
  const groups = new Map<number, Hold[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(holds[i]);
    else groups.set(r, [holds[i]]);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Ring layout — one ring per kind present in a cluster
//
// Each cluster contributes one ring per limb kind it contains, both centred on the
// cluster centroid. When a cluster holds both kinds, the hand ring takes the full
// radius and the foot ring nests inside it, so the spot reads as "hand and foot"
// without a position nudge. A ring reveals at the earliest `firstUseTime` among its
// own kind's members.
// ---------------------------------------------------------------------------

interface Ring {
  /** Shared ring centre in photo px. */
  cx: number;
  cy: number;
  kind: "hand" | "foot";
  radius: number;
  /** Earliest `firstUseTime` among this ring's members — when it reveals. */
  earliestReveal: number;
}

function buildRings(clusters: Hold[][], circleR: number): Ring[] {
  const rings: Ring[] = [];
  for (const members of clusters) {
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    const hasHand = members.some((m) => m.kind === "hand");
    const hasFoot = members.some((m) => m.kind === "foot");
    const both = hasHand && hasFoot;
    const earliest = (kind: "hand" | "foot") =>
      Math.min(...members.filter((m) => m.kind === kind).map((m) => m.firstUseTime));
    if (hasHand) {
      rings.push({ cx, cy, kind: "hand", radius: circleR, earliestReveal: earliest("hand") });
    }
    if (hasFoot) {
      rings.push({
        cx,
        cy,
        kind: "foot",
        radius: both ? circleR * INNER_RING_FRAC : circleR,
        earliestReveal: earliest("foot"),
      });
    }
  }
  return rings;
}

/** Stroke one colour-coded ring: a wider dark halo first, then the colour over it,
 *  leaving a thin dark rim on both edges so the ring reads on any rock. */
function drawRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  stroke: number,
  haloPx: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.strokeStyle = HOLD_RING_HALO;
  ctx.lineWidth = stroke + haloPx * 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Style options
// ---------------------------------------------------------------------------

/** Style options for the Holds pass. The marker look is fixed (colour-coded ring);
 *  only visibility is caller-controlled. */
export interface HoldStyle {
  /** Draw the Holds pass. Default true (callers usually gate via the panel). */
  holdsVisible?: boolean;
}

// ---------------------------------------------------------------------------
// Public draw entry point
// ---------------------------------------------------------------------------

/**
 * Draw the Holds markers gated by playback time.
 *
 * @param ctx       - Canvas 2D context (drawn in photo pixel space).
 * @param holds     - Detected Holds, each with a photo-space `{x, y}`, `kind`, and
 *                    `firstUseTime` in the same clock as `t`.
 * @param t         - Current playback time (seconds). A ring reveals when its
 *                    earliest same-kind member's `firstUseTime ≤ t` (progressive).
 * @param style     - Optional visibility toggle.
 * @param bodyScale - Photo-space body scale (px) the marker sizes multiply by.
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

  const circleR = Math.max(3, DEFAULT_HOLD_RADIUS * bodyScale);
  const circleStroke = Math.max(2, circleR * CIRCLE_STROKE_FRAC);
  const haloPx = Math.max(1, circleStroke * RING_HALO_FRAC);
  const clusterDist = CLUSTER_RADIUS_FRAC * bodyScale;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const inBounds = (hold: Hold) => hold.x >= 0 && hold.x <= w && hold.y >= 0 && hold.y <= h;

  // Layout is solved against ALL in-bounds Holds so ring centres are fixed from the
  // start; only rings revealed by `t` are then drawn.
  const candidates = holds.filter(inBounds);
  if (candidates.length === 0) return;
  const rings = buildRings(clusterHolds(candidates, clusterDist), circleR);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const ring of rings) {
    if (ring.earliestReveal > t) continue;
    drawRing(ctx, ring.cx, ring.cy, ring.radius, HOLD_RING_COLOR[ring.kind], circleStroke, haloPx);
  }
  ctx.restore();
}
