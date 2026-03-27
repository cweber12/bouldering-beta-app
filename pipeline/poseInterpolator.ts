/**
 * Linear interpolation of pose frames between sparsely sampled keyframes.
 *
 * Outdoor mode runs pose estimation every N frames to save time. This module
 * fills the gaps by linearly interpolating each keypoint's (x, y) between
 * the two nearest detected frames, producing a dense frame array that can be
 * stored and rendered like indoor frames.
 *
 * Confidence score treatment:
 *   - Interpolated frames inherit the minimum score of both endpoints.
 *     This is conservative: an interpolated keypoint is only as reliable as
 *     its least-confident anchor.
 *   - Frames before the first detected pose reuse the first pose.
 *   - Frames after the last detected pose reuse the last pose.
 *
 * This module is framework-agnostic — no React imports.
 */

import type { PoseFrame, Keypoint } from "@/pipeline/poseDetection";

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
 * to reduce jitter and fill brief dropouts where a keypoint is absent in one
 * or two frames.
 *
 * Two-pass approach:
 *  1. Forward-fill: for each keypoint track, carry the last known position
 *     forward into frames where the keypoint is missing.
 *  2. Backward-fill: seed the leading edge of any track that starts with
 *     missing values from the first detected occurrence.
 *  3. EMA smoothing on x/y independently.
 *
 * @param frames - Dense PoseFrame array (e.g. output of interpolatePoseFrames).
 * @param alpha  - EMA weight in (0, 1]. Lower = smoother, higher = more reactive.
 *                 Defaults to 0.3.
 */
export function smoothPoseFrames(frames: PoseFrame[], alpha = 0.3): PoseFrame[] {
  if (frames.length === 0) return frames;

  // Collect all keypoint names that appear in any frame.
  const names = new Set<string>();
  for (const f of frames) {
    for (const kp of f.keypoints) names.add(kp.name);
  }

  // Build a per-keypoint mutable track so we can fill gaps and smooth.
  // Track[i] may be null when the keypoint was absent in frame i.
  const tracks = new Map<string, (Keypoint | null)[]>();
  for (const name of names) {
    const track: (Keypoint | null)[] = new Array(frames.length).fill(null);
    for (let i = 0; i < frames.length; i++) {
      const kp = frames[i].keypoints.find(k => k.name === name) ?? null;
      track[i] = kp;
    }
    tracks.set(name, track);
  }

  // Pass 1: forward-fill.
  for (const [, track] of tracks) {
    let last: Keypoint | null = null;
    for (let i = 0; i < track.length; i++) {
      if (track[i] !== null) {
        last = track[i];
      } else if (last !== null) {
        track[i] = { ...last };
      }
    }
  }

  // Pass 2: backward-fill leading gaps.
  for (const [, track] of tracks) {
    let first: Keypoint | null = null;
    for (let i = 0; i < track.length; i++) {
      if (track[i] !== null) { first = track[i]; break; }
    }
    if (first === null) continue;
    for (let i = 0; i < track.length; i++) {
      if (track[i] === null) track[i] = { ...first };
      else break;
    }
  }

  // Pass 3: EMA smoothing.
  for (const [, track] of tracks) {
    let ex: number | null = null;
    let ey: number | null = null;
    for (let i = 0; i < track.length; i++) {
      const kp = track[i];
      if (kp === null) { ex = null; ey = null; continue; }
      if (ex === null) { ex = kp.x; ey = kp.y!; }
      else {
        ex = alpha * kp.x + (1 - alpha) * ex;
        ey = alpha * kp.y + (1 - alpha) * ey!;
      }
      track[i] = { ...kp, x: ex, y: ey };
    }
  }

  // Rebuild PoseFrame array using smoothed tracks.
  return frames.map((frame, i) => {
    const keypoints: Keypoint[] = [];
    for (const [name, track] of tracks) {
      const kp = track[i];
      if (kp !== null && kp.name === name) keypoints.push(kp);
    }
    return { timestamp: frame.timestamp, keypoints };
  });
}
