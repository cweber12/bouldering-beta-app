/**
 * Crop-box utilities for climbing video processing.
 *
 * Provides coordinate helpers for projecting keypoints detected in a cropped
 * sub-region back to full-frame normalized space.
 *
 * This module is framework-agnostic — no React imports.
 */

import type { Keypoint } from "@/pipeline/poseDetection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HipCenter {
  /** Normalized x position in [0, 1] relative to the frame. */
  x: number;
  /** Normalized y position in [0, 1] relative to the frame. */
  y: number;
}

export interface CropBox {
  /** Left edge in pixels (clamped to [0, videoWidth]). */
  x: number;
  /** Top edge in pixels (clamped to [0, videoHeight]). */
  y: number;
  /** Width of the crop region in pixels. */
  width: number;
  /** Height of the crop region in pixels. */
  height: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the hip center from a set of keypoints.
 *
 * Averages left_hip and right_hip when both are present. Falls back to
 * whichever single hip keypoint is detected. Returns null when no hip
 * keypoints exist in the set.
 */
export function extractHipCenter(keypoints: Keypoint[]): HipCenter | null {
  const lh = keypoints.find(kp => kp.name === "left_hip");
  const rh = keypoints.find(kp => kp.name === "right_hip");
  if (!lh && !rh) return null;
  if (lh && rh) return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const hip = (lh ?? rh)!;
  return { x: hip.x, y: hip.y };
}

/**
 * Re-project keypoints detected on a cropped sub-canvas back to full-frame
 * normalized coordinates.
 *
 * Pose detection is run on the crop, so keypoint x/y are in [0, 1] relative
 * to the crop dimensions. This function undoes the crop offset so keypoints
 * are stored consistently in full-frame normalized space ([0, 1] relative to
 * videoWidth × videoHeight).
 *
 * @param keypoints   - Keypoints with x/y normalized to the crop.
 * @param crop        - The CropBox that was applied.
 * @param videoWidth  - Full frame width in pixels.
 * @param videoHeight - Full frame height in pixels.
 */
export function mapKeypointsToFullFrame(
  keypoints: Keypoint[],
  crop: CropBox,
  videoWidth: number,
  videoHeight: number,
): Keypoint[] {
  return keypoints.map(kp => ({
    ...kp,
    x: (kp.x * crop.width + crop.x) / videoWidth,
    y: (kp.y * crop.height + crop.y) / videoHeight,
  }));
}
