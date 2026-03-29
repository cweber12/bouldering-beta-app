/**
 * MediaPipe Pose Landmarker wrapper for single-frame pose estimation.
 *
 * Uses the @mediapipe/tasks-vision PoseLandmarker in VIDEO running mode.
 * Landmarks are returned in the unified Keypoint / PoseFrame format used
 * by all downstream pipeline modules.
 *
 * MediaPipe returns 33 normalised landmarks (BlazePose topology) with x, y
 * already in [0, 1]. The `visibility` field is used as the confidence score.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

import type { Keypoint, PoseFrame } from "@/pipeline/poseDetection";
import { MP_KP_NAMES, type MediaPipeKeypointIndex } from "@/utils/poseConstants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseLandmarker = any;

const DEFAULT_MIN_SCORE = 0.3;

/**
 * Run MediaPipe Pose Landmarker on a single video frame canvas.
 *
 * @param landmarker - The loaded MediaPipe PoseLandmarker instance
 *                     (running mode must be VIDEO).
 * @param canvas     - A canvas element containing the current video frame.
 * @param timestamp  - The video timestamp (seconds) this frame corresponds to.
 * @param minScore   - Landmarks below this visibility threshold are dropped.
 * @returns A PoseFrame, or null if no pose was detected.
 */
export function estimateFrameMediaPipe(
  landmarker: PoseLandmarker,
  canvas: HTMLCanvasElement,
  timestamp: number,
  minScore: number = DEFAULT_MIN_SCORE,
): PoseFrame | null {
  // MediaPipe detectForVideo expects milliseconds as the timestamp.
  const timestampMs = Math.round(timestamp * 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = landmarker.detectForVideo(canvas, timestampMs);

  if (!result?.landmarks?.length || result.landmarks[0].length === 0) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawLandmarks: any[] = result.landmarks[0];

  const keypoints: Keypoint[] = rawLandmarks
    .map((lm, idx) => ({
      name: MP_KP_NAMES[idx as MediaPipeKeypointIndex] ?? `landmark_${idx}`,
      // MediaPipe normalised landmarks: x, y already in [0, 1].
      x: lm.x as number,
      y: lm.y as number,
      score: (lm.visibility ?? 0) as number,
    }))
    .filter((kp) => kp.score >= minScore);

  return { timestamp, keypoints };
}
