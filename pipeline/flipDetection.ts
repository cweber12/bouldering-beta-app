/**
 * Landmark-flip detection for the **Climber** pose sequence.
 *
 * MediaPipe occasionally mislabels the climber's left/right sides for a few
 * frames (`left_shoulder` jumps to the right side of the body) and then
 * recovers — a detection glitch, *not* a real movement. The One-Euro smoother
 * filters each keypoint by name independently, so it cannot even see a flip as a
 * flip; it sees two unrelated jumps and the overlay pops and settles.
 *
 * A **Landmark Flip** is distinguished from a genuine torso rotation by motion
 * continuity. MediaPipe keeps `left_shoulder` on the climber's *anatomical* left
 * even as it visually crosses to the other side during a real turn, so during a
 * genuine rotation each labelled torso joint moves only a little per frame
 * (low no-swap displacement). A glitch is the opposite: the labelled joint
 * teleports across the body, and *swapping* the left/right labels would make the
 * motion small again. We therefore flag a frame as a flip when (a) the
 * shoulder/hip separation changes sign, (b) the labelled torso joints jumped
 * far, and (c) swapping the labels would cut that jump well below the no-swap
 * cost. Pure lateral translation moves both sides the same way, so swapping does
 * NOT help and the frame is left alone.
 *
 * Flips are *discarded* rather than relabelled — real flips are frequently
 * asymmetric (only part of the body mislabels), so a clean left↔right swap would
 * produce a wrong pose. The caller re-detects across the resulting gap
 * (Adaptive Refinement).
 *
 * This module is framework-agnostic — no React imports, no `cv`. All coordinates
 * are normalised to [0, 1] of the full frame.
 */

import type { Keypoint, PoseFrame } from "@/pipeline/poseDetection";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Total summed normalised torso displacement (across the available shoulder/hip
 * anchors, as if all four were present) above which a sign-flip is treated as a
 * teleport rather than real motion. Scale this UP with `frameStep`: sparser
 * sampling legitimately allows more real motion between detected frames.
 */
export const DEFAULT_TELEPORT_THRESHOLD = 0.35;

/**
 * A flip is declared only when swapping left/right labels would cut the
 * displacement below `swapMargin × no-swap cost` — i.e. the labels clearly
 * crossed over rather than the body translating.
 */
export const DEFAULT_SWAP_MARGIN = 0.5;

export interface FlipDetectionOptions {
  /** See {@link DEFAULT_TELEPORT_THRESHOLD}. */
  teleportThreshold?: number;
  /** See {@link DEFAULT_SWAP_MARGIN}. */
  swapMargin?: number;
}

export interface FlipScanResult {
  /** Frames that passed (not flipped), in input order. */
  kept: PoseFrame[];
  /** Timestamps of frames discarded as Landmark Flips. */
  flippedTimestamps: number[];
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const LEFT_SHOULDER = "left_shoulder";
const RIGHT_SHOULDER = "right_shoulder";
const LEFT_HIP = "left_hip";
const RIGHT_HIP = "right_hip";

interface Pair {
  l: Keypoint;
  r: Keypoint;
}

function dist(a: Keypoint, b: Keypoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Extract the shoulder and hip left/right pairs from a frame (null if incomplete). */
function torsoPairs(frame: PoseFrame): { shoulders: Pair | null; hips: Pair | null } {
  const m = new Map(frame.keypoints.map(kp => [kp.name, kp]));
  const ls = m.get(LEFT_SHOULDER);
  const rs = m.get(RIGHT_SHOULDER);
  const lh = m.get(LEFT_HIP);
  const rh = m.get(RIGHT_HIP);
  return {
    shoulders: ls && rs ? { l: ls, r: rs } : null,
    hips: lh && rh ? { l: lh, r: rh } : null,
  };
}

/**
 * Decide whether `cur` is a Landmark Flip relative to the previous accepted
 * frame `prev`. Returns false when neither torso pair is available in both
 * frames (insufficient evidence — let the frame through and let downstream
 * filtering judge its quality).
 */
export function isLandmarkFlip(
  prev: PoseFrame,
  cur: PoseFrame,
  options: FlipDetectionOptions = {},
): boolean {
  const teleportThreshold = options.teleportThreshold ?? DEFAULT_TELEPORT_THRESHOLD;
  const swapMargin = options.swapMargin ?? DEFAULT_SWAP_MARGIN;

  const p = torsoPairs(prev);
  const c = torsoPairs(cur);

  let noSwap = 0;
  let swap = 0;
  let anchors = 0;
  let signChanged = false;

  for (const key of ["shoulders", "hips"] as const) {
    const pp = p[key];
    const cc = c[key];
    if (!pp || !cc) continue;
    noSwap += dist(pp.l, cc.l) + dist(pp.r, cc.r);
    swap += dist(pp.l, cc.r) + dist(pp.r, cc.l);
    if (Math.sign(pp.r.x - pp.l.x) !== Math.sign(cc.r.x - cc.l.x)) signChanged = true;
    anchors += 2;
  }

  if (anchors === 0) return false;

  // Threshold is expressed for the full four-anchor torso; scale to however many
  // anchors were actually available so a shoulders-only frame is judged fairly.
  const scaledTeleport = teleportThreshold * (anchors / 4);

  return signChanged && noSwap > scaledTeleport && swap < noSwap * swapMargin;
}

// ---------------------------------------------------------------------------
// Stateful walk
// ---------------------------------------------------------------------------

/**
 * Walk a sparse, time-ordered sequence of detected poses and discard
 * **Landmark Flips**, comparing each frame to the previous *accepted* frame
 * (not the previous raw one). This handles the "flips then flips back" case: a
 * short mislabel run is discarded on the way in, and the walk settles when
 * MediaPipe recovers, without oscillating against an already-wrong reference.
 *
 * The first frame is always accepted (nothing to compare against).
 *
 * @param frames  - Sparse detected poses, ascending by timestamp.
 * @param options - Flip-detection thresholds (scale `teleportThreshold` with frameStep).
 * @returns Kept frames plus the timestamps discarded as flips (for Adaptive Refinement).
 */
export function detectFlips(
  frames: PoseFrame[],
  options: FlipDetectionOptions = {},
): FlipScanResult {
  const kept: PoseFrame[] = [];
  const flippedTimestamps: number[] = [];
  let prevKept: PoseFrame | null = null;

  for (const frame of frames) {
    if (prevKept && isLandmarkFlip(prevKept, frame, options)) {
      flippedTimestamps.push(frame.timestamp);
      continue;
    }
    kept.push(frame);
    prevKept = frame;
  }

  return { kept, flippedTimestamps };
}
