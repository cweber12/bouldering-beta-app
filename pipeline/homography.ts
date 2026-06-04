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

// ---------------------------------------------------------------------------
// Resolution-scaled RANSAC reprojection threshold
// ---------------------------------------------------------------------------

/** Baseline reprojection threshold (px) at {@link RANSAC_BASE_EDGE}. */
export const RANSAC_BASE_THRESHOLD = 3.0;
/** Longest-edge resolution the baseline threshold is calibrated for. */
export const RANSAC_BASE_EDGE = 1600;

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
  if (n < 4) return null;

  let srcMat = null;
  let dstMat = null;
  let H = null;

  try {
    srcMat = cv.matFromArray(n, 1, cv.CV_32FC2, srcFlat);
    dstMat = cv.matFromArray(n, 1, cv.CV_32FC2, dstFlat);
    H = cv.findHomography(srcMat, dstMat, cv.RANSAC, opts.ransacReprojThreshold ?? RANSAC_BASE_THRESHOLD);

    if (!H || H.empty()) return null;

    // Copy the 9 float64 values out of WASM memory before freeing the Mat.
    const out = new Float64Array(H.data64F);

    if (opts.gate && !isValidHomography(out, opts.gate.srcWidth, opts.gate.srcHeight, opts.gate)) {
      return null;
    }
    return out;
  } finally {
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
