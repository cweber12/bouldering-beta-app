/**
 * Holds overlay drawing for CanvasRenderingContext2D.
 *
 * Draws the **Holds** pass: a marker at each inferred Hold on the Route Photo /
 * Detection Preview. The unit on the wall is a **single transparent bordered
 * ring** placed at the hold's *exact* photo-space location — rings never move to
 * make room, so the circle always frames the wall hold it names, and its interior
 * stays clear so the rock reads through.
 *
 * **Coincident Holds share one ring (clustering).** Left and right limbs are never
 * merged in detection, so a hold used by both hands — or by a hand and a foot —
 * yields several Holds at the same spot. At draw time those Holds are clustered by
 * proximity (centres within ~one ring radius) and drawn as a **single ring**
 * carrying **several numbered glyph badges**, rather than a pile of overlapping
 * circles.
 *
 * Each badge is a **solid white hand / foot silhouette** (mirrored for the left
 * side) sitting **flush just outside the ring**, pointing inward, with the Hold's
 * number rendered as a **dark digit centred on the palm / ball of the glyph** — no
 * separate disc. The digit auto-fits the glyph's solid region so a two-digit
 * number stays contained even on the smaller foot. Left-limb badges live on the
 * ring's left arc, right-limb on the right arc; several on one side fan along that
 * arc. The white ring and white glyph each carry a thin dark outline so they read
 * on light or dark rock alike.
 *
 * The layout is solved against **all in-bounds Holds** up front — cluster centres
 * and every badge slot are fixed from the start — so nothing jumps when a later
 * Hold reveals. Where two *separate* rings sit close, a colliding badge is nudged a
 * little along its own arc (capped, never flung radially outward); a small overlap
 * is tolerated over a far-flung badge.
 *
 * Markers reveal progressively: a ring appears when its earliest member's
 * `firstUseTime ≤ t`, and each badge pops in when its own limb first lands, so the
 * numbers tell the sequence as playback advances.
 *
 * The hand / foot shape comes from a single SVG path each (square viewBox); the
 * left variant is just the right one mirrored horizontally.
 *
 * Sizes are multipliers of the photo-space `bodyScale`, mirroring the Skeleton
 * overlay, so markers look identical at any photo resolution. The per-frame cost
 * is trivial, so geometry is computed inline without a cache.
 *
 * Framework-agnostic — no React imports. Keep it that way so a future baked-in
 * WebM path can reuse it.
 */

import type { Hold } from "@/pipeline/holdDetection";

// ---------------------------------------------------------------------------
// Marker colours — the single source of truth for the Holds look.
//
// The ring border and the solid glyph badge are both white; kind is shown by the
// hand / foot shape and side by the mirrored silhouette, never by colour. Mirror
// `HOLD_GLYPH_COLOR` in `app/globals.css` (--color-hold-glyph) and `utils/theme.ts`.
// The dark outline + dark digit are overlay-only (drawn over the photo, not theme
// chrome), so they live here alone.
// ---------------------------------------------------------------------------

/** Single colour shared by the ring border and every Hold glyph badge. */
export const HOLD_GLYPH_COLOR = "#FFFFFF";

/** Thin dark halo stroked around the white ring and white glyph so the marks read
 *  on light or dark rock; also the colour of the on-glyph number digit. */
export const HOLD_GLYPH_OUTLINE = "rgba(11, 15, 20, 0.85)";

/** Number-badge palette — kept for the scan-stage Holds editor list chip, which
 *  shows the order on a dark pill. The overlay itself draws the digit directly on
 *  the white glyph (see {@link HOLD_GLYPH_OUTLINE}), with no disc. */
export const HOLD_BADGE = {
  bg: "#0B0F14",
  text: "#FFFFFF",
  ring: "#FFFFFF",
} as const;

/** Dark digit colour for the on-glyph number — high contrast on the white glyph. */
const HOLD_NUMBER_COLOR = HOLD_BADGE.bg;

// ---------------------------------------------------------------------------
// Sizing & layout defaults (× body scale unless noted)
// ---------------------------------------------------------------------------

/** Ring radius × body scale (the marked hold's footprint). */
const DEFAULT_HOLD_RADIUS = 0.45;
/** Ring border stroke width as a fraction of the ring radius. */
const CIRCLE_STROKE_FRAC = 0.09;
/** Dark halo width around the white ring as a fraction of its stroke. */
const RING_HALO_FRAC = 0.6;
/** Cluster Holds whose centres fall within this × body scale into one ring — set
 *  to the ring radius, i.e. group only Holds whose rings visibly overlap. */
const CLUSTER_RADIUS_FRAC = DEFAULT_HOLD_RADIUS;
/** Glyph viewBox span as a multiple of the ring radius — tied to the ring so the
 *  two always look balanced; ~ring-radius keeps the glyph about half its old size. */
const GLYPH_SPAN_TO_RING = 1.1;
/** Glyph centre sits this × its span beyond the ring edge, so its solid mass rests
 *  flush just outside the stroke while the ring interior stays clear. */
const BADGE_DIST_FRAC = 0.42;
/** Badge collision radius as a fraction of the glyph span (a glyph is treated as a
 *  disc of this radius for fan spacing and inter-ring deconfliction). */
const BADGE_COLLISION_FRAC = 0.5;
/** Glyph outline width as a fraction of the glyph span. */
const GLYPH_OUTLINE_FRAC = 0.05;
/** Base on-glyph digit font as a fraction of the glyph span (before auto-fit). */
const NUMBER_BASE_FRAC = 0.42;
/** On-glyph digit font floor as a fraction of body scale, so it never goes sub-legible. */
const NUMBER_FLOOR_FRAC = 0.12;
/** Width of the solid region under the digit, per kind, as a fraction of the glyph
 *  span. The foot's "ball" is a smaller solid patch than the hand's palm, so a
 *  two-digit number is auto-shrunk harder there to stay contained. */
const SOLID_WIDTH_FRAC: Record<"hand" | "foot", number> = { hand: 0.5, foot: 0.42 };
/** Hard cap on how far (radians) a badge may be nudged along its arc to clear a
 *  neighbouring ring's badge — keeps it on the hold's own side, never flung away. */
const MAX_NUDGE = Math.PI / 2;

/**
 * Visual centroid of each glyph as a fraction of its square viewBox — where the
 * silhouette is solid enough to back the number. Eyeballed from the paths; the x is
 * mirrored with the glyph for the left side.
 */
const GLYPH_CENTROID: Record<"hand" | "foot", { x: number; y: number }> = {
  hand: { x: 0.5, y: 0.6 },
  foot: { x: 0.46, y: 0.56 },
};

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Glyph geometry — hand / foot SVG path data
//
// One path per kind, taken from the source SVGs (square viewBox). The left
// variant is the right path mirrored about the vertical centre line, so only the
// "right" path is stored. Path2D is constructed lazily and cached; it is absent
// in jsdom (no `canvas` package), so `glyphPath` returns null there and the glyph
// is skipped while the rings and number digits still draw.
// ---------------------------------------------------------------------------

const HAND_PATH =
  "M496 136s-40.486 85.32-51.442 128.988c-14.33 57.118 2.078 100.297-18.747 155.68-35.998 64.97-38.435 75.466-169.81 75.33-48.132-.044-186.02-36.76-186.02-36.76C50.97 454.35 16 457.23 16 435.997c0-21.232 24.88-36.736 46.97-36.787l87.03 7.642c21.14-1.326 43.286-13.71 43.96-41.36-.353-40.927-4.4-72.357-25.175-105.6l-80.67-125.864c-4.818-10.02-5.964-27.105 7.983-34.732 13.947-7.628 29.793 3.71 35.205 13.582l90.11 122.57c9.618 8.955 26.738 10.68 25.278-8.38L206.903 44.652c-2.478-12.96 4.1-28.654 19.1-28.654 19.687 0 31.795 7.515 31.413 19.413l43.75 179.984c3.42 8.76 15.545 7.59 18.807-.49l12.462-175.022c.64-5.583 7.922-15.314 21.9-13.286 13.976 2.027 22.035 17 20.555 22.793l-4.044 172.936c2.838 15.327 14.888 17.565 24.266 9.008l61.22-109.487c3.72-9.183 18.288-11.096 26.715-7.455 7.84 5.107 12.954 11.96 12.954 21.603z";
// Provided foot silhouette (SVG Repo). Both supplied files share this path; the
// left file is only this path mirrored, so we store the right foot and mirror it.
const FOOT_PATH =
  "M23.625,18.764c-0.177,0.277-0.384,0.531-0.604,0.762c-2.053,3.024-8.75,8.344-9.885,10.131c-1.479,2.332-4.521,3.074-6.76,1.653c-2.239-1.419-2.911-4.461-1.432-6.792c1.937-3.06,7.063-3.254,8.063-5.459c0-0.002,0-0.004,0-0.005c0-0.203,0.126-0.42,0.007-0.592c-1.814-2.641-1.721-6.973-0.319-9.183c1.72-2.713,4.932-1.208,8.178,0.851C24.115,12.186,25.346,16.051,23.625,18.764z M16.045,6.201c1.422,0.902,3.396,0.343,4.404-1.251c1.011-1.594,0.677-3.617-0.746-4.521c-1.424-0.899-3.394-0.339-4.405,1.255C14.288,3.277,14.621,5.301,16.045,6.201z M20.637,5.579c-0.519,0.818-0.377,1.836,0.312,2.274c0.689,0.438,1.671,0.13,2.189-0.688c0.519-0.817,0.377-1.835-0.312-2.273C22.137,4.454,21.156,4.761,20.637,5.579z M23.149,8.06c-0.444,0.701-0.312,1.581,0.294,1.966c0.606,0.384,1.458,0.127,1.901-0.574c0.444-0.701,0.313-1.581-0.293-1.965C24.446,7.102,23.592,7.359,23.149,8.06z M26.838,12.158c0.465-0.735,0.393-1.616-0.164-1.968c-0.558-0.353-1.386-0.042-1.851,0.692s-0.394,1.616,0.164,1.969C25.545,13.203,26.374,12.893,26.838,12.158z M27.528,13.204c-0.412-0.261-1.025-0.032-1.371,0.513s-0.293,1.198,0.119,1.459c0.412,0.261,1.025,0.031,1.371-0.514C27.992,14.118,27.94,13.465,27.528,13.204z";

/** Source viewBox side length for each glyph (square). */
const HAND_VB = 512;
const FOOT_VB = 32.031;

/** Glyph path data — exported so the legend / editor can echo the badge as a
 *  filled icon (rendered with `currentColor`, mirrored for the left side). */
export const HOLD_GLYPH_PATH: Record<"hand" | "foot", string> = {
  hand: HAND_PATH,
  foot: FOOT_PATH,
};
/** Square viewBox side length per kind, paired with {@link HOLD_GLYPH_PATH}. */
export const HOLD_GLYPH_VIEWBOX: Record<"hand" | "foot", number> = {
  hand: HAND_VB,
  foot: FOOT_VB,
};

const path2dCache = new Map<"hand" | "foot", Path2D>();

/** Lazily-built Path2D for a kind, or null where Path2D is unavailable (jsdom). */
function glyphPath(kind: "hand" | "foot"): Path2D | null {
  if (typeof Path2D === "undefined") return null;
  let p = path2dCache.get(kind);
  if (!p) {
    p = new Path2D(kind === "hand" ? HAND_PATH : FOOT_PATH);
    path2dCache.set(kind, p);
  }
  return p;
}

/**
 * Draw one solid-fill hand / foot glyph centred at `(cx, cy)`, scaled so its
 * viewBox spans `size` px, mirrored horizontally for the left variant, with a thin
 * dark outline for contrast on any rock.
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: "hand" | "foot",
  side: "left" | "right",
  cx: number,
  cy: number,
  size: number,
  fill: string,
  outline: string,
  outlinePx: number,
): void {
  const path = glyphPath(kind);
  if (!path) return;
  const vb = kind === "hand" ? HAND_VB : FOOT_VB;
  const s = size / vb;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(side === "left" ? -s : s, s);
  ctx.translate(-vb / 2, -vb / 2);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Stroke first so the outline sits half outside the silhouette, then fill white
  // over its inner half — a clean dark rim around a solid white shape.
  ctx.lineWidth = outlinePx / s;
  ctx.strokeStyle = outline;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Clustering — coincident Holds share one ring
//
// Single-link union by centre distance: any two Holds within `clusterDist` join
// the same cluster, so a chalky hold used by both hands (two coincident Holds)
// reads as one ring with two badges rather than two stacked circles.
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
// Badge layout — side-anchored arcs + capped inter-ring nudge
//
// Each cluster's badges hang off one ring: left-limb badges on the left arc (rest
// at 9 o'clock), right-limb on the right arc (3 o'clock); several on a side fan
// symmetrically along that arc. Badge slots are fixed from all in-bounds Holds up
// front. A badge that would overlap an already-placed badge from another ring is
// nudged a little further along its own arc (capped at ±MAX_NUDGE), never stepped
// radially outward — a small overlap is tolerated over a far-flung badge.
// ---------------------------------------------------------------------------

interface BadgePlacement {
  hold: Hold;
  /** Badge centre (the glyph centre) in photo px. */
  bx: number;
  by: number;
}

interface ClusterLayout {
  /** Shared ring centre in photo px. */
  cx: number;
  cy: number;
  /** Earliest member `firstUseTime` — when the ring first reveals. */
  earliestReveal: number;
  badges: BadgePlacement[];
}

function layoutClusters(clusters: Hold[][], badgeDist: number, br: number): ClusterLayout[] {
  const step = Math.min(MAX_NUDGE, (2 * br) / badgeDist);

  const meta = clusters.map((members) => {
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    const earliestReveal = Math.min(...members.map((m) => m.firstUseTime));
    return { members, cx, cy, earliestReveal };
  });

  // Base slot per badge: side anchor + symmetric fan along its arc.
  interface Base {
    hold: Hold;
    cx: number;
    cy: number;
    theta: number;
  }
  const bases: Base[] = [];
  for (const { members, cx, cy } of meta) {
    for (const side of ["left", "right"] as const) {
      const group = members.filter((m) => m.side === side).sort((a, b) => a.order - b.order);
      if (group.length === 0) continue;
      const anchor = side === "left" ? Math.PI : 0;
      group.forEach((hold, i) => {
        const off = (i - (group.length - 1) / 2) * step;
        bases.push({ hold, cx, cy, theta: anchor + off });
      });
    }
  }

  // Resolve inter-ring collisions in Hold order, so lower numbers keep their slot.
  bases.sort((a, b) => a.hold.order - b.hold.order);
  const placed: { x: number; y: number }[] = [];
  const finalPos = new Map<string, { x: number; y: number }>();
  const minGap = 2 * br * 0.9; // a hair of overlap tolerance avoids jitter
  const capSteps = Math.max(1, Math.floor(MAX_NUDGE / step));
  const offsets = [0];
  for (let k = 1; k <= capSteps; k++) offsets.push(k * step, -k * step);

  for (const b of bases) {
    let chosen: { x: number; y: number } | null = null;
    for (const d of offsets) {
      const th = b.theta + d;
      const x = b.cx + badgeDist * Math.cos(th);
      const y = b.cy + badgeDist * Math.sin(th);
      if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= minGap)) {
        chosen = { x, y };
        break;
      }
    }
    if (!chosen) {
      chosen = {
        x: b.cx + badgeDist * Math.cos(b.theta),
        y: b.cy + badgeDist * Math.sin(b.theta),
      };
    }
    placed.push(chosen);
    finalPos.set(b.hold.id, chosen);
  }

  return meta.map(({ members, cx, cy, earliestReveal }) => ({
    cx,
    cy,
    earliestReveal,
    badges: members.map((hold) => {
      const p = finalPos.get(hold.id)!;
      return { hold, bx: p.x, by: p.y };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Style options
// ---------------------------------------------------------------------------

/** Style options for the Holds pass. The marker look is fixed (single-colour
 *  ring + glyph badge); only visibility is caller-controlled. */
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
 * @param holds     - Detected Holds, each with a photo-space `{x, y}`, `order`,
 *                    and `firstUseTime` in the same clock as `t`.
 * @param t         - Current playback time (seconds). A ring reveals when its
 *                    earliest member's `firstUseTime ≤ t`; each badge reveals at
 *                    its own `firstUseTime` (progressive, cumulative).
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
  const circleStroke = Math.max(1.5, circleR * CIRCLE_STROKE_FRAC);
  const haloPx = Math.max(1, circleStroke * RING_HALO_FRAC);
  const glyphSpan = circleR * GLYPH_SPAN_TO_RING;
  const badgeDist = circleR + glyphSpan * BADGE_DIST_FRAC;
  const br = glyphSpan * BADGE_COLLISION_FRAC;
  const clusterDist = CLUSTER_RADIUS_FRAC * bodyScale;
  const glyphOutlinePx = Math.max(1, glyphSpan * GLYPH_OUTLINE_FRAC);
  const numberBase = glyphSpan * NUMBER_BASE_FRAC;
  const numberFloor = Math.max(8, bodyScale * NUMBER_FLOOR_FRAC);

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const inBounds = (hold: Hold) => hold.x >= 0 && hold.x <= w && hold.y >= 0 && hold.y <= h;

  // Layout is solved against ALL in-bounds Holds so ring centres and badge slots
  // are fixed from the start; only members revealed by `t` are then drawn.
  const candidates = holds.filter(inBounds);
  if (candidates.length === 0) return;
  const clusters = clusterHolds(candidates, clusterDist);
  const layouts = layoutClusters(clusters, badgeDist, br);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // ── Pass 1 — one transparent bordered ring per cluster (dark halo, then white). ──
  for (const cl of layouts) {
    if (cl.earliestReveal > t) continue;
    ctx.beginPath();
    ctx.arc(cl.cx, cl.cy, circleR, 0, TAU);
    ctx.strokeStyle = HOLD_GLYPH_OUTLINE;
    ctx.lineWidth = circleStroke + 2 * haloPx;
    ctx.stroke();
    ctx.strokeStyle = HOLD_GLYPH_COLOR;
    ctx.lineWidth = circleStroke;
    ctx.stroke();
  }

  // ── Pass 2 — solid glyph badges with the on-glyph number (after every ring so a
  //    neighbour's badge never sits under a later ring). ──
  for (const cl of layouts) {
    for (const { hold, bx, by } of cl.badges) {
      if (hold.firstUseTime > t) continue;
      drawGlyph(ctx, hold.kind, hold.side, bx, by, glyphSpan, HOLD_GLYPH_COLOR, HOLD_GLYPH_OUTLINE, glyphOutlinePx);

      // Number digit centred on the glyph's solid palm / ball (x mirrored with the
      // glyph), auto-fit so it stays contained — harder on the smaller foot ball.
      const c = GLYPH_CENTROID[hold.kind];
      const ox = (c.x - 0.5) * glyphSpan * (hold.side === "left" ? -1 : 1);
      const oy = (c.y - 0.5) * glyphSpan;
      const dcx = bx + ox;
      const dcy = by + oy;

      const text = String(hold.order);
      const maxW = glyphSpan * SOLID_WIDTH_FRAC[hold.kind];
      let fontPx = numberBase;
      ctx.font = `bold ${fontPx}px sans-serif`;
      const tw = ctx.measureText(text).width;
      if (tw > maxW) fontPx = Math.max(numberFloor, fontPx * (maxW / tw));
      ctx.font = `bold ${fontPx}px sans-serif`;
      ctx.fillStyle = HOLD_NUMBER_COLOR;
      ctx.fillText(text, dcx, dcy);
    }
  }

  ctx.restore();
}
