/**
 * Holds overlay drawing for CanvasRenderingContext2D.
 *
 * Draws the **Holds** pass: a marker at each inferred Hold on the Route Photo /
 * Detection Preview. The marker is an **outline-only** hand / foot **glyph** of the
 * limb that used the hold — a single-colour stroke with a **transparent fill**, so
 * the wall hold reads straight through. Every glyph uses the **same colour**; only
 * the **shape** (hand vs foot) and the **orientation** (mirrored for the left side)
 * differentiate them. The Hold's number rides in a small **corner badge** pinned to
 * the glyph (a dark disc with a white digit and a white ring), so the number stays
 * tightly coupled to its mark with no leader line.
 *
 * Left and right limbs are never merged in detection, so a hold used by both
 * hands (right then left) yields two Holds at the same spot; co-located glyphs
 * are fanned apart horizontally here so both marks read.
 *
 * The hand / foot shape comes from a single SVG path each (viewBox-square); the
 * left variant is just the right one mirrored horizontally.
 *
 * Markers reveal progressively: only Holds whose `firstUseTime ≤ t` are drawn, so
 * a marker pops in when the limb first lands and persists to the end.
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
// Glyph colour — the single source of truth for the Holds outline.
//
// Every Hold glyph is a transparent outline in this one colour; kind is shown by
// the hand / foot shape and side by the mirrored silhouette, never by colour.
// Mirror this value in `app/globals.css` (--color-hold-glyph) and `utils/theme.ts`.
// ---------------------------------------------------------------------------

/** Single outline colour shared by every Hold glyph. */
export const HOLD_GLYPH_COLOR = "#FFFFFF";

/** Number-badge palette — a neutral dark disc with a white digit and white ring,
 *  so the number is always the most legible element. */
export const HOLD_BADGE = {
  bg: "#0B0F14",
  text: "#FFFFFF",
  ring: "#FFFFFF",
} as const;

// ---------------------------------------------------------------------------
// Other defaults (× body scale unless noted)
// ---------------------------------------------------------------------------

/** Glyph half-extent × body scale (the marked spot's footprint radius). */
const DEFAULT_HOLD_RADIUS = 0.35;
/** Outline stroke width as a fraction of the glyph half-extent. */
const GLYPH_STROKE_FRAC = 0.12;
/** Number badge font size × body scale. */
const LABEL_FONT_FRAC = 0.26;
/** Badge centre offset toward the glyph's top-right corner × glyph half-extent. */
const BADGE_CORNER_FRAC = 0.72;
/** Co-located glyph fan-out spacing × glyph half-extent (shared-hold spread). */
const CLUSTER_SPACING_FRAC = 1.25;

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Glyph geometry — hand / foot SVG path data
//
// One path per kind, taken from the source SVGs (square viewBox). The left
// variant is the right path mirrored about the vertical centre line, so only the
// "right" path is stored. Path2D is constructed lazily and cached; it is absent
// in jsdom (no `canvas` package), so `glyphPath` returns null there and the glyph
// outline is skipped while the number badges still draw.
// ---------------------------------------------------------------------------

const HAND_PATH =
  "M496 136s-40.486 85.32-51.442 128.988c-14.33 57.118 2.078 100.297-18.747 155.68-35.998 64.97-38.435 75.466-169.81 75.33-48.132-.044-186.02-36.76-186.02-36.76C50.97 454.35 16 457.23 16 435.997c0-21.232 24.88-36.736 46.97-36.787l87.03 7.642c21.14-1.326 43.286-13.71 43.96-41.36-.353-40.927-4.4-72.357-25.175-105.6l-80.67-125.864c-4.818-10.02-5.964-27.105 7.983-34.732 13.947-7.628 29.793 3.71 35.205 13.582l90.11 122.57c9.618 8.955 26.738 10.68 25.278-8.38L206.903 44.652c-2.478-12.96 4.1-28.654 19.1-28.654 19.687 0 31.795 7.515 31.413 19.413l43.75 179.984c3.42 8.76 15.545 7.59 18.807-.49l12.462-175.022c.64-5.583 7.922-15.314 21.9-13.286 13.976 2.027 22.035 17 20.555 22.793l-4.044 172.936c2.838 15.327 14.888 17.565 24.266 9.008l61.22-109.487c3.72-9.183 18.288-11.096 26.715-7.455 7.84 5.107 12.954 11.96 12.954 21.603z";
const FOOT_PATH =
  "M499.462,299.855c-39.996-28.544-83.584-51.755-129.57-69.001c-4.378-1.63-9.259,0.555-10.957,4.907c-15.787,40.491-58.377,64.486-101.214,57.062c-10.999-1.911-21-4.429-30.362-7.322l72.636-70.485c5.077-4.924,7.859-11.793,7.637-18.859c-0.222-7.057-3.422-13.747-8.789-18.347l-27.981-23.987c-13.568-11.639-33.297-11.639-46.865,0l-80.888,69.333c-20.045-16.256-50.185-35.422-93.372-50.654c-11.324-4.011-24.055,0.563-29.585,10.615c-5.965,10.846-2.816,24.26,7.313,31.198c20.881,14.285,59.162,44.535,83.823,75.725H35.59c-18.987,0-34.594,14.191-35.541,32.316c-0.495,9.472,2.825,18.458,9.327,25.318c6.417,6.758,15.445,10.633,24.764,10.633h102.4c26.982,0,55.552,1.399,84.915,4.156c40.508,3.814,97.527,4.378,127.898,4.378c53.495,0,116.599-10.812,150.05-25.702c7.023-3.123,11.546-9.114,12.39-16.435C512.816,315.915,508.336,306.571,499.462,299.855z";

/** Source viewBox side length for each glyph (square). */
const HAND_VB = 512;
const FOOT_VB = 511.936;

/** Glyph outline path data — exported so the legend / editor can echo the marker
 *  as an outlined icon (rendered with `currentColor`, mirrored for the left side). */
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
 * Draw one outline-only hand / foot glyph centred at `(cx, cy)`, scaled so its
 * viewBox spans `size` px, mirrored horizontally for the left variant. The fill is
 * transparent — only the single-colour stroke is drawn, so the wall reads through.
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: "hand" | "foot",
  side: "left" | "right",
  cx: number,
  cy: number,
  size: number,
  color: string,
  strokePx: number,
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
  ctx.strokeStyle = color;
  // The stroke width is given in device px, so divide by the glyph scale `s` to set
  // it in the glyph's local space.
  ctx.lineWidth = strokePx / s;
  ctx.stroke(path);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Fan co-located Holds apart horizontally so left and right marks on a shared
 * hold both read. Holds whose centres fall within one glyph half-extent are one
 * cluster; a cluster of n is spread evenly about its centroid, left side first.
 */
function spreadClusters(
  holds: Hold[],
  r: number,
): { hold: Hold; cx: number; cy: number }[] {
  const clusters: Hold[][] = [];
  for (const hold of holds) {
    const cluster = clusters.find((c) =>
      c.some((o) => Math.hypot(o.x - hold.x, o.y - hold.y) <= r),
    );
    if (cluster) cluster.push(hold);
    else clusters.push([hold]);
  }

  const out: { hold: Hold; cx: number; cy: number }[] = [];
  const spacing = CLUSTER_SPACING_FRAC * r;
  for (const cluster of clusters) {
    if (cluster.length === 1) {
      out.push({ hold: cluster[0], cx: cluster[0].x, cy: cluster[0].y });
      continue;
    }
    const cx0 = cluster.reduce((s, h) => s + h.x, 0) / cluster.length;
    const cy0 = cluster.reduce((s, h) => s + h.y, 0) / cluster.length;
    // Left limbs to the left, right to the right; stable by first-use order.
    const ordered = [...cluster].sort((a, b) =>
      a.side === b.side ? a.order - b.order : a.side === "left" ? -1 : 1,
    );
    ordered.forEach((hold, i) => {
      const dx = (i - (ordered.length - 1) / 2) * spacing;
      out.push({ hold, cx: cx0 + dx, cy: cy0 });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Style options
// ---------------------------------------------------------------------------

/** Style options for the Holds pass. The glyph look is fixed (single-colour
 *  outline); only visibility is caller-controlled. */
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
 * @param t         - Current playback time (seconds). Holds first used after this
 *                    are not yet drawn (progressive, cumulative reveal).
 * @param style     - Optional visibility toggle.
 * @param bodyScale - Photo-space body scale (px) the glyph extent multiplies by.
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

  const r = Math.max(3, DEFAULT_HOLD_RADIUS * bodyScale);
  const glyphWidth = 2 * r;
  const strokePx = Math.max(1.5, r * GLYPH_STROKE_FRAC);
  const fontPx = Math.max(9, Math.round(bodyScale * LABEL_FONT_FRAC));

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const inBounds = (hold: Hold) => hold.x >= 0 && hold.x <= w && hold.y >= 0 && hold.y <= h;

  const candidates = holds.filter(inBounds);
  if (candidates.length === 0) return;
  const revealed = candidates.filter((hold) => hold.firstUseTime <= t);
  if (revealed.length === 0) return;

  const glyphs = spreadClusters(revealed, r).map(({ hold, cx, cy }) => ({
    cx,
    cy,
    order: hold.order,
    kind: hold.kind,
    side: hold.side,
  }));

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fontPx}px sans-serif`;

  // ── Pass 1 — transparent single-colour glyph outlines. ──
  for (const g of glyphs) {
    drawGlyph(ctx, g.kind, g.side, g.cx, g.cy, glyphWidth, HOLD_GLYPH_COLOR, strokePx);
  }

  // ── Pass 2 — corner number badges (on top of every glyph so a neighbouring
  //    glyph never covers a number). ──
  for (const g of glyphs) {
    const text = String(g.order);
    const tw = ctx.measureText(text).width;
    const br = Math.max(fontPx * 0.62, tw / 2 + fontPx * 0.3);
    const bx = g.cx + r * BADGE_CORNER_FRAC;
    const by = g.cy - r * BADGE_CORNER_FRAC;
    const ringPx = Math.max(1, br * 0.14);

    ctx.beginPath();
    ctx.arc(bx, by, br + ringPx, 0, TAU);
    ctx.fillStyle = HOLD_BADGE.ring;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(bx, by, br, 0, TAU);
    ctx.fillStyle = HOLD_BADGE.bg;
    ctx.fill();

    ctx.fillStyle = HOLD_BADGE.text;
    ctx.fillText(text, bx, by);
  }

  ctx.restore();
}
