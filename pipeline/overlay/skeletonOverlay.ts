/**
 * Skeleton overlay drawing for CanvasRenderingContext2D.
 *
 * Converts normalized PoseFrame keypoints to image-space pixel coordinates
 * via a homography matrix, then draws the overlay onto the canvas as two
 * passes:
 *
 *  - **Silhouette** — the skeleton drawn fat: every bone (arms, legs, hands,
 *    feet) stroked as a round-capped capsule, plus two filled regions for the
 *    parts that are areas not bones (the torso quad and a faint, detached head
 *    oval — there is no neck capsule), all unioned into one body shape. Hand and
 *    foot edges are stroked at 0.75× the
 *    limb width (anatomical proportion). It is shaded for depth — a dark inner
 *    rim along the union boundary fading to lighter limb cores, with radial fills
 *    for the torso and head on top — all derived from the single silhouette
 *    colour. It is rendered opaque onto a reused offscreen scratch canvas and
 *    composited once at the configured opacity, so overlapping pieces never
 *    darken into seams. Always solid — confidence dimming never applies here.
 *  - **Skeleton** — the thin pose lines + joint points, drawn crisply on top of
 *    (inside) the Silhouette. Estimated-Landmark confidence dimming applies to
 *    this pass only.
 *
 * All sizes are multipliers of a per-frame **body scale** (shoulder width, with
 * fallbacks) so the overlay looks identical at any photo resolution / zoom.
 *
 * Uses MediaPipe Pose Landmarker (33 keypoints, BlazePose topology).
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import { MP_SKELETON_EDGES, MP_KP_NAMES } from "@/utils/poseConstants";
import { applyHomographyMatrix } from "@/pipeline/matching/homography";

// ---------------------------------------------------------------------------
// Defaults (all thickness/size values are × body scale unless noted)
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = "#D6FB61";
/** Kept for single-colour mode and panel defaults; anatomical mode computes per-limb colours. */
const DEFAULT_SKELETON_COLOR = "#D6FB61";
/** Kept for single-colour mode and panel defaults; anatomical mode computes per-joint colours. */
const DEFAULT_JOINT_COLOR = "#D6FB61";
const DEFAULT_SILHOUETTE_OPACITY = 0.25;
/** Hue shifts (fraction of the wheel) used in single-colour mode to tint left vs right. */
const SIDE_HUE_SHIFT_LEFT = 0.04;
const SIDE_HUE_SHIFT_RIGHT = 0.09;
const ARM_HAND_COLOR = "#39B1D1";
const LEG_FOOT_COLOR = "#F6850C";
const ANATOMICAL_LEFT_HUE_SHIFT = -0.015;
const ANATOMICAL_RIGHT_HUE_SHIFT = 0.015;
/** Opacity multiplier for the silhouette head. The head now floats free (the
 *  neck capsule was removed), so keep it faint to make the detachment subtle. */
const HEAD_SILHOUETTE_OPACITY = 0.55;
/** Base limb (arm / leg / torso-stroke) capsule **radius** as a fraction of
 *  shoulder width. One width for every bone so joints line up with no step. */
const DEFAULT_LIMB_THICKNESS = 0.18;
/** Skeleton line **radius** as a fraction of shoulder width. */
const DEFAULT_LINE_THICKNESS = 0.015;
/** Joint circle **radius** as a fraction of shoulder width (midpoint of the two). */
const DEFAULT_JOINT_RADIUS = 0.09;

/** Hand / foot capsule radius as a fraction of the base limb radius. Three
 *  quarters of the limb width (they read too small thinner); the strokes still
 *  union the real landmark edges into a solid hand fan / foot. */
const EXTREMITY_WIDTH_FACTOR = 0.75;

/** Max head-centre distance from the shoulder-midpoint, × body scale. Past this
 *  the head is pulled in along the neck axis so it cannot drift too far on big
 *  head tilts (the neck capsule that used to bridge it is gone). */
const NECK_MAX_DIST = 0.85;

/** Head oval half-width as a fraction of body scale (shoulder width). Fixed —
 *  never the ear/eye span, which balloons in profile and collapses head-on. */
const HEAD_HALF_WIDTH = 0.35;
/** Head oval height-to-width ratio (the head is taller than it is wide). */
const HEAD_HEIGHT_RATIO = 1.2;

// ── Depth shading (ADR-0005 update) — all derived from `silhouetteColor` ──
// The Silhouette is shaded for depth: a dark inner rim along the union boundary
// fading to a lighter core (limb cylinders), plus radial fills for the torso and
// head on top. Shades are HSL lightness shifts of the single picked colour; the
// strength constants are deliberately subtle so the effect reads as depth, not
// noise. See docs/adr/0005-silhouette-overlay-rendering.md.
/** Lightness delta for the dark rim / boundary (edges of every part). */
const RIM_DARK_SHIFT = -0.18;
/** Lightness delta for the light limb core (the lit centre of a cylinder). */
const RIM_LIGHT_SHIFT = 0.12;
/** Torso interior shade just inside the dark perimeter — lighter than the rim
 *  dark, but not as light as a limb core. */
const TORSO_EDGE_SHIFT = -0.02;
/** Torso central highlight (the narrow sternum oval). */
const TORSO_CORE_SHIFT = 0.08;
/** Head radial: dark edge and light centre. */
const HEAD_EDGE_SHIFT = -0.14;
const HEAD_CORE_SHIFT = 0.12;
/** Light-core capsule radius as a fraction of the part's full radius. The eroded
 *  gap (1 − this) becomes the dark rim band, taken per-part so thin hands/feet
 *  keep a light core instead of going fully dark. */
const RIM_CORE_FRAC = 0.5;
/** Blur radius for the light-core pass, × base limb radius — feathers the
 *  dark→light step into a smooth gradient. */
const RIM_BLUR_FRAC = 0.45;

/** Bones stroked at the base limb width — arms and legs. */
const LIMB_EDGES: [string, string][] = [
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

/** Hand + foot edges stroked at the reduced extremity width. These are the real
 *  BlazePose landmark connections, unioned into a hand fan and a foot triangle
 *  (heel + toe). A missing endpoint silently skips its edge. */
const EXTREMITY_EDGES: [string, string][] = [
  // Hands — wrist fan + the index↔pinky web.
  ["left_wrist", "left_index"],
  ["left_wrist", "left_pinky"],
  ["left_wrist", "left_thumb"],
  ["left_index", "left_pinky"],
  ["right_wrist", "right_index"],
  ["right_wrist", "right_pinky"],
  ["right_wrist", "right_thumb"],
  ["right_index", "right_pinky"],
  // Feet — ankle→heel→toe triangle.
  ["left_ankle", "left_heel"],
  ["left_ankle", "left_foot_index"],
  ["left_heel", "left_foot_index"],
  ["right_ankle", "right_heel"],
  ["right_ankle", "right_foot_index"],
  ["right_heel", "right_foot_index"],
];

/**
 * Confidence below which a keypoint is treated as an unreliable
 * **Estimated Landmark** and drawn dimmed (in the Skeleton pass only).
 */
const ESTIMATED_DIM_THRESHOLD = 0.4;
/** Opacity multiplier applied to a dimmed Estimated Landmark / its limbs. */
const ESTIMATED_DIM_OPACITY = 0.4;

/** Keypoint names that make up the head — used to size the oval and to skip
 *  the (now redundant) face edges in the Skeleton pass. */
const HEAD_NAMES = new Set([
  "nose",
  "left_eye_inner",
  "left_eye",
  "left_eye_outer",
  "right_eye_inner",
  "right_eye",
  "right_eye_outer",
  "left_ear",
  "right_ear",
  "mouth_left",
  "mouth_right",
]);

/** A transformed overlay point. `score` (when present) drives confidence dimming. */
export interface OverlayPoint {
  x: number;
  y: number;
  /** Carried-through detection/estimation confidence in [0, 1]. */
  score?: number;
}

/**
 * Style options for the skeleton overlay. All fields are optional; unset values
 * fall back to built-in defaults. Sizes are multipliers of body scale.
 */
export interface SkeletonStyle {
  // ── Silhouette pass (the translucent body) ──
  /** Draw the Silhouette body shape. Default true. */
  silhouetteVisible?: boolean;
  /** Silhouette fill colour. Default {@link DEFAULT_COLOR}. */
  silhouetteColor?: string;
  /** Whole-Silhouette opacity in [0, 1]. Default {@link DEFAULT_SILHOUETTE_OPACITY}. */
  silhouetteOpacity?: number;
  /** Limb/foot capsule radius × body scale. Default {@link DEFAULT_LIMB_THICKNESS}. */
  limbThickness?: number;

  // ── Skeleton pass — thin lines ──
  /** Draw the thin connecting lines. Default true. */
  linesVisible?: boolean;
  /** Thin line colour. Default {@link DEFAULT_COLOR}. */
  lineColor?: string;
  /** Thin line radius × body scale. Default {@link DEFAULT_LINE_THICKNESS}. */
  lineThickness?: number;

  // ── Skeleton pass — joint points ──
  /** Draw the joint points. Default true. */
  jointsVisible?: boolean;
  /** Joint colour. Default = {@link DEFAULT_COLOR} (same as lines). */
  jointColor?: string;
  /** Joint radius × body scale. Default {@link DEFAULT_JOINT_RADIUS}. */
  jointRadius?: number;

  // ── Sizing reference ──
  /**
   * Sequence-stable body scale (image px) that all sizes multiply against.
   * Supply {@link computeStableBodyScale} so limb widths stay fixed and do not
   * pulse with the climber's movement. When omitted, a per-frame scale is used
   * (limbs will breathe with the pose — only sensible for one-off draws/tests).
   */
  bodyScale?: number;

  // ── Carried over, unchanged ──
  /**
   * Custom skeleton edges as [fromIndex, toIndex] pairs.
   * Defaults to MediaPipe MP_SKELETON_EDGES.
   */
  skeletonEdges?: [number, number][];
  /**
   * Custom keypoint index → name mapping.
   * Defaults to MediaPipe MP_KP_NAMES.
   */
  keypointNames?: Record<number, string>;
  /**
   * Confidence threshold below which a Skeleton keypoint is dimmed as an
   * unreliable Estimated Landmark. Default {@link ESTIMATED_DIM_THRESHOLD};
   * set to `0` to disable confidence dimming.
   */
  estimatedDimThreshold?: number;
  /** Opacity multiplier for dimmed Estimated Landmarks. Default {@link ESTIMATED_DIM_OPACITY}. */
  estimatedDimOpacity?: number;
  /**
   * Render with the global anatomical palette:
   * - torso/head = lime
   * - arms/hands = lime→cyan gradient
   * - legs/feet = lime→orange gradient
   * with subtle left/right variants.
   *
   * Default: auto (enabled only when using default colours).
   */
  anatomicalPalette?: boolean;
}

/**
 * Convert a PoseFrame's normalized keypoints to image-space pixel coordinates
 * by multiplying out the video dimensions and applying the homography.
 *
 * @param frame       - PoseFrame with x/y normalized to [0, 1].
 * @param h           - Flat 9-element row-major homography matrix.
 * @param videoWidth  - Reference frame width in pixels.
 * @param videoHeight - Reference frame height in pixels.
 * @returns Map of keypoint name → {x, y} in image pixel space.
 */
export function buildTransformedKeypoints(
  frame: PoseFrame,
  h: Float64Array,
  videoWidth: number,
  videoHeight: number,
): Record<string, OverlayPoint> {
  const out: Record<string, OverlayPoint> = {};

  for (const kp of frame.keypoints) {
    const px = kp.x * videoWidth;
    const py = kp.y * videoHeight;
    const { x, y } = applyHomographyMatrix(h, px, py);
    // Carry the confidence through so the renderer can dim Estimated Landmarks.
    out[kp.name] = { x, y, score: kp.score };
  }

  return out;
}

/**
 * Linearly interpolate between two keypoint maps.
 *
 * Keys present in both maps are blended; keys in only one map are taken as-is.
 *
 * @param a     - Keypoints at the earlier timestamp.
 * @param b     - Keypoints at the later timestamp.
 * @param alpha - Blend factor in [0, 1]: 0 = fully a, 1 = fully b.
 */
export function lerpKeypoints(
  a: Record<string, OverlayPoint>,
  b: Record<string, OverlayPoint>,
  alpha: number,
): Record<string, OverlayPoint> {
  const out: Record<string, OverlayPoint> = {};
  for (const name of Object.keys(a)) {
    const pa = a[name];
    const pb = b[name];
    if (pb) {
      out[name] = {
        x: pa.x + alpha * (pb.x - pa.x),
        y: pa.y + alpha * (pb.y - pa.y),
        // A joint dims if either endpoint is low-confidence — take the min.
        score: minScore(pa.score, pb.score),
      };
    } else {
      out[name] = pa;
    }
  }
  for (const name of Object.keys(b)) {
    if (!out[name]) out[name] = b[name];
  }
  return out;
}

/** Min of two optional scores; undefined only when both are undefined. */
function minScore(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };

function midpoint(a: Pt | undefined, b: Pt | undefined): Pt | undefined {
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return a ?? b ?? undefined;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------------------
// Colour helpers — derive the depth-shading shades from the single picked
// `silhouetteColor` by shifting its HSL lightness. Keeps one colour control.
// ---------------------------------------------------------------------------

/** Parse a `#rgb` / `#rrggbb` / `rgb(...)` / `rgba(...)` string to 0-255 RGB.
 *  Falls back to the default accent green for anything unrecognised. */
function parseRgb(css: string): { r: number; g: number; b: number } {
  const s = css.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgb = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return { r: 0, g: 220, b: 120 }; // DEFAULT_COLOR (#00dc78)
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToCss(h: number, s: number, l: number): string {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function sameColor(a: string, b: string): boolean {
  const pa = parseRgb(a);
  const pb = parseRgb(b);
  return pa.r === pb.r && pa.g === pb.g && pa.b === pb.b;
}

function mixCss(a: string, b: string, t: number): string {
  const ta = Math.max(0, Math.min(1, t));
  const ca = parseRgb(a);
  const cb = parseRgb(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * ta);
  const g = Math.round(ca.g + (cb.g - ca.g) * ta);
  const bl = Math.round(ca.b + (cb.b - ca.b) * ta);
  return `rgb(${r}, ${g}, ${bl})`;
}

/** `css` colour with its HSL lightness shifted by `delta` (clamped to [0, 1]). */
function shiftLightness(css: string, delta: number): string {
  const { r, g, b } = parseRgb(css);
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToCss(h, s, Math.max(0, Math.min(1, l + delta)));
}

/** `css` colour with its HSL hue rotated by `delta` (wrapped to [0, 1)). */
function shiftHue(css: string, delta: number): string {
  const { r, g, b } = parseRgb(css);
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToCss((h + delta + 1) % 1, s, l);
}

type Side = "left" | "right" | "center";

/** Which body side a keypoint belongs to, from its `left_`/`right_` name prefix. */
function sideOf(name: string): Side {
  if (name.startsWith("left_")) return "left";
  if (name.startsWith("right_")) return "right";
  return "center";
}

/** The side of an edge: a side only when both endpoints share it, else centre
 *  (spanning bones like shoulder↔shoulder stay unshifted). */
function edgeSide(a: string, b: string): Side {
  const sa = sideOf(a);
  return sa === sideOf(b) ? sa : "center";
}

/** Tint a colour for one body side by rotating the hue toward green — the right
 *  side a touch more than the left — so the two sides read as distinct greens.
 *  Centre bones/joints are returned unchanged. */
function sideColor(css: string, side: Side): string {
  if (side === "left") return shiftHue(css, SIDE_HUE_SHIFT_LEFT);
  if (side === "right") return shiftHue(css, SIDE_HUE_SHIFT_RIGHT);
  return css;
}

function anatomicalSideVariant(css: string, side: Side): string {
  if (side === "left") return shiftHue(css, ANATOMICAL_LEFT_HUE_SHIFT);
  if (side === "right") return shiftHue(css, ANATOMICAL_RIGHT_HUE_SHIFT);
  return css;
}

function armProgress(name: string): number | null {
  if (name.endsWith("_shoulder")) return 0;
  if (name.endsWith("_elbow")) return 0.5;
  if (name.endsWith("_wrist")) return 0.82;
  if (name.endsWith("_thumb") || name.endsWith("_index") || name.endsWith("_pinky")) return 1;
  return null;
}

function legProgress(name: string): number | null {
  if (name.endsWith("_hip")) return 0;
  if (name.endsWith("_knee")) return 0.5;
  if (name.endsWith("_ankle")) return 0.82;
  if (name.endsWith("_heel") || name.endsWith("_foot_index")) return 1;
  return null;
}

function anatomicalPointColor(name: string): string {
  const side = sideOf(name);
  const armT = armProgress(name);
  if (armT !== null && side !== "center") {
    const start = anatomicalSideVariant(DEFAULT_COLOR, side);
    const end = anatomicalSideVariant(ARM_HAND_COLOR, side);
    return mixCss(start, end, armT);
  }
  const legT = legProgress(name);
  if (legT !== null && side !== "center") {
    const start = anatomicalSideVariant(DEFAULT_COLOR, side);
    const end = anatomicalSideVariant(LEG_FOOT_COLOR, side);
    return mixCss(start, end, legT);
  }
  return DEFAULT_COLOR;
}

function edgeStrokeStyle(
  ctx: CanvasRenderingContext2D,
  fromName: string,
  toName: string,
  from: Pt,
  to: Pt,
  useAnatomicalPalette: boolean,
  singleColor: string,
): string | CanvasGradient {
  if (!useAnatomicalPalette) return sideColor(singleColor, edgeSide(fromName, toName));
  const fromColor = anatomicalPointColor(fromName);
  const toColor = anatomicalPointColor(toName);
  if (sameColor(fromColor, toColor) || typeof ctx.createLinearGradient !== "function")
    return fromColor;
  const g = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  g.addColorStop(0, fromColor);
  g.addColorStop(1, toColor);
  return g;
}

/** Does this 2D context support the `filter` property (blur)? jsdom and very old
 *  engines do not — callers fall back to an unblurred (still seam-free) core. */
function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  return "filter" in ctx;
}

/**
 * Body scale from a single frame's keypoints, in image pixels. Prefers shoulder
 * width, then torso height, then hip width. Returns null when the upper body is
 * missing so callers can fall back (per-frame to the canvas, or — preferred —
 * to a sequence-stable scale).
 */
function bodyScaleFromKp(kp: Record<string, { x: number; y: number }>): number | null {
  const ls = kp.left_shoulder,
    rs = kp.right_shoulder;
  const lh = kp.left_hip,
    rh = kp.right_hip;

  if (ls && rs) {
    const d = dist(ls, rs);
    if (d > 1) return d;
  }
  const sMid = midpoint(ls, rs);
  const hMid = midpoint(lh, rh);
  if (sMid && hMid) {
    const d = dist(sMid, hMid);
    if (d > 1) return d * 0.65; // torso height → shoulder-width equivalent
  }
  if (lh && rh) {
    const d = dist(lh, rh);
    if (d > 1) return d;
  }
  return null;
}

/** Per-frame body scale with a canvas-fraction fallback (used only when no
 *  sequence-stable scale was supplied via {@link SkeletonStyle.bodyScale}). */
function bodyScale(kp: Record<string, OverlayPoint>, canvasW: number, canvasH: number): number {
  return bodyScaleFromKp(kp) ?? Math.min(canvasW, canvasH) * 0.15;
}

/**
 * The climber's stable size in the frame: the median per-frame body scale across
 * the whole rendered sequence. Because it is a single constant for the sequence,
 * the Silhouette limbs (and joints/lines) keep a fixed width and do **not** pulse
 * as the climber moves — only the climber-to-frame ratio sets the limb width.
 *
 * Pass the result as {@link SkeletonStyle.bodyScale} to {@link drawSkeleton}.
 */
export function computeStableBodyScale(
  frames: { keypoints: Record<string, { x: number; y: number }> }[],
  canvasW: number,
  canvasH: number,
): number {
  const scales: number[] = [];
  for (const f of frames) {
    const s = bodyScaleFromKp(f.keypoints);
    if (s !== null) scales.push(s);
  }
  if (scales.length === 0) return Math.min(canvasW, canvasH) * 0.15;
  scales.sort((a, b) => a - b);
  const mid = scales.length >> 1;
  return scales.length % 2 ? scales[mid] : (scales[mid - 1] + scales[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Offscreen scratch canvas — reused so the Silhouette can be flattened to one
// uniform translucency without allocating per frame.
// ---------------------------------------------------------------------------

let scratchCanvas: HTMLCanvasElement | null = null;

function getScratch(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  if (!scratchCanvas) scratchCanvas = document.createElement("canvas");
  if (scratchCanvas.width !== w) scratchCanvas.width = w;
  if (scratchCanvas.height !== h) scratchCanvas.height = h;
  const ctx = scratchCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);
  return { canvas: scratchCanvas, ctx };
}

// ---------------------------------------------------------------------------
// Silhouette pass
// ---------------------------------------------------------------------------

interface HeadGeometry {
  cx: number;
  cy: number;
  /** Half-width (along the eye line). */
  major: number;
  /** Half-height (perpendicular — the head is taller than it is wide). */
  minor: number;
  /** In-plane roll, radians. */
  angle: number;
  /** The oval's bottom-edge point (toward the neck) where the neck capsule
   *  connects, so the head can never visually detach from the body. */
  chin: Pt;
}

/**
 * Resolve the head oval: centred on the eyes (so it follows the climber's gaze),
 * tilted to the eye line, and sized from a fixed fraction of body scale — never
 * the ear/eye span, so the head stays identical across frontal/profile views.
 * Also returns the oval's bottom-edge point so the neck capsule can bridge to it
 * (no artificial lift; the bridge is what keeps the head attached). Returns null
 * when there are too few head points to place an oval.
 */
function computeHeadGeometry(kp: Record<string, OverlayPoint>, scale: number): HeadGeometry | null {
  const le = kp.left_eye,
    re = kp.right_eye;
  const lEar = kp.left_ear,
    rEar = kp.right_ear;

  // Centre on the eyes (fallback to the nose).
  let cx: number, cy: number;
  if (le && re) {
    cx = (le.x + re.x) / 2;
    cy = (le.y + re.y) / 2;
  } else if (kp.nose) {
    cx = kp.nose.x;
    cy = kp.nose.y;
  } else {
    return null; // no usable head anchor
  }

  // Clamp the head distance from the shoulders so the neck cannot over-stretch
  // on big head tilts; pull the head in along the neck axis past the cap. The
  // chin bridge (below) still keeps the head attached to the body.
  const sMid = midpoint(kp.left_shoulder, kp.right_shoulder);
  if (sMid) {
    const dx = cx - sMid.x,
      dy = cy - sMid.y;
    const d = Math.hypot(dx, dy);
    const maxD = scale * NECK_MAX_DIST;
    if (d > maxD && d > 0) {
      cx = sMid.x + (dx / d) * maxD;
      cy = sMid.y + (dy / d) * maxD;
    }
  }

  // Tilt from the eye vector (fallback to the ear vector, else upright).
  let angle: number;
  if (le && re) angle = Math.atan2(re.y - le.y, re.x - le.x);
  else if (lEar && rEar) angle = Math.atan2(rEar.y - lEar.y, rEar.x - lEar.x);
  else angle = 0;

  // Fixed body-scale size — independent of how far apart the ears/eyes land.
  const major = scale * HEAD_HALF_WIDTH;
  const minor = major * HEAD_HEIGHT_RATIO;

  // Head-up axis (perpendicular to the eye line), disambiguated to point away
  // from the shoulder-midpoint (handles a climber leaned back on an overhang);
  // fall back to image-up when shoulders are absent.
  let ux = Math.sin(angle),
    uy = -Math.cos(angle);
  if (sMid) {
    if (ux * (cx - sMid.x) + uy * (cy - sMid.y) < 0) {
      ux = -ux;
      uy = -uy;
    }
  } else if (uy > 0) {
    ux = -ux;
    uy = -uy;
  }

  // Bottom edge of the oval, toward the neck — the neck capsule connects here.
  const chin = { x: cx - ux * minor, y: cy - uy * minor };

  return { cx, cy, major, minor, angle, chin };
}

/**
 * Draw the depth-shaded Silhouette body shape (opaque) onto the scratch context,
 * in four passes (see ADR-0005 update). Everything below is composited once at
 * the opacity slider by the caller — the shading is built entirely here.
 *
 *  1. Full union in the **dark** shade — crisp outer edge, dark base, the mask.
 *  2. Eroded **light** bone cores, blurred + `source-atop`, so limbs read as lit
 *     cylinders with dark edges. The dark rim is a property of the whole union,
 *     so adjacent limbs share it and joints stay seam-free.
 *  3. Torso radial fill on top (occludes limbs in the torso region): a mid-shade
 *     interior with a narrow vertical highlight oval down the centre.
 *  4. Head radial on top, drawn last (topmost): light centre → dark edge.
 */
function drawSilhouette(
  sctx: CanvasRenderingContext2D,
  kp: Record<string, OverlayPoint>,
  color: string,
  scale: number,
  limbThickness: number,
  useAnatomicalPalette: boolean,
): void {
  const limbR = Math.max(0.5, limbThickness * scale);
  const extremityR = Math.max(0.5, limbR * EXTREMITY_WIDTH_FACTOR);

  const torsoHeadColor = useAnatomicalPalette ? DEFAULT_COLOR : color;
  const dark = shiftLightness(torsoHeadColor, RIM_DARK_SHIFT);

  const ls = kp.left_shoulder,
    rs = kp.right_shoulder;
  const lh = kp.left_hip,
    rh = kp.right_hip;
  const hasTorso = !!(ls && rs && lh && rh);
  const head = computeHeadGeometry(kp, scale);
  const sMid = midpoint(ls, rs);

  const capsule = (
    fromName: string,
    toName: string,
    a: Pt | undefined,
    b: Pt | undefined,
    r: number,
    lightnessShift: number,
  ): void => {
    if (!a || !b) return;
    sctx.lineWidth = 2 * r;
    if (useAnatomicalPalette) {
      const from = shiftLightness(anatomicalPointColor(fromName), lightnessShift);
      const to = shiftLightness(anatomicalPointColor(toName), lightnessShift);
      if (sameColor(from, to) || typeof sctx.createLinearGradient !== "function") {
        sctx.strokeStyle = from;
      } else {
        const g = sctx.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, from);
        g.addColorStop(1, to);
        sctx.strokeStyle = g;
      }
    } else {
      sctx.strokeStyle = shiftLightness(
        sideColor(color, edgeSide(fromName, toName)),
        lightnessShift,
      );
    }
    sctx.beginPath();
    sctx.moveTo(a.x, a.y);
    sctx.lineTo(b.x, b.y);
    sctx.stroke();
  };

  // Every bone capsule (arms/legs, hands/feet), at `rScale × full radius`. Used
  // at full width for the dark mask (pass 1) and eroded for the light cores
  // (pass 2). Each shared joint lines up because adjacent capsules meet round-capped.
  // No neck capsule — the head floats free (drawn faint below).
  const bones = (rScale: number, lightnessShift: number): void => {
    for (const [a, b] of LIMB_EDGES) capsule(a, b, kp[a], kp[b], limbR * rScale, lightnessShift);
    for (const [a, b] of EXTREMITY_EDGES)
      capsule(a, b, kp[a], kp[b], extremityR * rScale, lightnessShift);
  };

  const torsoPath = (): void => {
    sctx.beginPath();
    sctx.moveTo(ls!.x, ls!.y);
    sctx.lineTo(rs!.x, rs!.y);
    sctx.lineTo(rh!.x, rh!.y);
    sctx.lineTo(lh!.x, lh!.y);
    sctx.closePath();
  };

  // ── Pass 1 — full union in the dark shade. ──
  sctx.save();
  sctx.lineCap = "round";
  sctx.lineJoin = "round";
  sctx.fillStyle = dark;
  sctx.strokeStyle = dark;
  if (hasTorso) {
    torsoPath();
    sctx.fill();
    sctx.lineWidth = 2 * limbR;
    sctx.stroke();
  }
  bones(1, RIM_DARK_SHIFT);
  if (head) {
    // Faint — the head floats free now the neck capsule is gone.
    sctx.globalAlpha = HEAD_SILHOUETTE_OPACITY;
    sctx.beginPath();
    sctx.ellipse(head.cx, head.cy, head.major, head.minor, head.angle, 0, Math.PI * 2);
    sctx.fill();
  }
  sctx.restore();

  // ── Pass 2 — eroded, blurred light bone cores over the dark base. `source-atop`
  //    keeps the light within the union so the outer edge stays dark from pass 1.
  //    Torso/head cores are skipped — their radial fills replace them. ──
  sctx.save();
  sctx.globalCompositeOperation = "source-atop";
  sctx.lineCap = "round";
  sctx.lineJoin = "round";
  if (supportsFilter(sctx)) sctx.filter = `blur(${(limbR * RIM_BLUR_FRAC).toFixed(2)}px)`;
  bones(RIM_CORE_FRAC, RIM_LIGHT_SHIFT);
  sctx.restore();

  // ── Pass 3 — torso radial fill on top. ──
  if (hasTorso) {
    const torsoEdge = shiftLightness(torsoHeadColor, TORSO_EDGE_SHIFT);
    const torsoCore = shiftLightness(torsoHeadColor, TORSO_CORE_SHIFT);
    const hMid = midpoint(lh, rh)!;
    const halfLen = dist(sMid!, hMid) / 2;
    const halfWid = dist(ls!, rs!) / 2;
    sctx.save();
    sctx.globalCompositeOperation = "source-atop";
    // Mid-shade interior, just inside the pass-1 dark perimeter, then clip the
    // highlight to the torso so it cannot bleed into the neck/arms.
    torsoPath();
    sctx.fillStyle = torsoEdge;
    sctx.fill();
    sctx.clip();
    if (halfLen > 0.5 && halfWid > 0.5) {
      const cx = (ls!.x + rs!.x + lh!.x + rh!.x) / 4;
      const cy = (ls!.y + rs!.y + lh!.y + rh!.y) / 4;
      const axis = Math.atan2(hMid.y - sMid!.y, hMid.x - sMid!.x);
      sctx.translate(cx, cy);
      sctx.rotate(axis); // local +x now runs shoulders→hips
      sctx.scale(halfLen, halfWid * 0.5); // tall along the torso, narrow across
      const g = sctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, torsoCore);
      g.addColorStop(1, torsoEdge);
      sctx.fillStyle = g;
      sctx.beginPath();
      sctx.arc(0, 0, 1, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.restore();
  }

  // ── Pass 4 — head radial on top, drawn last (topmost). ──
  if (head) {
    const headEdge = shiftLightness(torsoHeadColor, HEAD_EDGE_SHIFT);
    const headCore = shiftLightness(torsoHeadColor, HEAD_CORE_SHIFT);
    sctx.save();
    sctx.globalAlpha = HEAD_SILHOUETTE_OPACITY;
    sctx.translate(head.cx, head.cy);
    sctx.rotate(head.angle);
    sctx.scale(head.major, head.minor); // unit circle → the head ellipse
    const g = sctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, headCore);
    g.addColorStop(1, headEdge);
    sctx.fillStyle = g;
    sctx.beginPath();
    sctx.arc(0, 0, 1, 0, Math.PI * 2);
    sctx.fill();
    sctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Public draw entry point
// ---------------------------------------------------------------------------

/**
 * Draw the two-pass pose overlay (Silhouette beneath, Skeleton on top) onto a
 * canvas 2D context using image-space pixel coordinates.
 *
 * Edges with a missing endpoint are silently skipped. Face edges are dropped
 * (the head oval replaces them); face joint points are still drawn.
 *
 * @param ctx       - Canvas 2D context to draw onto.
 * @param keypoints - Map of keypoint name → {x, y} in image pixel space.
 * @param options   - Optional style overrides.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  keypoints: Record<string, OverlayPoint>,
  options?: SkeletonStyle,
): void {
  const silhouetteVisible = options?.silhouetteVisible ?? true;
  const silhouetteColor = options?.silhouetteColor ?? options?.lineColor ?? DEFAULT_COLOR;
  const silhouetteOpacity = options?.silhouetteOpacity ?? DEFAULT_SILHOUETTE_OPACITY;
  const limbThickness = options?.limbThickness ?? DEFAULT_LIMB_THICKNESS;

  const linesVisible = options?.linesVisible ?? true;
  const lineColor = options?.lineColor ?? DEFAULT_SKELETON_COLOR;
  const lineThickness = options?.lineThickness ?? DEFAULT_LINE_THICKNESS;

  const jointsVisible = options?.jointsVisible ?? true;
  const jointColor = options?.jointColor ?? DEFAULT_JOINT_COLOR;
  const jointRadius = options?.jointRadius ?? DEFAULT_JOINT_RADIUS;

  const edges = options?.skeletonEdges ?? MP_SKELETON_EDGES;
  const names: Record<number, string> = options?.keypointNames ?? MP_KP_NAMES;
  const dimThreshold = options?.estimatedDimThreshold ?? ESTIMATED_DIM_THRESHOLD;
  const dimOpacity = options?.estimatedDimOpacity ?? ESTIMATED_DIM_OPACITY;
  const useAnatomicalPalette =
    options?.anatomicalPalette ??
    (sameColor(silhouetteColor, DEFAULT_COLOR) &&
      sameColor(lineColor, DEFAULT_SKELETON_COLOR) &&
      sameColor(jointColor, DEFAULT_JOINT_COLOR));

  // Prefer the sequence-stable scale so limb widths do not pulse with movement;
  // fall back to a per-frame scale only when a caller draws without supplying one.
  const scale = options?.bodyScale ?? bodyScale(keypoints, ctx.canvas.width, ctx.canvas.height);

  // ── Silhouette pass — flattened via the offscreen scratch canvas so overlaps
  //    never darken, then composited once at the configured opacity. ──
  if (silhouetteVisible && silhouetteOpacity > 0) {
    const scratch = getScratch(ctx.canvas.width, ctx.canvas.height);
    if (scratch) {
      drawSilhouette(
        scratch.ctx,
        keypoints,
        silhouetteColor,
        scale,
        limbThickness,
        useAnatomicalPalette,
      );
      ctx.save();
      ctx.globalAlpha = silhouetteOpacity;
      ctx.drawImage(scratch.canvas, 0, 0);
      ctx.restore();
    }
  }

  // A point is dimmed when it carries a score below the threshold. Points with
  // no score (legacy callers, fully-detected joints) are never dimmed.
  const isDim = (p: OverlayPoint | undefined): boolean =>
    !!p && p.score !== undefined && p.score < dimThreshold;

  // ── Skeleton pass — thin lines (face edges dropped; oval replaces them). ──
  ctx.save();
  ctx.lineCap = "round";

  if (linesVisible) {
    const lineWidth = Math.max(0.5, 2 * lineThickness * scale);
    for (const [fromIdx, toIdx] of edges) {
      const fromName = names[fromIdx];
      const toName = names[toIdx];
      // Both endpoints in the head → a face edge, now replaced by the oval.
      if (HEAD_NAMES.has(fromName) && HEAD_NAMES.has(toName)) continue;

      const from = keypoints[fromName];
      const to = keypoints[toName];
      if (!from || !to) continue;

      ctx.strokeStyle = edgeStrokeStyle(
        ctx,
        fromName,
        toName,
        from,
        to,
        useAnatomicalPalette,
        lineColor,
      );
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = isDim(from) || isDim(to) ? dimOpacity : 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
  }

  // ── Skeleton pass — joint points. ──
  if (jointsVisible) {
    const r = Math.max(0.5, jointRadius * scale);
    for (const [name, pt] of Object.entries(keypoints)) {
      ctx.fillStyle = useAnatomicalPalette
        ? anatomicalPointColor(name)
        : sideColor(jointColor, sideOf(name));
      ctx.globalAlpha = isDim(pt) ? dimOpacity : 1;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}
