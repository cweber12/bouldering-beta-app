/**
 * Holds overlay drawing for CanvasRenderingContext2D.
 *
 * Draws the **Holds** pass: a marker at each inferred Hold on the Route Photo. To
 * mark the spot the climber used *without covering it up*, the marker is a
 * translucent hand / foot **glyph** (the limb that used the hold) tinted soft
 * cyan (hand) / orange (foot) with a soft same-colour glow and **no border**. The
 * number is set off to the side as black-on-white, tethered to the glyph by a
 * leader line. Each Hold's number is pushed to the **outer** side of the route —
 * left of the holds' mean x goes further left, right of it goes further right —
 * so the digits sit away from the wall and the holds stay easy to see. Labels are
 * placed greedily in first-use order so they never overlap one another or a glyph.
 *
 * The hand / foot shape comes from a single SVG path each (viewBox-square); the
 * left variant is just the right one mirrored horizontally. Which side's glyph a
 * Hold gets follows the same mean-x split as its label, since the detected Hold
 * carries only its kind (hand / foot), not which hand or foot used it.
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

/** Hand Hold glyph colour — cyan (mirrors `--color-hand-hold`). */
const DEFAULT_HAND_COLOR = "#22d3ee";
/** Foot Hold glyph colour — orange (mirrors `--color-foot-hold`). */
const DEFAULT_FOOT_COLOR = "#fb923c";
/** Number label background — white. */
const DEFAULT_LABEL_COLOR = "#ffffff";
/** Number text — near-black for contrast on the white label. */
const DEFAULT_NUMBER_COLOR = "#0b0f14";
/** Glyph half-extent × body scale (the marked spot's footprint radius). */
const DEFAULT_HOLD_RADIUS = 0.35;
/**
 * Glyph fill opacity. Translucent so the actual wall hold reads through, but
 * solid enough that the silhouette is the clearly-visible marker now that there
 * is no border ring carrying the colour.
 */
const DEFAULT_FILL_OPACITY = 0.55;
/** Glow blur as a fraction of the glyph half-extent. */
const GLOW_BLUR_FRAC = 0.45;
/** Leader-line width as a fraction of the glyph half-extent. */
const LEADER_WIDTH_FRAC = 0.06;
/** Number label font size × body scale. */
const LABEL_FONT_FRAC = 0.26;

// ---------------------------------------------------------------------------
// Glyph geometry — hand / foot SVG path data
//
// One path per kind, taken from the source SVGs (square viewBox). The left
// variant is the right path mirrored about the vertical centre line, so only the
// "right" path is stored. Path2D is constructed lazily and cached; it is absent
// in jsdom (no `canvas` package), so `glyphPath` returns null there and the draw
// falls back to labels-only — exactly what the layout-caching tests rely on.
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
 * `opacity` with a soft same-colour glow and no border.
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: "hand" | "foot",
  side: "left" | "right",
  cx: number,
  cy: number,
  size: number,
  color: string,
  opacity: number,
  glowBlur: number,
): void {
  const path = glyphPath(kind);
  if (!path) return;
  const vb = kind === "hand" ? HAND_VB : FOOT_VB;
  const s = size / vb;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(side === "left" ? -s : s, s);
  ctx.translate(-vb / 2, -vb / 2);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  // shadowBlur is applied in output (device) space, unaffected by the CTM, so
  // pass the px blur directly rather than dividing by the glyph scale.
  ctx.shadowBlur = glowBlur;
  ctx.fill(path);
  ctx.restore();
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

/** Candidate label directions biased outward to the left / right of the route. */
const LEFT_ANGLES = [Math.PI, (-3 * Math.PI) / 4, (3 * Math.PI) / 4, -Math.PI / 2, Math.PI / 2];
const RIGHT_ANGLES = [0, -Math.PI / 4, Math.PI / 4, -Math.PI / 2, Math.PI / 2];

/** A glyph to draw at a Hold. */
interface GlyphUnit {
  cx: number;
  cy: number;
  kind: "hand" | "foot";
  side: "left" | "right";
  color: string;
}

/** A number label to place, tethered to its glyph by a leader. */
interface LabelUnit {
  order: number;
  color: string;
  /** Glyph centre — the leader starts at the glyph edge toward the label. */
  dcx: number;
  dcy: number;
  /** Side of the route's mean x this Hold sits on — labels push that way. */
  prefer: "left" | "right";
}

interface Placed {
  unit: LabelUnit;
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
// Style options
// ---------------------------------------------------------------------------

/** Style options for the Holds pass. All optional; unset fields use defaults. */
export interface HoldStyle {
  /** Draw the Holds pass. Default true (callers usually gate via the panel). */
  holdsVisible?: boolean;
  /** Hand Hold glyph colour. Default {@link DEFAULT_HAND_COLOR}. */
  handColor?: string;
  /** Foot Hold glyph colour. Default {@link DEFAULT_FOOT_COLOR}. */
  footColor?: string;
  /** Number label background colour. Default {@link DEFAULT_LABEL_COLOR}. */
  labelColor?: string;
  /** Number text colour. Default {@link DEFAULT_NUMBER_COLOR}. */
  numberColor?: string;
  /** Glyph half-extent × body scale. Default {@link DEFAULT_HOLD_RADIUS}. */
  radius?: number;
  /** Glyph fill opacity in [0, 1]. Default {@link DEFAULT_FILL_OPACITY}. */
  fillOpacity?: number;
}

// ---------------------------------------------------------------------------
// Cached render plan
//
// The greedy label layout is the per-frame cost the static-Holds change removes
// (ADR 0009). The plan — glyph geometry + placed label rects — depends only on
// the Holds, the canvas size, the style sizes, and *which* Holds are revealed.
// With high-water reveal the revealed set only grows, so the plan is recomputed
// at most once per reveal and reused on every frame in between, keyed per canvas.
// ---------------------------------------------------------------------------

/** The time-independent geometry rendered each frame for a given revealed set. */
interface RenderPlan {
  glyphs: GlyphUnit[];
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
  handColor: string;
  footColor: string;
  w: number;
  h: number;
}

/**
 * Build the glyph + label geometry for the currently-revealed Holds. Pure
 * geometry — no drawing — so the result can be cached and replayed each frame.
 */
function buildHoldsPlan(
  ctx: CanvasRenderingContext2D,
  holds: Hold[],
  revealed: (hold: Hold) => boolean,
  sizes: PlanSizes,
): RenderPlan {
  const { r, fontPx, handColor, footColor, w, h } = sizes;

  // Mean x over *all* Holds (not just the revealed ones) so a Hold's side — and
  // therefore its glyph orientation and label direction — stays fixed as the
  // sequence reveals rather than jumping when a new Hold appears.
  const meanX = holds.reduce((sum, hold) => sum + hold.x, 0) / holds.length;

  const glyphs: GlyphUnit[] = [];
  const labels: LabelUnit[] = [];
  for (const hold of [...holds].sort((a, b) => a.order - b.order)) {
    if (!revealed(hold)) continue;
    const color = hold.kind === "hand" ? handColor : footColor;
    const side: "left" | "right" = hold.x < meanX ? "left" : "right";
    glyphs.push({ cx: hold.x, cy: hold.y, kind: hold.kind, side, color });
    labels.push({ order: hold.order, color, dcx: hold.x, dcy: hold.y, prefer: side });
  }
  if (glyphs.length === 0) return { glyphs, placed: [] };

  // Font must be set before measureText so label widths are correct.
  ctx.font = `bold ${fontPx}px sans-serif`;

  // ── Label placement — greedy, in first-use order, pushed to the route's outer
  //    side so digits sit away from the holds; earlier labels keep a stable spot
  //    and never overlap a later one or a glyph. ──
  const padX = fontPx * 0.55;
  const padY = fontPx * 0.34;
  const placed: Placed[] = [];
  for (const unit of [...labels].sort((a, b) => a.order - b.order)) {
    const text = String(unit.order);
    const tw = ctx.measureText(text).width;
    const lw = Math.max(tw + 2 * padX, fontPx + 2 * padY);
    const lh = fontPx + 2 * padY;
    const angles = unit.prefer === "left" ? LEFT_ANGLES : RIGHT_ANGLES;

    let best: Rect | null = null;
    let bestC = { x: 0, y: 0 };
    // Expanding rings of candidate offsets, started well clear of the glyph so the
    // number reads at a distance from the hold.
    outer: for (let ring = 0; ring < 6; ring++) {
      const off = r + (1.2 + ring * 0.9) * Math.max(lw, lh);
      for (const angle of angles) {
        const cx = unit.dcx + Math.cos(angle) * off;
        const cy = unit.dcy + Math.sin(angle) * off;
        const rect: Rect = { x: cx - lw / 2, y: cy - lh / 2, w: lw, h: lh };
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > w || rect.y + rect.h > h) continue;
        const hitsLabel = placed.some((p) => rectsOverlap(rect, p.rect));
        const hitsGlyph = glyphs.some((g) => rectCircleOverlap(rect, g.cx, g.cy, r));
        if (!hitsLabel && !hitsGlyph) {
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
      const dir = unit.prefer === "left" ? -1 : 1;
      const cx = unit.dcx + dir * (r + lw);
      best = { x: cx - lw / 2, y: unit.dcy - lh / 2, w: lw, h: lh };
      bestC = { x: cx, y: unit.dcy };
    }
    placed.push({ unit, rect: best, cx: bestC.x, cy: bestC.y });
  }

  return { glyphs, placed };
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

  const handColor = style?.handColor ?? DEFAULT_HAND_COLOR;
  const footColor = style?.footColor ?? DEFAULT_FOOT_COLOR;
  const labelColor = style?.labelColor ?? DEFAULT_LABEL_COLOR;
  const numberColor = style?.numberColor ?? DEFAULT_NUMBER_COLOR;
  const r = Math.max(3, (style?.radius ?? DEFAULT_HOLD_RADIUS) * bodyScale);
  const leaderWidth = Math.max(1, r * LEADER_WIDTH_FRAC);
  const glowBlur = r * GLOW_BLUR_FRAC;
  const fillOpacity = style?.fillOpacity ?? DEFAULT_FILL_OPACITY;
  const fontPx = Math.max(9, Math.round(bodyScale * LABEL_FONT_FRAC));

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const inBounds = (hold: Hold) => hold.x >= 0 && hold.x <= w && hold.y >= 0 && hold.y <= h;
  const revealed = (hold: Hold) => hold.firstUseTime <= t && inBounds(hold);

  // Build (or reuse) the render plan. The greedy label layout depends only on the
  // Holds, the canvas, the style sizes, and which Holds are revealed; with
  // high-water reveal that revealed set only grows, so the plan is recomputed at
  // most once per reveal and reused on every frame in between (ADR 0009).
  const revealedSig = holds.filter(revealed).map((hold) => hold.id).join(",");
  const sig = `${w}x${h}|${r}|${fontPx}|${handColor}|${footColor}|${revealedSig}`;
  const cached = planCache.get(ctx.canvas);
  let plan: RenderPlan;
  if (cached && cached.holds === holds && cached.sig === sig) {
    plan = cached.plan;
  } else {
    plan = buildHoldsPlan(ctx, holds, revealed, { r, fontPx, handColor, footColor, w, h });
    planCache.set(ctx.canvas, { holds, sig, plan });
  }
  const { glyphs, placed } = plan;
  if (glyphs.length === 0) return;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fontPx}px sans-serif`;

  // ── Pass 1 — hand / foot glyphs (drawn first so labels/leaders sit on top). ──
  for (const g of glyphs) {
    drawGlyph(ctx, g.kind, g.side, g.cx, g.cy, 2 * r, g.color, fillOpacity, glowBlur);
  }
  ctx.shadowBlur = 0;

  // ── Pass 2 — leader lines + black-on-white number labels. ──
  for (const p of placed) {
    const { unit } = p;
    // Leader from the glyph edge (centre offset by r toward the label) to the
    // label centre.
    const dx = p.cx - unit.dcx;
    const dy = p.cy - unit.dcy;
    const len = Math.hypot(dx, dy) || 1;
    const sx = unit.dcx + (dx / len) * r;
    const sy = unit.dcy + (dy / len) * r;
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
