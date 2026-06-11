/**
 * Homography computation and point transformation.
 *
 * Uses OpenCV's findHomography (RANSAC) to estimate a perspective transform
 * mapping reference-frame pixel coordinates to uploaded-image pixel coordinates.
 *
 * All OpenCV allocations are freed before returning — no WASM leaks.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

import type { OrbFeatures, OrbMatch } from "@/pipeline/orbDetector";
import type { HomographyStats, HomographyFailureReason } from "@/pipeline/diagnostics";

// ---------------------------------------------------------------------------
// Resolution-scaled RANSAC reprojection threshold
// ---------------------------------------------------------------------------

/** Baseline reprojection threshold (px) at {@link RANSAC_BASE_EDGE}. */
export const RANSAC_BASE_THRESHOLD = 3.0;
/** Longest-edge resolution the baseline threshold is calibrated for. */
export const RANSAC_BASE_EDGE = 1600;

/**
 * Fixed seed for OpenCV's global RNG, set before every `findHomography` call.
 * RANSAC samples minimal point sets from `cv`'s default RNG, whose state
 * otherwise persists and advances across calls — so the same matches could
 * yield slightly different homographies run-to-run. Re-seeding to a constant
 * makes the estimate deterministic for a given set of matches.
 */
export const RANSAC_RNG_SEED = 0x5eed;

/**
 * Scale the RANSAC reprojection threshold to the destination (query-photo)
 * resolution. The threshold lives in destination pixels, so a high-resolution
 * photo needs a proportionally larger tolerance to admit the same physical
 * mis-registration. Clamped to a sane [2, 8] px band.
 */
export function ransacReprojThresholdFor(longestEdge: number): number {
  if (!(longestEdge > 0)) return RANSAC_BASE_THRESHOLD;
  const t = RANSAC_BASE_THRESHOLD * (longestEdge / RANSAC_BASE_EDGE);
  return Math.min(8, Math.max(2, t));
}

// ---------------------------------------------------------------------------
// Homography validity gate
// ---------------------------------------------------------------------------

export interface HomographyGateOptions {
  /** Minimum allowed linear scale (mapped quad edge / source edge). Default 0.02. */
  minScale?: number;
  /** Maximum allowed linear scale. Default 50. */
  maxScale?: number;
}

/**
 * Reject degenerate or flipped homographies. A valid `H` must map the source
 * rectangle (0,0)–(srcWidth,srcHeight) to a non-degenerate, convex, correctly
 * wound quad with positive orientation and a sane overall scale.
 *
 * Checks:
 *  - positive determinant of the 2×2 linear part (no reflection / flip);
 *  - all four mapped corners finite and on the same side of the plane at
 *    infinity (consistent sign of the homogeneous `w`);
 *  - the mapped quad is convex with consistent winding (no bow-tie / fold);
 *  - the mapped-quad area implies a linear scale within [minScale, maxScale].
 *
 * Doubles as the co-visibility guard for per-keyframe matching: a keyframe that
 * shares too little with the photo produces a degenerate `H` and is rejected.
 *
 * Pure math — no OpenCV required.
 */
export function isValidHomography(
  h: Float64Array,
  srcWidth: number,
  srcHeight: number,
  opts: HomographyGateOptions = {},
): boolean {
  const minScale = opts.minScale ?? 0.02;
  const maxScale = opts.maxScale ?? 50;

  if (h.length < 9 || !h.every(Number.isFinite)) return false;
  if (!(srcWidth > 0) || !(srcHeight > 0)) return false;

  // 2×2 linear-part determinant must be positive (orientation preserved).
  const det2 = h[0] * h[4] - h[1] * h[3];
  if (!(det2 > 0)) return false;

  // Map the four source-rectangle corners.
  const src = [
    [0, 0],
    [srcWidth, 0],
    [srcWidth, srcHeight],
    [0, srcHeight],
  ];
  const corners = src.map(([x, y]) => {
    const w = h[6] * x + h[7] * y + h[8];
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w, w };
  });
  if (corners.some(c => !Number.isFinite(c.x) || !Number.isFinite(c.y) || c.w === 0)) {
    return false;
  }
  // All corners must share the sign of w (none wrapped past infinity).
  const wSign = Math.sign(corners[0].w);
  if (corners.some(c => Math.sign(c.w) !== wSign)) return false;

  // Convexity + consistent winding: every consecutive edge cross-product shares
  // a sign and is non-zero.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false; // collinear / degenerate
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }

  // Scale bounds from the mapped-quad (shoelace) area.
  const srcArea = srcWidth * srcHeight;
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    area2 += a.x * b.y - b.x * a.y;
  }
  const linScale = Math.sqrt(Math.abs(area2) / 2 / srcArea);
  if (linScale < minScale || linScale > maxScale) return false;

  return true;
}

export interface ComputeHomographyOptions {
  /**
   * RANSAC reprojection threshold in destination (query) pixels. Defaults to
   * {@link RANSAC_BASE_THRESHOLD}. Use {@link ransacReprojThresholdFor} to scale
   * it to the query resolution.
   */
  ransacReprojThreshold?: number;
  /**
   * When provided, the result is rejected (returns null) unless it passes
   * {@link isValidHomography} for a source rectangle of these dimensions —
   * typically the reference video-frame size.
   */
  gate?: { srcWidth: number; srcHeight: number } & HomographyGateOptions;
  /**
   * Optional out-param for detection diagnostics. When supplied, it is populated
   * on every return path (including the three null cases) with the candidate
   * match count, RANSAC inlier count/ratio, and a {@link HomographyFailureReason}
   * — so a failed match is a labelled data point rather than an opaque `null`.
   * Pre-allocate one with `emptyHomographyStats()`. Existing callers pass nothing
   * and are unaffected.
   */
  stats?: HomographyStats;
}

/** Populate the {@link HomographyStats} out-param in place. */
function fillHomographyStats(
  stats: HomographyStats,
  matchCount: number,
  inlierCount: number,
  homographyFound: boolean,
  failureReason: HomographyFailureReason,
): void {
  stats.matchCount = matchCount;
  stats.inlierCount = inlierCount;
  stats.inlierRatio = matchCount > 0 ? inlierCount / matchCount : 0;
  stats.homographyFound = homographyFound;
  stats.failureReason = failureReason;
}

/**
 * Compute a 3×3 homography matrix (perspective transform) mapping points in
 * the reference video frame to points in the uploaded route image.
 *
 * Uses RANSAC to reject outlier matches; the reprojection threshold defaults to
 * {@link RANSAC_BASE_THRESHOLD} and can be resolution-scaled via `opts`. When
 * `opts.gate` is supplied, a homography that fails the validity gate is treated
 * as no solution (returns null).
 *
 * @returns A flat 9-element Float64Array (row-major, 3×3), or null when fewer
 *          than 4 valid matches are available or the result fails the gate.
 */
export function computeHomography(
  cv: CV,
  matches: OrbMatch[],
  refFeatures: OrbFeatures,
  queryFeatures: OrbFeatures,
  opts: ComputeHomographyOptions = {},
): Float64Array | null {
  const srcFlat: number[] = [];
  const dstFlat: number[] = [];

  for (const m of matches) {
    const ref = refFeatures.keypoints[m.queryIdx];
    const qry = queryFeatures.keypoints[m.trainIdx];
    if (!ref || !qry) continue;
    srcFlat.push(ref.pt.x, ref.pt.y);
    dstFlat.push(qry.pt.x, qry.pt.y);
  }

  const n = srcFlat.length / 2;
  const matchCount = matches.length;
  if (n < 4) {
    if (opts.stats) fillHomographyStats(opts.stats, matchCount, 0, false, "too_few_matches");
    return null;
  }

  let srcMat = null;
  let dstMat = null;
  let H = null;
  let mask = null;

  try {
    srcMat = cv.matFromArray(n, 1, cv.CV_32FC2, srcFlat);
    dstMat = cv.matFromArray(n, 1, cv.CV_32FC2, dstFlat);
    // Pass an inlier mask so the diagnostics out-param can report how many of the
    // candidate matches RANSAC actually kept (countNonZero below).
    mask = new cv.Mat();
    // Seed the global RNG so RANSAC is deterministic for these matches (guarded
    // in case a build/mock lacks setRNGSeed).
    cv.setRNGSeed?.(RANSAC_RNG_SEED);
    H = cv.findHomography(srcMat, dstMat, cv.RANSAC, opts.ransacReprojThreshold ?? RANSAC_BASE_THRESHOLD, mask);

    if (!H || H.empty()) {
      if (opts.stats) fillHomographyStats(opts.stats, matchCount, 0, false, "degenerate");
      return null;
    }

    const inlierCount = mask && !mask.empty() ? cv.countNonZero(mask) : 0;

    // Copy the 9 float64 values out of WASM memory before freeing the Mat.
    const out = new Float64Array(H.data64F);

    if (opts.gate && !isValidHomography(out, opts.gate.srcWidth, opts.gate.srcHeight, opts.gate)) {
      if (opts.stats) fillHomographyStats(opts.stats, matchCount, inlierCount, false, "gate_rejected");
      return null;
    }
    if (opts.stats) fillHomographyStats(opts.stats, matchCount, inlierCount, true, "ok");
    return out;
  } finally {
    mask?.delete();
    H?.delete();
    dstMat?.delete();
    srcMat?.delete();
  }
}

/**
 * Apply a 3×3 homography matrix (flat Float64Array, row-major) to a 2D point.
 *
 * Uses perspective division:
 *   [x', y', w'] = H · [px, py, 1]
 *   result = { x: x'/w', y: y'/w' }
 *
 * Pure math — no OpenCV required.
 */
export function applyHomographyMatrix(
  h: Float64Array,
  px: number,
  py: number,
): { x: number; y: number } {
  const w = h[6] * px + h[7] * py + h[8];
  return {
    x: (h[0] * px + h[1] * py + h[2]) / w,
    y: (h[3] * px + h[4] * py + h[5]) / w,
  };
}

// ---------------------------------------------------------------------------
// Per-keyframe homography interpolation (Panning Capture)
// ---------------------------------------------------------------------------

/**
 * A homography mapping reference video-frame pixels → Route Photo pixels,
 * anchored at a single **Keyframe**'s video timestamp. Panning Capture builds an
 * ordered array of these (one per matchable Keyframe) and interpolates between
 * the bracketing pair for every rendered frame.
 */
export interface KeyframeHomography {
  /** Video timestamp (seconds) the homography was anchored at. */
  timestamp: number;
  /** Flat 9-element row-major 3×3 homography. */
  h: Float64Array;
}

interface DecomposedHomography {
  tx: number;
  ty: number;
  /** Rotation angle (radians) of the 2×2 linear part. */
  theta: number;
  /** Scale along the rotated x axis. */
  sx: number;
  /** Scale along the rotated y axis. */
  sy: number;
  /** Shear term coupling the two axes. */
  shear: number;
  /** Perspective coefficients (h6, h7) after normalising h8 = 1. */
  px: number;
  py: number;
}

/**
 * Decompose a homography into translation, rotation, scale, shear and
 * perspective via an RQ-style split of the 2×2 linear part
 * (`A = R(θ) · [[sx, shear], [0, sy]]`). Lossless: {@link recomposeHomography}
 * inverts it exactly.
 */
function decomposeHomography(h: Float64Array): DecomposedHomography {
  // Normalise so the homogeneous scale h8 = 1.
  const s = h[8] !== 0 ? 1 / h[8] : 1;
  const a = h[0] * s, b = h[1] * s, tx = h[2] * s;
  const c = h[3] * s, d = h[4] * s, ty = h[5] * s;
  const px = h[6] * s, py = h[7] * s;

  const sx = Math.hypot(a, c);
  const theta = Math.atan2(c, a);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Rotate the second column back by -θ to recover shear / sy.
  const shear = cos * b + sin * d;
  const sy = -sin * b + cos * d;

  return { tx, ty, theta, sx, sy, shear, px, py };
}

/** Recompose a homography from its decomposed components. */
function recomposeHomography(p: DecomposedHomography): Float64Array {
  const cos = Math.cos(p.theta);
  const sin = Math.sin(p.theta);
  const a = cos * p.sx;
  const c = sin * p.sx;
  const b = cos * p.shear - sin * p.sy;
  const d = sin * p.shear + cos * p.sy;
  return new Float64Array([a, b, p.tx, c, d, p.ty, p.px, p.py, 1]);
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate an angle along the shortest arc (slerp for a 2-D rotation). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/**
 * Interpolate between two photo-homographies by decomposing each into
 * translation / rotation / scale / shear / perspective, blending each component
 * (shortest-arc slerp for the rotation, linear for the rest) by `alpha`, then
 * recomposing. `alpha` is clamped to [0, 1]; the endpoints reproduce `a` and `b`.
 *
 * Pure math — no OpenCV required.
 */
export function interpolateHomographies(
  a: Float64Array,
  b: Float64Array,
  alpha: number,
): Float64Array {
  const t = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
  if (t === 0) return new Float64Array(a);
  if (t === 1) return new Float64Array(b);
  const da = decomposeHomography(a);
  const db = decomposeHomography(b);
  return recomposeHomography({
    tx: lerp(da.tx, db.tx, t),
    ty: lerp(da.ty, db.ty, t),
    theta: lerpAngle(da.theta, db.theta, t),
    sx: lerp(da.sx, db.sx, t),
    sy: lerp(da.sy, db.sy, t),
    shear: lerp(da.shear, db.shear, t),
    px: lerp(da.px, db.px, t),
    py: lerp(da.py, db.py, t),
  });
}

/**
 * Resolve the homography to apply at video time `t` from an ordered list of
 * per-keyframe homographies. Before the first / after the last keyframe the
 * nearest endpoint is held (clamped); between two keyframes the pair is
 * decompose-interpolated by time fraction.
 *
 * @param keyframes - Non-empty, ascending by `timestamp`.
 */
export function homographyAtTime(
  keyframes: KeyframeHomography[],
  t: number,
): Float64Array {
  const n = keyframes.length;
  if (n === 0) throw new Error("homographyAtTime: no keyframe homographies.");
  if (n === 1 || t <= keyframes[0].timestamp) return keyframes[0].h;
  if (t >= keyframes[n - 1].timestamp) return keyframes[n - 1].h;

  // Find the bracketing pair (last keyframe with timestamp ≤ t).
  let lo = 0;
  for (let i = 1; i < n; i++) {
    if (keyframes[i].timestamp <= t) lo = i;
    else break;
  }
  const a = keyframes[lo];
  const b = keyframes[lo + 1];
  const dt = b.timestamp - a.timestamp;
  const alpha = dt > 0 ? (t - a.timestamp) / dt : 0;
  return interpolateHomographies(a.h, b.h, alpha);
}
