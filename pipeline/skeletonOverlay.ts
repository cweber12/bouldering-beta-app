/**
 * Skeleton overlay drawing for CanvasRenderingContext2D.
 *
 * Converts normalized PoseFrame keypoints to image-space pixel coordinates
 * via a homography matrix, then draws the MoveNet skeleton (limbs + joints)
 * onto the canvas.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

import type { PoseFrame } from "@/pipeline/poseDetection";
import { SKELETON_EDGES, KP_NAMES } from "@/utils/poseConstants";
import { applyHomographyMatrix } from "@/pipeline/homography";

const JOINT_RADIUS = 5;
const JOINT_COLOR = "rgba(255, 220, 0, 0.92)";
const LIMB_COLOR = "rgba(0, 220, 120, 0.85)";
const LIMB_WIDTH = 2.5;

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
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};

  for (const kp of frame.keypoints) {
    const px = kp.x * videoWidth;
    const py = kp.y * videoHeight;
    out[kp.name] = applyHomographyMatrix(h, px, py);
  }

  return out;
}

/**
 * Draw a MoveNet pose skeleton (limb lines + joint circles) onto a canvas 2D
 * context using image-space pixel coordinates.
 *
 * Edges with a missing endpoint are silently skipped (keypoint was below the
 * confidence threshold and filtered before storage).
 *
 * @param ctx       - Canvas 2D context to draw onto.
 * @param keypoints - Map of keypoint name → {x, y} in image pixel space.
 * @param options   - Optional color overrides for multi-attempt overlays.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  keypoints: Record<string, { x: number; y: number }>,
  options?: { limbColor?: string; jointColor?: string },
): void {
  const limbColor = options?.limbColor ?? LIMB_COLOR;
  const jointColor = options?.jointColor ?? JOINT_COLOR;
  // Draw limb lines first so joints render on top.
  ctx.save();
  ctx.lineWidth = LIMB_WIDTH;
  ctx.strokeStyle = limbColor;
  ctx.lineCap = "round";

  for (const [fromIdx, toIdx] of SKELETON_EDGES) {
    const from = keypoints[KP_NAMES[fromIdx]];
    const to = keypoints[KP_NAMES[toIdx]];
    if (!from || !to) continue;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  // Draw joint circles.
  ctx.fillStyle = jointColor;
  for (const pt of Object.values(keypoints)) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, JOINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
