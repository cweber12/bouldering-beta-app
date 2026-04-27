/**
 * Skeleton overlay drawing for CanvasRenderingContext2D.
 *
 * Converts normalized PoseFrame keypoints to image-space pixel coordinates
 * via a homography matrix, then draws the skeleton (limbs + joints) onto
 * the canvas.
 *
 * Uses MediaPipe Pose Landmarker (33 keypoints, BlazePose topology).
 * The caller may supply custom skeleton edges and keypoint names via
 * SkeletonStyle; defaults to MediaPipe topology.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

import type { PoseFrame } from "@/pipeline/poseDetection";
import { MP_SKELETON_EDGES, MP_KP_NAMES } from "@/utils/poseConstants";
import { applyHomographyMatrix } from "@/pipeline/homography";

const JOINT_RADIUS = 5;
const JOINT_COLOR = "rgba(34, 197, 94, 0.95)";   // accent green — theme cohesive
const LIMB_COLOR  = "rgba(34, 197, 94, 0.65)";   // accent green, lower opacity for limbs
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
   * Defaults to MediaPipe MP_SKELETON_EDGES.
   */
  skeletonEdges?: [number, number][];
  /**
   * Custom keypoint index → name mapping.
   * Defaults to MediaPipe MP_KP_NAMES.
   */
  keypointNames?: Record<number, string>;
  /**
   * Per-keypoint color overrides keyed by keypoint name.
   * When set, overrides `jointColor` for the named joint.
   */
  jointColorOverrides?: Partial<Record<string, string>>;
  /**
   * Per-keypoint radius overrides keyed by keypoint name.
   * When set, overrides `pointRadius` for the named joint.
   */
  jointRadiusOverrides?: Partial<Record<string, number>>;
  /**
   * Per-edge color overrides. Key format: `"${fromIdx}-${toIdx}"` matching
   * the indices used in `skeletonEdges`. Overrides `limbColor` for that edge.
   */
  edgeColorMap?: Partial<Record<string, string>>;
  /**
   * Per-edge line-width overrides. Same key format as `edgeColorMap`.
   * Overrides `lineWidth` for that edge.
   */
  edgeWidthMap?: Partial<Record<string, number>>;
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
 * Linearly interpolate between two keypoint maps.
 *
 * Keys present in both maps are blended; keys in only one map are taken as-is.
 *
 * @param a     - Keypoints at the earlier timestamp.
 * @param b     - Keypoints at the later timestamp.
 * @param alpha - Blend factor in [0, 1]: 0 = fully a, 1 = fully b.
 */
export function lerpKeypoints(
  a: Record<string, { x: number; y: number }>,
  b: Record<string, { x: number; y: number }>,
  alpha: number,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const name of Object.keys(a)) {
    const pb = b[name];
    if (pb) {
      out[name] = {
        x: a[name].x + alpha * (pb.x - a[name].x),
        y: a[name].y + alpha * (pb.y - a[name].y),
      };
    } else {
      out[name] = a[name];
    }
  }
  for (const name of Object.keys(b)) {
    if (!out[name]) out[name] = b[name];
  }
  return out;
}

/**
 * Draw a pose skeleton (limb lines + joint circles) onto a canvas 2D
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
  const edges = options?.skeletonEdges ?? MP_SKELETON_EDGES;
  const names: Record<number, string> = options?.keypointNames ?? MP_KP_NAMES;
  const edgeColorMap = options?.edgeColorMap;
  const edgeWidthMap = options?.edgeWidthMap;
  const jointColorOverrides = options?.jointColorOverrides;
  const jointRadiusOverrides = options?.jointRadiusOverrides;
  // Draw limb lines first so joints render on top.
  ctx.save();
  ctx.lineCap = "round";

  for (const [fromIdx, toIdx] of edges) {
    const from = keypoints[names[fromIdx]];
    const to = keypoints[names[toIdx]];
    if (!from || !to) continue;

    const edgeKey = `${fromIdx}-${toIdx}`;
    ctx.strokeStyle = edgeColorMap?.[edgeKey] ?? limbColor;
    ctx.lineWidth = edgeWidthMap?.[edgeKey] ?? lineWidth;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  // Draw joint circles — per-keypoint overrides take precedence.
  for (const [name, pt] of Object.entries(keypoints)) {
    ctx.fillStyle = jointColorOverrides?.[name] ?? jointColor;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, jointRadiusOverrides?.[name] ?? pointRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
