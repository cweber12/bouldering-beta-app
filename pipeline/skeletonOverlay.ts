/**
 * Skeleton overlay drawing for CanvasRenderingContext2D.
 *
 * Converts normalized PoseFrame keypoints to image-space pixel coordinates
 * via a homography matrix, then draws the overlay onto the canvas as two
 * passes:
 *
 *  - **Silhouette** — the skeleton drawn fat: every bone (arms, legs, neck,
 *    hands, feet) stroked as a round-capped capsule, plus two filled regions for
 *    the parts that are areas not bones (the torso quad and a head oval), all
 *    unioned into one body shape. Hand and foot edges are stroked at half the
 *    limb width (anatomical proportion). It is rendered opaque onto a reused
 *    offscreen scratch canvas and composited once at the configured opacity, so
 *    overlapping pieces never darken into seams. Always solid — confidence
 *    dimming never applies here.
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

import type { PoseFrame } from "@/pipeline/poseDetection";
import { MP_SKELETON_EDGES, MP_KP_NAMES } from "@/utils/poseConstants";
import { applyHomographyMatrix } from "@/pipeline/homography";

// ---------------------------------------------------------------------------
// Defaults (all thickness/size values are × body scale unless noted)
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = "#00dc78"; // accent green — shared default for all passes
const DEFAULT_SILHOUETTE_OPACITY = 0.5;
/** Base limb (arm / leg / neck / torso-stroke) capsule **radius** as a fraction
 *  of shoulder width. One width for every bone so joints line up with no step. */
const DEFAULT_LIMB_THICKNESS = 0.18;
/** Skeleton line **radius** as a fraction of shoulder width. */
const DEFAULT_LINE_THICKNESS = 0.015;
/** Joint circle **radius** as a fraction of shoulder width (midpoint of the two). */
const DEFAULT_JOINT_RADIUS = 0.09;

/** Hand / foot capsule radius as a fraction of the base limb radius. The half
 *  width still unions the real landmark edges into a solid hand fan / foot. */
const EXTREMITY_WIDTH_FACTOR = 0.5;

/** Head oval half-width as a fraction of body scale (shoulder width). Fixed —
 *  never the ear/eye span, which balloons in profile and collapses head-on. */
const HEAD_HALF_WIDTH = 0.3;
/** Head oval height-to-width ratio (the head is taller than it is wide). */
const HEAD_HEIGHT_RATIO = 1.3;

/** Bones stroked at the base limb width — arms and legs. */
const LIMB_EDGES: [string, string][] = [
  ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
  ["left_hip", "left_knee"], ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"], ["right_knee", "right_ankle"],
];

/** Hand + foot edges stroked at the reduced extremity width. These are the real
 *  BlazePose landmark connections, unioned into a hand fan and a foot triangle
 *  (heel + toe). A missing endpoint silently skips its edge. */
const EXTREMITY_EDGES: [string, string][] = [
  // Hands — wrist fan + the index↔pinky web.
  ["left_wrist", "left_index"], ["left_wrist", "left_pinky"],
  ["left_wrist", "left_thumb"], ["left_index", "left_pinky"],
  ["right_wrist", "right_index"], ["right_wrist", "right_pinky"],
  ["right_wrist", "right_thumb"], ["right_index", "right_pinky"],
  // Feet — ankle→heel→toe triangle.
  ["left_ankle", "left_heel"], ["left_ankle", "left_foot_index"],
  ["left_heel", "left_foot_index"],
  ["right_ankle", "right_heel"], ["right_ankle", "right_foot_index"],
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
  "nose", "left_eye_inner", "left_eye", "left_eye_outer",
  "right_eye_inner", "right_eye", "right_eye_outer",
  "left_ear", "right_ear", "mouth_left", "mouth_right",
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
  /** Limb/neck/foot capsule radius × body scale. Default {@link DEFAULT_LIMB_THICKNESS}. */
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

/**
 * Body scale from a single frame's keypoints, in image pixels. Prefers shoulder
 * width, then torso height, then hip width. Returns null when the upper body is
 * missing so callers can fall back (per-frame to the canvas, or — preferred —
 * to a sequence-stable scale).
 */
function bodyScaleFromKp(kp: Record<string, { x: number; y: number }>): number | null {
  const ls = kp.left_shoulder, rs = kp.right_shoulder;
  const lh = kp.left_hip, rh = kp.right_hip;

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
function bodyScale(
  kp: Record<string, OverlayPoint>,
  canvasW: number,
  canvasH: number,
): number {
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
function computeHeadGeometry(
  kp: Record<string, OverlayPoint>,
  scale: number,
): HeadGeometry | null {
  const le = kp.left_eye, re = kp.right_eye;
  const lEar = kp.left_ear, rEar = kp.right_ear;

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
  let ux = Math.sin(angle), uy = -Math.cos(angle);
  const sMid = midpoint(kp.left_shoulder, kp.right_shoulder);
  if (sMid) {
    if (ux * (cx - sMid.x) + uy * (cy - sMid.y) < 0) { ux = -ux; uy = -uy; }
  } else if (uy > 0) {
    ux = -ux; uy = -uy;
  }

  // Bottom edge of the oval, toward the neck — the neck capsule connects here.
  const chin = { x: cx - ux * minor, y: cy - uy * minor };

  return { cx, cy, major, minor, angle, chin };
}

/** Draw the full Silhouette body shape (filled, opaque) onto the scratch context. */
function drawSilhouette(
  sctx: CanvasRenderingContext2D,
  kp: Record<string, OverlayPoint>,
  color: string,
  scale: number,
  limbThickness: number,
): void {
  const limbR = Math.max(0.5, limbThickness * scale);
  const extremityR = Math.max(0.5, limbR * EXTREMITY_WIDTH_FACTOR);

  sctx.save();
  sctx.fillStyle = color;
  sctx.strokeStyle = color;
  sctx.lineCap = "round";
  sctx.lineJoin = "round";

  const capsule = (a: Pt | undefined, b: Pt | undefined, r: number): void => {
    if (!a || !b) return;
    sctx.lineWidth = 2 * r;
    sctx.beginPath();
    sctx.moveTo(a.x, a.y);
    sctx.lineTo(b.x, b.y);
    sctx.stroke();
  };

  const ls = kp.left_shoulder, rs = kp.right_shoulder;
  const lh = kp.left_hip, rh = kp.right_hip;

  // Torso — the one filled region. Fill the shoulders→hips quad, then stroke its
  // perimeter at the limb width so the torso side edges meet the leg capsules at
  // the hips and the top edge meets the arm capsules at the shoulders with no step.
  if (ls && rs && lh && rh) {
    sctx.beginPath();
    sctx.moveTo(ls.x, ls.y);
    sctx.lineTo(rs.x, rs.y);
    sctx.lineTo(rh.x, rh.y);
    sctx.lineTo(lh.x, lh.y);
    sctx.closePath();
    sctx.fill();
    sctx.lineWidth = 2 * limbR;
    sctx.stroke();
  }

  // Bones — arms and legs at the base width, hands and feet (their real landmark
  // edges) at the reduced extremity width. Every shared joint lines up because the
  // adjacent capsules meet at the same point with round caps.
  for (const [a, b] of LIMB_EDGES) capsule(kp[a], kp[b], limbR);
  for (const [a, b] of EXTREMITY_EDGES) capsule(kp[a], kp[b], extremityR);

  // Head oval + neck bridge. The neck runs from the shoulder-midpoint to the
  // oval's bottom edge, so the head can never visually detach.
  const head = computeHeadGeometry(kp, scale);
  if (head) {
    capsule(midpoint(ls, rs), head.chin, limbR);
    sctx.beginPath();
    sctx.ellipse(head.cx, head.cy, head.major, head.minor, head.angle, 0, Math.PI * 2);
    sctx.fill();
  }

  sctx.restore();
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
  const lineColor = options?.lineColor ?? DEFAULT_COLOR;
  const lineThickness = options?.lineThickness ?? DEFAULT_LINE_THICKNESS;

  const jointsVisible = options?.jointsVisible ?? true;
  const jointColor = options?.jointColor ?? lineColor;
  const jointRadius = options?.jointRadius ?? DEFAULT_JOINT_RADIUS;

  const edges = options?.skeletonEdges ?? MP_SKELETON_EDGES;
  const names: Record<number, string> = options?.keypointNames ?? MP_KP_NAMES;
  const dimThreshold = options?.estimatedDimThreshold ?? ESTIMATED_DIM_THRESHOLD;
  const dimOpacity = options?.estimatedDimOpacity ?? ESTIMATED_DIM_OPACITY;

  // Prefer the sequence-stable scale so limb widths do not pulse with movement;
  // fall back to a per-frame scale only when a caller draws without supplying one.
  const scale = options?.bodyScale ?? bodyScale(keypoints, ctx.canvas.width, ctx.canvas.height);

  // ── Silhouette pass — flattened via the offscreen scratch canvas so overlaps
  //    never darken, then composited once at the configured opacity. ──
  if (silhouetteVisible && silhouetteOpacity > 0) {
    const scratch = getScratch(ctx.canvas.width, ctx.canvas.height);
    if (scratch) {
      drawSilhouette(scratch.ctx, keypoints, silhouetteColor, scale, limbThickness);
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
    ctx.strokeStyle = lineColor;
    for (const [fromIdx, toIdx] of edges) {
      const fromName = names[fromIdx];
      const toName = names[toIdx];
      // Both endpoints in the head → a face edge, now replaced by the oval.
      if (HEAD_NAMES.has(fromName) && HEAD_NAMES.has(toName)) continue;

      const from = keypoints[fromName];
      const to = keypoints[toName];
      if (!from || !to) continue;

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
    ctx.fillStyle = jointColor;
    for (const pt of Object.values(keypoints)) {
      ctx.globalAlpha = isDim(pt) ? dimOpacity : 1;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}
