/**
 * Route-crop estimation: project the reference frame's stored climber crop box
 * into an uploaded route photo's coordinate space, producing a fractional crop
 * rectangle the UI can pre-position over the photo for the user to confirm.
 *
 * This is the same geometry the re-anchor pass uses internally (rough homography
 * → map the crop-box corners → bounding box), surfaced as a confirmable crop
 * instead of being consumed silently. The reference crop box is the region the
 * user drew around the climber at scan time, so the projection frames "where the
 * climb lands" on the photo.
 *
 * Pure CV + math — no React imports. Keep it that way.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

import { computeHomography, applyHomographyMatrix } from "@/pipeline/matching/homography";
import type { OrbFeatures, OrbMatch } from "@/pipeline/matching/orbDetector";
import type { CropFraction } from "@/utils/cropFraction";

export interface RouteCropEstimate {
  /** Projected crop in photo-space, fractional — feeds CropBoxOverlay. */
  crop: CropFraction;
  /** Candidate match count the estimate was built from. */
  matchCount: number;
  /** Confidence band derived from the match count. */
  confidence: "high" | "low";
}

/** Match count at or above which an auto-frame estimate is treated as confident. */
export const AUTO_FRAME_CONFIDENCE_MATCHES = 10;
/** Minimum projected crop extent (fraction) so the box stays visible/grabbable. */
const MIN_CROP_FRACTION = 0.05;

/**
 * Estimate the route-photo crop by projecting the reference crop box through a
 * rough (gated) homography. Returns `null` — signalling the caller to fall back
 * to manual cropping — when there is no stored crop box, too few matches, the
 * homography fails the validity gate, or the projection lands entirely off-photo.
 *
 * `queryFeatures` must be in native (full-resolution) photo coordinates and
 * `photoWidth`/`photoHeight` the native photo dimensions, so the projected box
 * maps 1:1 onto the displayed photo.
 */
export function estimateRouteCrop(
  cv: CV,
  matches: OrbMatch[],
  refFeatures: OrbFeatures,
  queryFeatures: OrbFeatures,
  photoWidth: number,
  photoHeight: number,
  opts: {
    ransacReprojThreshold: number;
    gate: { srcWidth: number; srcHeight: number };
  },
): RouteCropEstimate | null {
  const box = refFeatures.cropBox;
  if (!box) return null;
  if (!(photoWidth > 0) || !(photoHeight > 0)) return null;
  if (matches.length < 4) return null;

  const h = computeHomography(cv, matches, refFeatures, queryFeatures, {
    ransacReprojThreshold: opts.ransacReprojThreshold,
    gate: opts.gate,
  });
  if (!h) return null;

  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ].map((pt) => applyHomographyMatrix(h, pt.x, pt.y));

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  if (![...xs, ...ys].every(Number.isFinite)) return null;

  // Clamp the projected bounding box to the photo bounds.
  const left = Math.max(0, Math.min(...xs));
  const top = Math.max(0, Math.min(...ys));
  const right = Math.min(photoWidth, Math.max(...xs));
  const bottom = Math.min(photoHeight, Math.max(...ys));

  let w = (right - left) / photoWidth;
  let hh = (bottom - top) / photoHeight;
  // Projection landed entirely off-photo — nothing useful to frame.
  if (!(w > 0) || !(hh > 0)) return null;

  let x = left / photoWidth;
  let y = top / photoHeight;
  // Keep a minimum visible extent without pushing the box off the photo.
  w = Math.min(1, Math.max(MIN_CROP_FRACTION, w));
  hh = Math.min(1, Math.max(MIN_CROP_FRACTION, hh));
  x = Math.max(0, Math.min(x, 1 - w));
  y = Math.max(0, Math.min(y, 1 - hh));

  return {
    crop: { x, y, w, h: hh },
    matchCount: matches.length,
    confidence: matches.length >= AUTO_FRAME_CONFIDENCE_MATCHES ? "high" : "low",
  };
}
