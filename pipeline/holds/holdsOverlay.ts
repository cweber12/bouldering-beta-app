/**
 * Holds overlay drawing for CanvasRenderingContext2D.
 *
 * Draws the **Holds** pass: a marker at each inferred Hold on the Route Photo /
 * Detection Preview. The unit on the wall is a **single thin colour-coded ring**
 * placed at the hold's *exact* photo-space location — rings never move to make
 * room, so the circle always frames the wall hold it names, and its interior stays
 * clear so the rock reads through. **Cyan marks a Hand Hold, orange marks a Foot Hold**
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
 * a hand and a foot** draws **two concentric rings** (cyan outer, orange inner)
 * centred on the spot — the inner ring nested right inside the outer one (edges
 * touching) so both kinds show without a nudge and the clear interior stays large.
 *
 * When two rings from **different** spots sit close enough that their outlines would
 * cross, the overlapping arc is **clipped away** rather than drawn over — each ring's
 * stroke is confined to the region outside its neighbours' discs, so the pair reads as
 * a single clean union outline with no crossing lines and every hold stays framed.
 * Concentric same-spot rings (the hand/foot pair) share a centre and are exempt, so the
 * nested inner ring is never carved out by its own outer ring.
 *
 * Each ring is a flat colour stroke carrying an **outer-only drop shadow** — the
 * blur is clipped to the region outside the ring, so it darkens the wall around the
 * marker while the interior stays clear and reads as highlighted. The stroke itself
 * is the exact Hand/Foot token colour shown in the Holds dropdown swatches. Rings reveal
 * progressively: a kind's ring appears when its earliest member of that kind has
 * `firstUseTime ≤ t`, so a ring popping in as the limb lands narrates the sequence
 * as playback advances.
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

import type { Hold } from "@/pipeline/holds/holdDetection";

// ---------------------------------------------------------------------------
// Marker colours — the single source of truth for the Holds look.
//
// Kind is shown by colour: cyan = Hand Hold, orange = Foot Hold. A cyan/orange
// pair is colour-blind-safe and sits clear of the green pose overlay, so a hold
// ring never blends into the Skeleton when they overlap. Mirror these in
// `app/globals.css` (--color-hand-hold / --color-foot-hold) and `utils/theme.ts`
// (handHold / footHold) for the legend and editor swatches.
// ---------------------------------------------------------------------------

/** Ring colour per limb kind — the whole payload of a Hold marker (ADR 0012). */
export const HOLD_RING_COLOR: Record<"hand" | "foot", string> = {
  hand: "#39B1D1", // mirror of --color-hand-hold
  foot: "#F6850C", // mirror of --color-foot-hold
};

// ---------------------------------------------------------------------------
// Sizing & layout defaults (× body scale unless noted)
// ---------------------------------------------------------------------------

/** Ring radius × body scale (the marked hold's footprint). */
const DEFAULT_HOLD_RADIUS = 0.45;
/** Ring colour-stroke width as a fraction of the ring radius. */
const CIRCLE_STROKE_FRAC = 0.07;
/** Cluster Holds whose centres fall within this × body scale into one spot — set to
 *  the ring radius, i.e. group only Holds whose rings would visibly overlap. */
const CLUSTER_RADIUS_FRAC = DEFAULT_HOLD_RADIUS;
/** Outer drop-shadow blur radius as a fraction of the ring radius. The shadow is
 *  clipped to the region outside the ring, so the blur falls outward only and the
 *  interior reads as highlighted. */
const SHADOW_BLUR_FRAC = 0.55;
/** Outer drop-shadow colour — a significant dark blur so the ring lifts off the wall. */
const SHADOW_COLOR = "rgba(0, 0, 0, 0.7)";

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
// radius and the foot ring nests just inside it — its outer stroke edge touching the
// hand ring's inner edge (`radius − stroke`) — so the two rings read as a pair while
// the clear interior stays as large as possible. A ring reveals at the earliest
// `firstUseTime` among its own kind's members.
// ---------------------------------------------------------------------------

interface Ring {
  /** Shared ring centre in photo px. */
  cx: number;
  cy: number;
  kind: "hand" | "foot";
  radius: number;
  /** Earliest `firstUseTime` among this ring's members — when it reveals. */
  earliestReveal: number;
  /** Index of the source cluster. Rings sharing a cluster are concentric (a
   *  hand/foot pair on one spot) and must not clip each other; only rings from
   *  *other* clusters occlude this one. */
  clusterId: number;
}

function buildRings(clusters: Hold[][], circleR: number, circleStroke: number): Ring[] {
  // Inner foot ring sits right inside the hand ring: its outer stroke edge touches the
  // hand ring's inner stroke edge, which (centreline to centreline) is one stroke width.
  const innerR = Math.max(circleStroke, circleR - circleStroke);
  const rings: Ring[] = [];
  clusters.forEach((members, clusterId) => {
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    const hasHand = members.some((m) => m.kind === "hand");
    const hasFoot = members.some((m) => m.kind === "foot");
    const both = hasHand && hasFoot;
    const earliest = (kind: "hand" | "foot") =>
      Math.min(...members.filter((m) => m.kind === kind).map((m) => m.firstUseTime));
    if (hasHand) {
      rings.push({
        cx,
        cy,
        kind: "hand",
        radius: circleR,
        earliestReveal: earliest("hand"),
        clusterId,
      });
    }
    if (hasFoot) {
      rings.push({
        cx,
        cy,
        kind: "foot",
        radius: both ? innerR : circleR,
        earliestReveal: earliest("foot"),
        clusterId,
      });
    }
  });
  return rings;
}

/** Stroke one colour-coded ring with an outer-only drop shadow, suppressing any
 *  arc (and its shadow) that falls inside a neighbouring cluster's disc.
 *
 *  When two rings from different clusters overlap, their outlines would cross and
 *  clutter the holds. To keep every hold framed by a clean, un-crossed outline, the
 *  arc of this ring that dips inside another cluster's disc is clipped away — the two
 *  rings then read as a single union outline with no overlapping lines. `occluders`
 *  are the *other* clusters' discs (the concentric same-cluster partner is excluded,
 *  so the nested foot ring is never carved out by its own hand ring).
 *
 *  Three layers of clip compose (each `clip` intersects): outside every occluder disc,
 *  then — for the shadow pass only — outside this ring's own disc so the blur falls
 *  outward. After the shadow, a clean flat colour stroke on top matches the Holds
 *  dropdown swatch exactly. The clear interior plus the surrounding shadow lifts the
 *  ring off the wall so its centre reads as highlighted. */
function drawRing(
  ctx: CanvasRenderingContext2D,
  ring: Ring,
  occluders: Ring[],
  color: string,
  stroke: number,
): void {
  const { cx, cy, radius: r } = ring;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.save();

  // Clip away each neighbouring cluster's disc so this ring's arc (and shadow) never
  // crosses into it. A separate clip per disc means the kept region is the area
  // *outside their union*; padding by half a stroke swallows the neighbour's line
  // width too, leaving no sliver behind.
  for (const o of occluders) {
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(o.cx, o.cy, o.radius + stroke / 2, 0, TAU);
    ctx.clip("evenodd");
  }

  // Shadow pass — clip to outside this ring, then stroke so only the outward blur shows.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip("evenodd");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke;
  ctx.shadowColor = SHADOW_COLOR;
  ctx.shadowBlur = r * SHADOW_BLUR_FRAC;
  ctx.stroke();
  ctx.restore();

  // Clean flat-colour stroke on top (shadow explicitly cleared), so the ring colour
  // reads true and never casts a second blur. Still inside the occluder clip.
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke;
  ctx.stroke();

  ctx.restore();
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
  const clusterDist = CLUSTER_RADIUS_FRAC * bodyScale;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const inBounds = (hold: Hold) => hold.x >= 0 && hold.x <= w && hold.y >= 0 && hold.y <= h;

  // Layout is solved against ALL in-bounds Holds so ring centres are fixed from the
  // start; only rings revealed by `t` are then drawn.
  const candidates = holds.filter(inBounds);
  if (candidates.length === 0) return;
  const rings = buildRings(clusterHolds(candidates, clusterDist), circleR, circleStroke);

  // Only rings revealed by `t` are drawn — and only those occlude each other, so a
  // not-yet-revealed neighbour never carves an unexplained gap into a visible ring.
  const visible = rings.filter((ring) => ring.earliestReveal <= t);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const ring of visible) {
    const occluders = visible.filter((o) => o.clusterId !== ring.clusterId);
    drawRing(ctx, ring, occluders, HOLD_RING_COLOR[ring.kind], circleStroke);
  }
  ctx.restore();
}
