/**
 * Skeleton overlay drawing for CanvasRenderingContext2D.
 *
 * Converts normalized PoseFrame keypoints to image-space pixel coordinates
 * via a homography matrix, then draws the skeleton (limbs + joints) onto
 * the canvas.
 *
 * Supports both MoveNet (17 keypoints) and MediaPipe Pose Landmarker
 * (33 keypoints) topologies. The caller may supply custom skeleton edges
 * and keypoint names via SkeletonStyle; defaults to MoveNet topology.
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
 * Style options for the skeleton overlay.
 * All fields are optional; unset values fall back to built-in defaults.
 */
export interface SkeletonStyle {
  limbColor?: string;
  jointColor?: string;
  /** Line width in CSS pixels (1–10). Default 2.5. */
  lineWidth?: number;
  /** Joint circle radius in CSS pixels (1–15). Default 5. */
  pointRadius?: number;
  /**
   * Custom skeleton edges as [fromIndex, toIndex] pairs.
   * Supply MediaPipe edges when rendering 33-keypoint data.
   * Defaults to MoveNet SKELETON_EDGES.
   */
  skeletonEdges?: [number, number][];
  /**
   * Custom keypoint index → name mapping.
   * Supply MediaPipe names when rendering 33-keypoint data.
   * Defaults to MoveNet KP_NAMES.
   */
  keypointNames?: Record<number, string>;
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
 * @param options   - Optional style overrides (colors, line width, point radius).
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  keypoints: Record<string, { x: number; y: number }>,
  options?: SkeletonStyle,
): void {
  const limbColor = options?.limbColor ?? LIMB_COLOR;
  const jointColor = options?.jointColor ?? JOINT_COLOR;
  const lineWidth = options?.lineWidth ?? LIMB_WIDTH;
  const pointRadius = options?.pointRadius ?? JOINT_RADIUS;
  const edges = options?.skeletonEdges ?? SKELETON_EDGES;
  const names: Record<number, string> = options?.keypointNames ?? KP_NAMES;
  // Draw limb lines first so joints render on top.
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = limbColor;
  ctx.lineCap = "round";

  for (const [fromIdx, toIdx] of edges) {
    const from = keypoints[names[fromIdx]];
    const to = keypoints[names[toIdx]];
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
    ctx.arc(pt.x, pt.y, pointRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
