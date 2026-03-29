/**
 * Pose estimation wrappers for MoveNet (TF.js) and MediaPipe Pose Landmarker.
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
 * Run MoveNet pose estimation on a single video frame canvas.
 *
 * @param detector  - The loaded TF.js PoseDetector instance.
 * @param canvas    - A canvas element containing the current video frame pixels.
 * @param timestamp - The video timestamp (seconds) this frame corresponds to.
 * @param minScore  - Keypoints below this confidence threshold are dropped.
 * @returns A PoseFrame, or null if the model returned no poses.
 */
export async function estimateFrame(
  detector: PoseDetector,
  canvas: HTMLCanvasElement,
  timestamp: number,
  minScore: number = DEFAULT_MIN_SCORE,
): Promise<PoseFrame | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poses: any[] = await detector.estimatePoses(canvas, {
    maxPoses: 1,
    flipHorizontal: false,
  });

  if (!poses.length || !poses[0].keypoints?.length) return null;

  const raw = poses[0].keypoints;
  const frameW = canvas.width;
  const frameH = canvas.height;

  const keypoints: Keypoint[] = raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((kp: any) => (kp.score ?? 0) >= minScore)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((kp: any) => ({
      name: kp.name ?? "",
      // MoveNet returns pixel coords — normalize to [0,1].
      x: kp.x / frameW,
      y: kp.y / frameH,
      score: kp.score ?? 0,
    }));

  return { timestamp, keypoints };
}

/**
 * Run pose estimation on a single video frame using the specified backend.
 *
 * Dispatches to the MoveNet (TF.js) or MediaPipe Pose Landmarker wrapper
 * based on `backend`. The result is always a unified PoseFrame.
 *
 * @param detector  - The loaded model (TF.js PoseDetector or MediaPipe PoseLandmarker).
 * @param canvas    - A canvas element containing the current video frame pixels.
 * @param timestamp - The video timestamp (seconds) this frame corresponds to.
 * @param backend   - Which backend produced the detector ("movenet" | "mediapipe").
 * @param minScore  - Keypoints below this confidence threshold are dropped.
 * @returns A PoseFrame, or null if no pose was detected.
 */
export async function estimateFrameUnified(
  detector: PoseDetector,
  canvas: HTMLCanvasElement,
  timestamp: number,
  backend: PoseBackend,
  minScore: number = DEFAULT_MIN_SCORE,
): Promise<PoseFrame | null> {
  if (backend === "mediapipe") {
    // MediaPipe's detectForVideo is synchronous — return via resolved promise
    // for a consistent async interface with the MoveNet path.
    return Promise.resolve(
      estimateFrameMediaPipe(detector, canvas, timestamp, minScore),
    );
  }
  return estimateFrame(detector, canvas, timestamp, minScore);
}
