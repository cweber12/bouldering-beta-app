/**
 * Pose-frame filtering, interpolation, and smoothing utilities.
 *
 * Processing order:
 *  1. filterLandmarks — drop frames with too many missing / low-confidence keypoints.
 *  2. interpolatePoseFrames — densify sparse detected frames onto a full timestamp list.
 *  3. smoothPoseFrames — EMA to reduce jitter on the dense sequence.
 *
 * Landmark estimation — injecting estimated keypoints into gap frames — is not
 * implemented here. When it is ready, pass a LandmarkEstimator to the future
 * `estimateLandmarks()` helper that will sit between steps 2 and 3.
 *
 * This module is framework-agnostic — no React imports.
 */

import type { PoseFrame, Keypoint } from "@/pipeline/poseDetection";

/** Expected number of COCO keypoints that MoveNet Lightning outputs. */
const MOVENET_KEYPOINT_COUNT = 17;

// ---------------------------------------------------------------------------
// Landmark estimation hook (pluggable — not yet implemented)
// ---------------------------------------------------------------------------

/**
 * A function that attempts to fill or correct individual keypoints in a frame
 * using contextual information from neighbouring frames.
 *
 * - Return the input `frame` unchanged (or a clone) when no estimation is
 *   possible.
 * - `context.prev` and `context.next` are the nearest frames on either side
 *   that passed the {@link filterLandmarks} quality threshold.
 *
 * @see {@link applyLandmarkEstimator} — wraps this function over a dense array.
 *
 * @future Implementation should use relative joint geometry and neighbour
 *         positions rather than simple position carry-over.
 */
export type LandmarkEstimator = (
  frame: PoseFrame,
  context: { prev: PoseFrame | null; next: PoseFrame | null },
) => PoseFrame;

/**
 * Apply a LandmarkEstimator across every frame in a dense array.
 *
 * Pass the output of {@link interpolatePoseFrames} here, before
 * {@link smoothPoseFrames}, when a concrete estimator is available.
 *
 * @param frames    - Dense pose-frame array (each frame has a `timestamp`).
 * @param estimator - Estimation function to apply.
 * @returns New array of frames with keypoints enhanced by the estimator.
 */
export function applyLandmarkEstimator(
  frames: PoseFrame[],
  estimator: LandmarkEstimator,
): PoseFrame[] {
  return frames.map((frame, i) => {
    const prev = i > 0 ? frames[i - 1] : null;
    const next = i < frames.length - 1 ? frames[i + 1] : null;
    return estimator(frame, { prev, next });
  });
}


// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Drop frames that have too many missing or low-confidence keypoints.
 *
 * A keypoint counts as "bad" if its confidence score is below `minScore`,
 * and as "missing" if it is absent from the frame entirely.
 *
 * Use this to obtain clean anchor frames before calling
 * {@link interpolatePoseFrames}, preventing poor detections from polluting
 * the interpolated timeline.
 *
 * @param frames           - Input pose frames (may be sparse or dense).
 * @param minScore         - Confidence threshold; keypoints below this are
 *                           counted as bad. Default: 0.3.
 * @param maxMissingAllowed - Maximum number of bad/missing keypoints before
 *                           the frame is discarded. Default: 2.
 */
export function filterLandmarks(
  frames: PoseFrame[],
  minScore = 0.3,
  maxMissingAllowed = 2,
): PoseFrame[] {
  return frames.filter(f => {
    const lowConf = f.keypoints.filter(kp => kp.score < minScore).length;
    const missing = Math.max(0, MOVENET_KEYPOINT_COUNT - f.keypoints.length);
    return (lowConf + missing) <= maxMissingAllowed;
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Linearly interpolate keypoints between two anchor frames.
 *
 * Only keypoints present in BOTH frames are included in the output; partially
 * detected poses are not extrapolated from side to side.
 *
 * @param from - Keypoints at the earlier anchor frame.
 * @param to   - Keypoints at the later anchor frame.
 * @param t    - Progress in [0, 1] between `from` (0) and `to` (1).
 */
function interpolateKeypoints(from: Keypoint[], to: Keypoint[], t: number): Keypoint[] {
  const toMap = new Map(to.map(kp => [kp.name, kp]));
  return from
    .filter(kp => toMap.has(kp.name))
    .map(kp => {
      const b = toMap.get(kp.name)!;
      return {
        name: kp.name,
        x: lerp(kp.x, b.x, t),
        y: lerp(kp.y, b.y, t),
        score: Math.min(kp.score, b.score),
      };
    });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produce a dense PoseFrame array from a sparse set of detected frames.
 *
 * @param processedFrames - Pose frames returned by the detector (one per
 *                          N-th sampled video frame). Must be sorted by
 *                          ascending timestamp.
 * @param allTimestamps   - Timestamps for every sampled video frame (dense).
 *                          The output array is aligned to this sequence.
 * @returns One PoseFrame per entry in `allTimestamps`.
 */
export function interpolatePoseFrames(
  processedFrames: PoseFrame[],
  allTimestamps: number[],
): PoseFrame[] {
  if (processedFrames.length === 0) {
    return allTimestamps.map(timestamp => ({ timestamp, keypoints: [] }));
  }

  return allTimestamps.map(timestamp => {
    // Find the first detected frame at or after this timestamp.
    const nextIdx = processedFrames.findIndex(f => f.timestamp >= timestamp);

    if (nextIdx === -1) {
      // Past the last detected frame — hold the last known pose.
      return { timestamp, keypoints: processedFrames[processedFrames.length - 1].keypoints };
    }

    if (nextIdx === 0) {
      // Before the first detected frame — use the first known pose.
      return { timestamp, keypoints: processedFrames[0].keypoints };
    }

    const next = processedFrames[nextIdx];

    // Exact match — no interpolation needed.
    if (next.timestamp === timestamp) {
      return { timestamp, keypoints: next.keypoints };
    }

    // Interpolate between the surrounding anchor frames.
    const prev = processedFrames[nextIdx - 1];
    const t = (timestamp - prev.timestamp) / (next.timestamp - prev.timestamp);

    return {
      timestamp,
      keypoints: interpolateKeypoints(prev.keypoints, next.keypoints, t),
    };
  });
}

// ---------------------------------------------------------------------------
// Landmark smoothing
// ---------------------------------------------------------------------------

/**
 * Apply an exponential moving average (EMA) across a dense PoseFrame sequence
 * to reduce jitter.
 *
 * Only keypoints already present in each frame are smoothed. No gap-filling is
 * performed here — missing keypoints are left absent. Use
 * {@link filterLandmarks} before calling this and {@link interpolatePoseFrames}
 * to supply good anchor positions, so gaps are already bridged by interpolation
 * rather than by positional carry-over.
 *
 * @param frames - Dense PoseFrame array (e.g. output of interpolatePoseFrames).
 * @param alpha  - EMA weight in (0, 1]. Lower = smoother, higher = more reactive.
 *                 Defaults to 0.3.
 */
export function smoothPoseFrames(frames: PoseFrame[], alpha = 0.3): PoseFrame[] {
  if (frames.length === 0) return frames;

  // Build a per-name EMA state from the first frame each track appears in.
  const emaX = new Map<string, number>();
  const emaY = new Map<string, number>();

  return frames.map(frame => {
    const smoothed: Keypoint[] = frame.keypoints.map(kp => {
      if (!emaX.has(kp.name)) {
        // Seed: first time we see this keypoint.
        emaX.set(kp.name, kp.x);
        emaY.set(kp.name, kp.y);
        return kp;
      }
      const sx = alpha * kp.x + (1 - alpha) * emaX.get(kp.name)!;
      const sy = alpha * kp.y + (1 - alpha) * emaY.get(kp.name)!;
      emaX.set(kp.name, sx);
      emaY.set(kp.name, sy);
      return { ...kp, x: sx, y: sy };
    });
    return { ...frame, keypoints: smoothed };
  });
}
