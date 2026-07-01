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

import type { Keypoint, PoseFrame } from "@/pipeline/pose/poseDetection";
import { MP_KP_NAMES, type MediaPipeKeypointIndex } from "@/utils/poseConstants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseLandmarker = any;

const DEFAULT_MIN_SCORE = 0.3;

/**
 * MediaPipe VIDEO mode requires strictly increasing timestamps per landmarker
 * instance. Track the last timestamp we sent for each instance and bump by at
 * least 1 ms when callers provide stale or regressing values.
 */
const lastTimestampMsByLandmarker = new WeakMap<object, number>();

/**
 * Map one raw MediaPipe landmark array into a filtered {@link PoseFrame}.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPoseFrame(rawLandmarks: any[], timestamp: number, minScore: number): PoseFrame {
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

/**
 * Resolve a strictly-increasing millisecond timestamp for a landmarker.
 *
 * MediaPipe VIDEO mode requires monotonic timestamps per instance; bump by at
 * least 1 ms when callers provide stale or regressing values.
 */
function nextMonotonicTimestampMs(landmarker: PoseLandmarker, timestamp: number): number {
  const requestedTimestampMs = Math.round(timestamp * 1000);
  const prevTimestampMs = lastTimestampMsByLandmarker.get(landmarker as object) ?? -Infinity;
  const timestampMs = Math.max(requestedTimestampMs, prevTimestampMs + 1);
  lastTimestampMsByLandmarker.set(landmarker as object, timestampMs);
  return timestampMs;
}

/**
 * Run MediaPipe Pose Landmarker on a single video frame canvas and return
 * **every** detected pose (one {@link PoseFrame} per person).
 *
 * The number of poses returned is capped by the landmarker's `numPoses`
 * option (see {@link usePoseModel}). Poses with no surviving keypoints after
 * the `minScore` filter are dropped. The climber-identity tracker uses this to
 * pick the correct person when bystanders are present.
 *
 * @param landmarker - The loaded MediaPipe PoseLandmarker instance (VIDEO mode).
 * @param canvas     - A canvas element containing the current video frame.
 * @param timestamp  - The video timestamp (seconds) this frame corresponds to.
 * @param minScore   - Landmarks below this visibility threshold are dropped.
 * @returns Array of detected poses (possibly empty), each tagged with `timestamp`.
 */
export function estimateFramesMediaPipe(
  landmarker: PoseLandmarker,
  canvas: HTMLCanvasElement,
  timestamp: number,
  minScore: number = DEFAULT_MIN_SCORE,
): PoseFrame[] {
  const timestampMs = nextMonotonicTimestampMs(landmarker, timestamp);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = landmarker.detectForVideo(canvas, timestampMs);

  if (!result?.landmarks?.length) return [];

  return (result.landmarks as unknown[][])
    .map((raw) => toPoseFrame(raw, timestamp, minScore))
    .filter((frame) => frame.keypoints.length > 0);
}

/**
 * Run MediaPipe Pose Landmarker and return the single most-prominent pose.
 *
 * Thin wrapper over {@link estimateFramesMediaPipe} kept for callers that do
 * not need multi-pose disambiguation (e.g. gap recovery).
 *
 * @returns A PoseFrame, or null if no pose was detected.
 */
export function estimateFrameMediaPipe(
  landmarker: PoseLandmarker,
  canvas: HTMLCanvasElement,
  timestamp: number,
  minScore: number = DEFAULT_MIN_SCORE,
): PoseFrame | null {
  return estimateFramesMediaPipe(landmarker, canvas, timestamp, minScore)[0] ?? null;
}
