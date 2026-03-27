/**
 * Pose-frame filtering, interpolation, landmark estimation, and smoothing.
 *
 * Processing order:
 *  1. filterLandmarks — drop frames with too many missing / low-confidence keypoints.
 *  2. interpolatePoseFrames — densify sparse detected frames onto a full timestamp list.
 *  3. estimateMissingLandmarks — fill gaps using temporal + skeletal-geometry cues.
 *  4. smoothPoseFrames — One-Euro adaptive filter to reduce jitter.
 *
 * This module is framework-agnostic — no React imports.
 */

import type { PoseFrame, Keypoint } from "@/pipeline/poseDetection";
import { MOVENET_KEYPOINT_COUNT, KP_NAMES, SKELETON_EDGES } from "@/utils/poseConstants";

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
// One-Euro filter internals
// ---------------------------------------------------------------------------

interface OneEuroState {
  x: number;
  dx: number;
  lastTime: number;
}

const ONE_EURO_MIN_CUTOFF = 1.7;
const ONE_EURO_BETA = 0.3;
const ONE_EURO_D_CUTOFF = 1.0;

function smoothingAlpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function oneEuroStep(
  x: number,
  t: number,
  prev: OneEuroState | null,
  minCutoff: number,
  beta: number,
  dCutoff: number,
): { value: number; state: OneEuroState } {
  if (!prev) {
    return { value: x, state: { x, dx: 0, lastTime: t } };
  }
  const dt = Math.max(t - prev.lastTime, 1e-6);
  const rawDx = (x - prev.x) / dt;
  const alphaD = smoothingAlpha(dt, dCutoff);
  const dx = alphaD * rawDx + (1 - alphaD) * prev.dx;
  const cutoff = minCutoff + beta * Math.abs(dx);
  const alpha = smoothingAlpha(dt, cutoff);
  const filtered = alpha * x + (1 - alpha) * prev.x;
  return { value: filtered, state: { x: filtered, dx, lastTime: t } };
}

// ---------------------------------------------------------------------------
// Precomputed skeleton adjacency + full keypoint name set
// ---------------------------------------------------------------------------

const ADJACENCY: ReadonlyMap<string, readonly string[]> = (() => {
  const adj = new Map<string, string[]>();
  for (const [fromIdx, toIdx] of SKELETON_EDGES) {
    const from = KP_NAMES[fromIdx];
    const to = KP_NAMES[toIdx];
    if (!adj.has(from)) adj.set(from, []);
    if (!adj.has(to)) adj.set(to, []);
    adj.get(from)!.push(to);
    adj.get(to)!.push(from);
  }
  return adj;
})();

const ALL_KP_NAMES: ReadonlySet<string> = new Set(
  Object.values(KP_NAMES) as string[],
);

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

/** Binary search: index of first element with timestamp >= target. */
function lowerBound(frames: PoseFrame[], target: number): number {
  let lo = 0, hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].timestamp < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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
 * Uses binary search O(log n) per timestamp instead of linear scan.
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
    const nextIdx = lowerBound(processedFrames, timestamp);

    if (nextIdx >= processedFrames.length) {
      return { timestamp, keypoints: processedFrames[processedFrames.length - 1].keypoints };
    }

    if (nextIdx === 0) {
      return { timestamp, keypoints: processedFrames[0].keypoints };
    }

    const next = processedFrames[nextIdx];

    if (next.timestamp === timestamp) {
      return { timestamp, keypoints: next.keypoints };
    }

    const prev = processedFrames[nextIdx - 1];
    const t = (timestamp - prev.timestamp) / (next.timestamp - prev.timestamp);

    return {
      timestamp,
      keypoints: interpolateKeypoints(prev.keypoints, next.keypoints, t),
    };
  });
}

// ---------------------------------------------------------------------------
// Landmark estimation
// ---------------------------------------------------------------------------

/**
 * Estimate missing landmarks for each frame using temporal interpolation
 * and skeletal geometry.
 *
 * For each frame:
 *  1. Identify which of the 17 MoveNet keypoints are absent.
 *  2. Temporal: if both a previous and next frame contain the keypoint
 *     within `maxTemporalGap`, linearly interpolate.
 *  3. Structural: if a skeleton neighbour exists in the current frame and
 *     a nearby reference frame has both joints, apply the bone-vector offset.
 *  4. Single-neighbour extrapolation: use a close temporal neighbour with
 *     reduced confidence (limited to 2 frames distance).
 *
 * Frames with more than `maxEstimatable` missing keypoints are returned
 * unchanged — the pose is too degraded for reliable estimation.
 *
 * @param frames          - Dense PoseFrame array (e.g. after interpolatePoseFrames).
 * @param maxTemporalGap  - How many frames to search in each direction. Default: 10.
 * @param maxEstimatable  - Skip estimation when more keypoints are missing. Default: 5.
 */
export function estimateMissingLandmarks(
  frames: PoseFrame[],
  maxTemporalGap = 10,
  maxEstimatable = 5,
): PoseFrame[] {
  if (frames.length === 0) return frames;

  return frames.map((frame, i) => {
    const existing = new Map(frame.keypoints.map(kp => [kp.name, kp]));
    const missing: string[] = [];
    for (const name of ALL_KP_NAMES) {
      if (!existing.has(name)) missing.push(name);
    }
    if (missing.length === 0 || missing.length > maxEstimatable) return frame;

    const estimated: Keypoint[] = [...frame.keypoints];

    for (const name of missing) {
      // 1. Temporal: nearest prev/next frames that contain the keypoint.
      let prevKp: Keypoint | null = null;
      let prevDist = 0;
      for (let j = i - 1; j >= Math.max(0, i - maxTemporalGap); j--) {
        const kp = frames[j].keypoints.find(k => k.name === name);
        if (kp) { prevKp = kp; prevDist = i - j; break; }
      }

      let nextKp: Keypoint | null = null;
      let nextDist = 0;
      for (let j = i + 1; j <= Math.min(frames.length - 1, i + maxTemporalGap); j++) {
        const kp = frames[j].keypoints.find(k => k.name === name);
        if (kp) { nextKp = kp; nextDist = j - i; break; }
      }

      if (prevKp && nextKp) {
        const t = prevDist / (prevDist + nextDist);
        estimated.push({
          name,
          x: lerp(prevKp.x, nextKp.x, t),
          y: lerp(prevKp.y, nextKp.y, t),
          score: Math.min(prevKp.score, nextKp.score) * 0.8,
        });
        continue;
      }

      // 2. Structural: bone-vector from a connected joint in a nearby frame.
      const neighbors = ADJACENCY.get(name);
      if (neighbors) {
        let found = false;
        for (const neighborName of neighbors) {
          const currentNeighbor = existing.get(neighborName);
          if (!currentNeighbor) continue;
          for (let j = Math.max(0, i - maxTemporalGap); j <= Math.min(frames.length - 1, i + maxTemporalGap); j++) {
            if (j === i) continue;
            const refTarget = frames[j].keypoints.find(k => k.name === name);
            const refNeighbor = frames[j].keypoints.find(k => k.name === neighborName);
            if (refTarget && refNeighbor) {
              estimated.push({
                name,
                x: currentNeighbor.x + (refTarget.x - refNeighbor.x),
                y: currentNeighbor.y + (refTarget.y - refNeighbor.y),
                score: currentNeighbor.score * 0.6,
              });
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) continue;
      }

      // 3. Single temporal neighbour — limited extrapolation (max 2 frames).
      if (prevKp && prevDist <= 2) {
        estimated.push({ ...prevKp, name, score: prevKp.score * 0.5 });
      } else if (nextKp && nextDist <= 2) {
        estimated.push({ ...nextKp, name, score: nextKp.score * 0.5 });
      }
    }

    return { ...frame, keypoints: estimated };
  });
}

// ---------------------------------------------------------------------------
// Adaptive smoothing (One-Euro filter)
// ---------------------------------------------------------------------------

/**
 * Apply a One-Euro adaptive low-pass filter across a dense PoseFrame sequence.
 *
 * The One-Euro filter adapts its effective cutoff frequency based on the speed
 * of each keypoint: when still, smoothing is heavy (removes jitter); when
 * moving fast, smoothing is light (preserves responsiveness). This is the
 * standard approach used in production pose-estimation pipelines (MediaPipe,
 * OpenPose).
 *
 * Only keypoints already present in each frame are smoothed — missing keypoints
 * remain absent.
 *
 * @param frames    - Dense PoseFrame array (e.g. output of estimateMissingLandmarks).
 * @param minCutoff - Minimum cutoff frequency (Hz). Lower = smoother when still.
 *                    Default: 1.7.
 * @param beta      - Speed coefficient. Higher = less lag during fast motion.
 *                    Default: 0.3.
 */
export function smoothPoseFrames(
  frames: PoseFrame[],
  minCutoff = ONE_EURO_MIN_CUTOFF,
  beta = ONE_EURO_BETA,
): PoseFrame[] {
  if (frames.length === 0) return frames;

  const stateX = new Map<string, OneEuroState>();
  const stateY = new Map<string, OneEuroState>();

  return frames.map(frame => {
    const smoothed: Keypoint[] = frame.keypoints.map(kp => {
      const rx = oneEuroStep(kp.x, frame.timestamp, stateX.get(kp.name) ?? null, minCutoff, beta, ONE_EURO_D_CUTOFF);
      const ry = oneEuroStep(kp.y, frame.timestamp, stateY.get(kp.name) ?? null, minCutoff, beta, ONE_EURO_D_CUTOFF);
      stateX.set(kp.name, rx.state);
      stateY.set(kp.name, ry.state);
      return { ...kp, x: rx.value, y: ry.value };
    });
    return { ...frame, keypoints: smoothed };
  });
}
