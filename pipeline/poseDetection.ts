/**
 * Pose estimation wrapper for MediaPipe Pose Landmarker.
 *
 * Accepts a canvas element (drawn from a video frame) and returns an array
 * of normalized keypoints with confidence scores, filtered by minScore.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

import type { PoseBackend } from "@/utils/poseConstants";
import { estimateFrameMediaPipe } from "@/pipeline/mediapipePoseDetection";

export type { PoseBackend };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;

export interface Keypoint {
  /** Keypoint name (e.g. "left_wrist"). */
  name: string;
  /** X position normalized to [0, 1] relative to the frame width. */
  x: number;
  /** Y position normalized to [0, 1] relative to the frame height. */
  y: number;
  /** Model confidence score in [0, 1]. */
  score: number;
}

export interface PoseFrame {
  /** Video timestamp in seconds. */
  timestamp: number;
  /** Filtered keypoints for this frame. Empty if no pose was detected. */
  keypoints: Keypoint[];
}

const DEFAULT_MIN_SCORE = 0.3;

/**
 * Run pose estimation on a single video frame using MediaPipe Pose Landmarker.
 *
 * @param detector  - The loaded MediaPipe PoseLandmarker instance.
 * @param canvas    - A canvas element containing the current video frame pixels.
 * @param timestamp - The video timestamp (seconds) this frame corresponds to.
 * @param _backend  - Ignored (only MediaPipe is supported). Kept for API compatibility.
 * @param minScore  - Keypoints below this confidence threshold are dropped.
 * @returns A PoseFrame, or null if no pose was detected.
 */
export async function estimateFrameUnified(
  detector: PoseDetector,
  canvas: HTMLCanvasElement,
  timestamp: number,
  _backend?: PoseBackend,
  minScore: number = DEFAULT_MIN_SCORE,
): Promise<PoseFrame | null> {
  return Promise.resolve(
    estimateFrameMediaPipe(detector, canvas, timestamp, minScore),
  );
}
