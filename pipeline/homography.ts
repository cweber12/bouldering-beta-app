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

/**
 * Compute a 3×3 homography matrix (perspective transform) mapping points in
 * the reference video frame to points in the uploaded route image.
 *
 * Uses RANSAC with a 3-pixel reprojection threshold to reject outlier matches.
 *
 * @returns A flat 9-element Float64Array (row-major, 3×3), or null when fewer
 *          than 4 valid matches are available (minimum required for RANSAC).
 */
export function computeHomography(
  cv: CV,
  matches: OrbMatch[],
  refFeatures: OrbFeatures,
  queryFeatures: OrbFeatures,
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
    H = cv.findHomography(srcMat, dstMat, cv.RANSAC, 3.0);

    if (!H || H.empty()) return null;

    // Copy the 9 float64 values out of WASM memory before freeing the Mat.
    return new Float64Array(H.data64F);
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
