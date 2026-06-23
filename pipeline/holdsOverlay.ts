/**
 * Holds overlay drawing for CanvasRenderingContext2D.
 *
 * Draws the **Holds** pass: a marker at each inferred Hold on the Route Photo /
 * Detection Preview. The marker is a hand / foot **glyph** of the actual limb
 * that used the hold — oriented left / right to match the side, given a crisp
 * full-opacity stroke in its per-side colour and a lighter translucent fill so
 * the wall hold reads through. The Hold's number is drawn **on the glyph
 * itself**, centred at the limb's contact point, in a colour + halo derived from
 * the glyph's luminance so the digit always contrasts against the glyph (dark
 * digit + light halo on light glyphs, light digit + dark halo on dark ones) and
 * against the rock showing through. No leader lines, no off-to-the-side label
 * chips, no greedy placement — the number is the Hold (ADR 0010).
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
 * is trivial (a glyph + a centred number each), so geometry is computed inline
 * without a cache.
 *
 * Framework-agnostic — no React imports. Keep it that way so a future baked-in
 * WebM path can reuse it.
 */

import type { Hold } from "@/pipeline/holdDetection";

// ---------------------------------------------------------------------------
// Per-side marker colours
//
// Hands light, feet dark, with left and right separated within each pair. Kept
// in sync with the `--color-*-hold-*` tokens in app/globals.css and reused by the
// scan Holds editor / style panel so the legend matches the overlay.
// ---------------------------------------------------------------------------

export const HOLD_COLORS = {
  hand: { left: "#FFFFFF", right: "#DDDDDD" },
  foot: { left: "#000000", right: "#333333" },
} as const;

/** Marker colour for a limb kind + side. */
export function holdColor(kind: "hand" | "foot", side: "left" | "right"): string {
  return HOLD_COLORS[kind][side];
}

// ---------------------------------------------------------------------------
// Other defaults (× body scale unless noted)
// ---------------------------------------------------------------------------

/** Glyph half-extent × body scale (the marked spot's footprint radius). */
const DEFAULT_HOLD_RADIUS = 0.35;
/**
 * Glyph fill opacity. Lighter than the old borderless glyph so the actual wall
 * hold reads through; the crisp full-opacity stroke carries the shape and colour.
 */
const DEFAULT_FILL_OPACITY = 0.35;
/** Glyph stroke width as a fraction of the glyph half-extent (device px). */
const STROKE_WIDTH_FRAC = 0.12;
/** Number font size × body scale. */
const LABEL_FONT_FRAC = 0.26;
/** Number halo (outline) width as a fraction of the font size. */
const HALO_WIDTH_FRAC = 0.16;
/** Co-located glyph fan-out spacing × glyph half-extent (shared-hold spread). */
const CLUSTER_SPACING_FRAC = 1.25;

// ---------------------------------------------------------------------------
// Number contrast
//
// The number colour + halo are derived from the glyph colour's luminance so the
// digit pops off the glyph whatever its colour (light glyphs → dark digit, dark
// glyphs → light digit) and the opposite-colour halo separates it from busy rock
// showing through the lightened fill (ADR 0010).
// ---------------------------------------------------------------------------

const DARK_DIGIT = "#0b0f14";
const LIGHT_DIGIT = "#ffffff";
const LIGHT_HALO = "rgba(255,255,255,0.9)";
const DARK_HALO = "rgba(0,0,0,0.85)";

/** Relative luminance (0–1) of a `#rgb` / `#rrggbb` colour; 1 for unparseable. */
function hexLuminance(hex: string): number {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length < 6) return 1;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Number fill + halo for a glyph of the given colour. */
function numberContrast(glyphColor: string): { digit: string; halo: string } {
  return hexLuminance(glyphColor) > 0.5
    ? { digit: DARK_DIGIT, halo: LIGHT_HALO }
    : { digit: LIGHT_DIGIT, halo: DARK_HALO };
}

// ---------------------------------------------------------------------------
// Glyph geometry — hand / foot SVG path data
//
// One path per kind, taken from the source SVGs (square viewBox). The left
// variant is the right path mirrored about the vertical centre line, so only the
// "right" path is stored. Path2D is constructed lazily and cached; it is absent
// in jsdom (no `canvas` package), so `glyphPath` returns null there and the glyph
// fill/stroke is skipped while the centred number still draws.
// ---------------------------------------------------------------------------

const HAND_PATH =
  "M496 136s-40.486 85.32-51.442 128.988c-14.33 57.118 2.078 100.297-18.747 155.68-35.998 64.97-38.435 75.466-169.81 75.33-48.132-.044-186.02-36.76-186.02-36.76C50.97 454.35 16 457.23 16 435.997c0-21.232 24.88-36.736 46.97-36.787l87.03 7.642c21.14-1.326 43.286-13.71 43.96-41.36-.353-40.927-4.4-72.357-25.175-105.6l-80.67-125.864c-4.818-10.02-5.964-27.105 7.983-34.732 13.947-7.628 29.793 3.71 35.205 13.582l90.11 122.57c9.618 8.955 26.738 10.68 25.278-8.38L206.903 44.652c-2.478-12.96 4.1-28.654 19.1-28.654 19.687 0 31.795 7.515 31.413 19.413l43.75 179.984c3.42 8.76 15.545 7.59 18.807-.49l12.462-175.022c.64-5.583 7.922-15.314 21.9-13.286 13.976 2.027 22.035 17 20.555 22.793l-4.044 172.936c2.838 15.327 14.888 17.565 24.266 9.008l61.22-109.487c3.72-9.183 18.288-11.096 26.715-7.455 7.84 5.107 12.954 11.96 12.954 21.603z";
const FOOT_PATH =
  "M499.462,299.855c-39.996-28.544-83.584-51.755-129.57-69.001c-4.378-1.63-9.259,0.555-10.957,4.907c-15.787,40.491-58.377,64.486-101.214,57.062c-10.999-1.911-21-4.429-30.362-7.322l72.636-70.485c5.077-4.924,7.859-11.793,7.637-18.859c-0.222-7.057-3.422-13.747-8.789-18.347l-27.981-23.987c-13.568-11.639-33.297-11.639-46.865,0l-80.888,69.333c-20.045-16.256-50.185-35.422-93.372-50.654c-11.324-4.011-24.055,0.563-29.585,10.615c-5.965,10.846-2.816,24.26,7.313,31.198c20.881,14.285,59.162,44.535,83.823,75.725H35.59c-18.987,0-34.594,14.191-35.541,32.316c-0.495,9.472,2.825,18.458,9.327,25.318c6.417,6.758,15.445,10.633,24.764,10.633h102.4c26.982,0,55.552,1.399,84.915,4.156c40.508,3.814,97.527,4.378,127.898,4.378c53.495,0,116.599-10.812,150.05-25.702c7.023-3.123,11.546-9.114,12.39-16.435C512.816,315.915,508.336,306.571,499.462,299.855z";

/** Source viewBox side length for each glyph (square). */
const HAND_VB = 512;
const FOOT_VB = 511.936;

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
 * Draw one hand / foot glyph centred at `(cx, cy)`, scaled so its viewBox spans
 * `size` px, mirrored horizontally for the left variant, tinted `color` at
 * `fillOpacity` with a crisp full-opacity stroke of the same colour.
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: "hand" | "foot",
  side: "left" | "right",
  cx: number,
  cy: number,
  size: number,
  color: string,
  fillOpacity: number,
  strokeWidth: number,
): void {
  const path = glyphPath(kind);
  if (!path) return;
  const vb = kind === "hand" ? HAND_VB : FOOT_VB;
  const s = size / vb;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(side === "left" ? -s : s, s);
  ctx.translate(-vb / 2, -vb / 2);
  // Translucent fill so the wall hold reads through.
  ctx.globalAlpha = fillOpacity;
  ctx.fillStyle = color;
  ctx.fill(path);
  // Crisp full-opacity stroke carries the shape + colour. lineWidth is in the
  // scaled path space, so divide the desired device width by the glyph scale.
  ctx.globalAlpha = 1;
  ctx.lineWidth = strokeWidth / s;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.stroke(path);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Geometry helper — shared-hold fan-out
// ---------------------------------------------------------------------------

/** A glyph to draw at a Hold (centre already adjusted for shared-hold fan-out). */
interface GlyphUnit {
  cx: number;
  cy: number;
  order: number;
  kind: "hand" | "foot";
  side: "left" | "right";
  color: string;
}

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

/** Style options for the Holds pass. All optional; unset fields use defaults. */
export interface HoldStyle {
  /** Draw the Holds pass. Default true (callers usually gate via the panel). */
  holdsVisible?: boolean;
  /** Glyph half-extent × body scale. Default {@link DEFAULT_HOLD_RADIUS}. */
  radius?: number;
  /** Glyph fill opacity in [0, 1]. Default {@link DEFAULT_FILL_OPACITY}. */
  fillOpacity?: number;
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
 * @param style     - Optional visibility / size overrides.
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

  const r = Math.max(3, (style?.radius ?? DEFAULT_HOLD_RADIUS) * bodyScale);
  const fillOpacity = style?.fillOpacity ?? DEFAULT_FILL_OPACITY;
  const strokeWidth = Math.max(1.5, r * STROKE_WIDTH_FRAC);
  const fontPx = Math.max(9, Math.round(bodyScale * LABEL_FONT_FRAC));
  const haloWidth = Math.max(2, fontPx * HALO_WIDTH_FRAC);

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const inBounds = (hold: Hold) => hold.x >= 0 && hold.x <= w && hold.y >= 0 && hold.y <= h;
  const revealed = (hold: Hold) => hold.firstUseTime <= t && inBounds(hold);

  const revealedHolds = [...holds].sort((a, b) => a.order - b.order).filter(revealed);
  if (revealedHolds.length === 0) return;

  const glyphs: GlyphUnit[] = spreadClusters(revealedHolds, r).map(({ hold, cx, cy }) => ({
    cx,
    cy,
    order: hold.order,
    kind: hold.kind,
    side: hold.side,
    color: holdColor(hold.kind, hold.side),
  }));

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fontPx}px sans-serif`;

  // ── Pass 1 — hand / foot glyphs (drawn first so numbers sit on top). ──
  for (const g of glyphs) {
    drawGlyph(ctx, g.kind, g.side, g.cx, g.cy, 2 * r, g.color, fillOpacity, strokeWidth);
  }

  // ── Pass 2 — the number, centred on each glyph, auto-contrasted with a halo. ──
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = haloWidth;
  for (const g of glyphs) {
    const { digit, halo } = numberContrast(g.color);
    const text = String(g.order);
    ctx.strokeStyle = halo;
    ctx.strokeText(text, g.cx, g.cy);
    ctx.fillStyle = digit;
    ctx.fillText(text, g.cx, g.cy);
  }

  ctx.restore();
}
