/**
 * Skeleton overlay drawing for CanvasRenderingContext2D.
 *
 * Converts normalized PoseFrame keypoints to image-space pixel coordinates
 * via a homography matrix, then draws the overlay onto the canvas as two
 * passes:
 *
 *  - **Silhouette** — a single, unioned, semi-transparent body shape (limb /
 *    neck / foot capsules, a filled torso polygon, a filled head oval, mitten
 *    hand caps). It is rendered opaque onto a reused offscreen scratch canvas
 *    and composited once at the configured opacity, so overlapping pieces never
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

import type { PoseFrame } from "@/pipeline/poseDetection";
import { MP_SKELETON_EDGES, MP_KP_NAMES } from "@/utils/poseConstants";
import { applyHomographyMatrix } from "@/pipeline/homography";

// ---------------------------------------------------------------------------
// Defaults (all thickness/size values are × body scale unless noted)
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = "#00dc78"; // accent green — shared default for all passes
const DEFAULT_SILHOUETTE_OPACITY = 0.5;
/** Limb / neck capsule **radius** as a fraction of shoulder width. */
const DEFAULT_LIMB_THICKNESS = 0.18;
/** Skeleton line **radius** as a fraction of shoulder width. */
const DEFAULT_LINE_THICKNESS = 0.015;
/** Joint circle **radius** as a fraction of shoulder width (midpoint of the two). */
const DEFAULT_JOINT_RADIUS = 0.09;

/** Head oval: padding on the ear-to-ear width, and the height-to-width ratio. */
const HEAD_WIDTH_PAD = 1.35;
const HEAD_HEIGHT_RATIO = 1.4;
/**
 * Floor on the head-oval half-width as a fraction of body scale (shoulder
 * width). Keeps the head a sensible size when the ears sit close together
 * (frontal view) instead of shrinking to the landmark span.
 */
const HEAD_SCALE_FLOOR = 0.32;

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

/** Draw the head oval (filled, opaque) onto the scratch context. */
function drawHeadOval(
  sctx: CanvasRenderingContext2D,
  kp: Record<string, OverlayPoint>,
  scale: number,
): void {
  const le = kp.left_ear, re = kp.right_ear;
  let cx: number, cy: number, angle: number, major: number;

  if (le && re) {
    cx = (le.x + re.x) / 2;
    cy = (le.y + re.y) / 2;
    angle = Math.atan2(re.y - le.y, re.x - le.x);
    major = (dist(le, re) / 2) * HEAD_WIDTH_PAD;
  } else {
    // Fallback: eye-outer (or eye-centre) vector. Eyes are closer together, so
    // pad the width more to approximate the full head.
    const leo = kp.left_eye_outer ?? kp.left_eye;
    const reo = kp.right_eye_outer ?? kp.right_eye;
    if (leo && reo) {
      cx = (leo.x + reo.x) / 2;
      cy = (leo.y + reo.y) / 2;
      angle = Math.atan2(reo.y - leo.y, reo.x - leo.x);
      major = (dist(leo, reo) / 2) * HEAD_WIDTH_PAD * 1.4;
    } else {
      return; // fewer than two usable head points — skip the oval entirely
    }
  }

  // Never let the landmark span alone size the head — floor it to body scale so
  // a frontal head (ears nearly overlapping) still reads at a believable size.
  major = Math.max(major, scale * HEAD_SCALE_FLOOR);
  const minor = major * HEAD_HEIGHT_RATIO;

  sctx.beginPath();
  sctx.ellipse(cx, cy, major, minor, angle, 0, Math.PI * 2);
  sctx.fill();
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
  const disc = (p: Pt | undefined, r: number): void => {
    if (!p) return;
    sctx.beginPath();
    sctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    sctx.fill();
  };

  const ls = kp.left_shoulder, rs = kp.right_shoulder;
  const lh = kp.left_hip, rh = kp.right_hip;

  // Torso polygon (shoulders + hips quad). Fill it, then stroke its outline at
  // the limb width so the body extends limbR past the joint-centre edges — this
  // pads the torso to meet the limb capsules (which also extend limbR past the
  // joints) instead of letting the limbs poke out beyond a flush torso edge.
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

  // Neck — shoulder-midpoint → ear-midpoint (or eye/nose fallback), limb width.
  const sMid = midpoint(ls, rs);
  const headTop =
    midpoint(kp.left_ear, kp.right_ear) ??
    midpoint(kp.left_eye, kp.right_eye) ??
    kp.nose;
  capsule(sMid, headTop, limbR);

  // Arms.
  capsule(ls, kp.left_elbow, limbR);
  capsule(kp.left_elbow, kp.left_wrist, limbR);
  capsule(rs, kp.right_elbow, limbR);
  capsule(kp.right_elbow, kp.right_wrist, limbR);

  // Legs.
  capsule(lh, kp.left_knee, limbR);
  capsule(kp.left_knee, kp.left_ankle, limbR);
  capsule(rh, kp.right_knee, limbR);
  capsule(kp.right_knee, kp.right_ankle, limbR);

  // Hands — mitten cap at the wrist (no spindly finger capsules).
  disc(kp.left_wrist, limbR * 1.1);
  disc(kp.right_wrist, limbR * 1.1);

  // Feet — capsule ankle → foot_index.
  capsule(kp.left_ankle, kp.left_foot_index, limbR * 0.9);
  capsule(kp.right_ankle, kp.right_foot_index, limbR * 0.9);

  // Head oval.
  drawHeadOval(sctx, kp, scale);

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
