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
 * The left/right test above keys entirely off the *horizontal* ordering of the
 * torso, so it is blind to the other glitch MediaPipe produces when the climber
 * blends into the wall: it fits the whole skeleton **upside down** — head and
 * shoulders landmarks placed at the feet end — while keeping left-on-left and
 * right-on-right. No horizontal sign changes, so that path passes the inverted
 * frame straight through. A second, independent **orientation** test catches it
 * by the torso *up-vector* (shoulders centroid − hips centroid): a genuine
 * inversion rotates that axis gradually and the centroids stay put frame-to-frame,
 * whereas a glitch reverses the axis (>120°) in one step AND teleports the torso.
 * Either test firing marks the frame a flip; the orientation test alone covers the
 * vertical case the left/right swap geometry cannot see.
 *
 * Flips are *discarded* rather than relabelled — real flips are frequently
 * asymmetric (only part of the body mislabels), so a clean left↔right swap would
 * produce a wrong pose. The caller re-detects across the resulting gap
 * (Adaptive Refinement).
 *
 * Because each frame is judged against the last *accepted* frame, a rejection
 * run would otherwise sustain itself indefinitely — see {@link FLIP_MAX_RUN} and
 * ADR 0023 (`docs/adr/0023-re-anchoring-landmark-flip-gate.md`) for the cap and
 * re-anchor that end it.
 *
 * This module is framework-agnostic — no React imports, no `cv`. All coordinates
 * are normalised to [0, 1] of the full frame.
 */

import type { Keypoint, PoseFrame } from "@/pipeline/pose/poseDetection";

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

/**
 * Cosine of the angle between the torso up-vectors of two consecutive accepted
 * frames below which the pose is treated as vertically **inverted** (head end
 * swapped with the feet end). -0.5 ⇒ the axis reversed by more than 120°, well
 * past any plausible per-frame rotation of a climber on a near-vertical wall.
 */
export const DEFAULT_ORIENTATION_FLIP_COS = -0.5;

/**
 * Minimum torso length (normalised shoulders-to-hips centroid distance) the
 * **reference** (previous) frame must have before the orientation test trusts its
 * up-vector. Below this the anchor torso is too compact (heavily foreshortened /
 * balled-up) for its axis to be meaningful, so sign noise is ignored.
 */
export const MIN_TORSO_LENGTH = 0.05;

/**
 * Minimum up-vector length the **current** frame must have to be compared. Kept
 * far below {@link MIN_TORSO_LENGTH} on purpose: a frame MediaPipe fitted upside
 * down frequently collapses its torso (the centroids cross), so requiring a full
 * torso here would let exactly the flips we want to catch slip through. We only
 * need a non-degenerate direction to take the cosine against.
 */
export const MIN_UP_VECTOR_LENGTH = 0.01;

/**
 * Teleport budget for the orientation test, expressed in **torso lengths** rather
 * than as a fraction of the frame. A real inversion swaps the shoulder and hip
 * centroids, moving each by roughly one torso length, so the combined centroid
 * displacement of a genuine flip is comfortably above one torso length. Scaling by
 * the body — not the frame — is what makes the test fire for a small / distant
 * climber whose whole torso spans under 0.1 of the frame: an absolute frame-fraction
 * gate is enormous next to their body and never trips, even on a full 180° flip.
 */
export const ORIENTATION_TELEPORT_TORSO_FACTOR = 0.6;

/**
 * Maximum consecutive frames {@link detectFlips} may discard before it accepts
 * the next one (flagged) and re-anchors its comparison reference.
 *
 * The per-frame verdict is sound; the *walk* was not. Because each frame is
 * judged against the last **accepted** frame, a rejection leaves the reference
 * stale, the Climber keeps moving away from it, and every later frame trips the
 * teleport test harder than the last — the gate's own output becomes its next
 * input and nothing in the walk can end the run. Measured runs reached 398
 * consecutive frames, and 76.7% of rejections on frames where the Climber was
 * actually present discarded a pose that agreed with Ground Truth.
 *
 * 5 is chosen against the detection cadence, not the geometry: at the default
 * frameStep 5 on the 100 ms grid a detection frame is every 500 ms, so this caps
 * a run at ~2.5 s of video. Real left/right glitches last one to two detection
 * frames and are still discarded whole; only a run long enough to be evidence
 * that the *reference* is stale reaches the cap.
 */
export const FLIP_MAX_RUN = 5;

export interface FlipDetectionOptions {
  /** See {@link DEFAULT_TELEPORT_THRESHOLD}. */
  teleportThreshold?: number;
  /** See {@link DEFAULT_SWAP_MARGIN}. */
  swapMargin?: number;
  /** See {@link DEFAULT_ORIENTATION_FLIP_COS}. */
  orientationFlipCos?: number;
  /**
   * See {@link FLIP_MAX_RUN}. Walk-level only — {@link isLandmarkFlip} ignores
   * it, since the per-frame verdict has no notion of a run.
   */
  maxRun?: number;
}

export interface FlipScanResult {
  /** Frames that passed the gate, in input order. Includes flagged frames. */
  kept: PoseFrame[];
  /** Timestamps of frames discarded as Landmark Flips. */
  flippedTimestamps: number[];
  /**
   * Timestamps of frames that tripped the verdict but were **accepted anyway**
   * because the run cap fired. These are in `kept` and are not discarded — they
   * are reported so the caller can mark them as accepted-under-suspicion without
   * inventing a fifth Detector Attempt status.
   */
  flaggedTimestamps: number[];
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

interface Pt {
  x: number;
  y: number;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Mean position of whichever of `names` are present in the map (null if none). */
function centroidOf(m: Map<string, Keypoint>, names: readonly string[]): Pt | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const name of names) {
    const kp = m.get(name);
    if (kp) {
      sx += kp.x;
      sy += kp.y;
      n += 1;
    }
  }
  return n > 0 ? { x: sx / n, y: sy / n } : null;
}

/**
 * Torso shoulder/hip centroids and the up-vector between them (shoulders − hips).
 * Requires at least one shoulder and one hip; returns null otherwise. Tolerant of
 * a missing side so a half-occluded torso still yields an orientation.
 */
interface TorsoAxis {
  shoulder: Pt;
  hip: Pt;
  upX: number;
  upY: number;
  length: number;
}

function torsoAxis(frame: PoseFrame): TorsoAxis | null {
  const m = new Map(frame.keypoints.map((kp) => [kp.name, kp]));
  const shoulder = centroidOf(m, [LEFT_SHOULDER, RIGHT_SHOULDER]);
  const hip = centroidOf(m, [LEFT_HIP, RIGHT_HIP]);
  if (!shoulder || !hip) return null;
  const upX = shoulder.x - hip.x;
  const upY = shoulder.y - hip.y;
  return { shoulder, hip, upX, upY, length: Math.hypot(upX, upY) };
}

/** Extract the shoulder and hip left/right pairs from a frame (null if incomplete). */
function torsoPairs(frame: PoseFrame): { shoulders: Pair | null; hips: Pair | null } {
  const m = new Map(frame.keypoints.map((kp) => [kp.name, kp]));
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
  const orientationFlipCos = options.orientationFlipCos ?? DEFAULT_ORIENTATION_FLIP_COS;

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

  // --- Left/right swap path: horizontal label glitch. ---
  // Threshold is expressed for the full four-anchor torso; scale to however many
  // anchors were actually available so a shoulders-only frame is judged fairly.
  const scaledTeleport = teleportThreshold * (anchors / 4);
  const lrFlip =
    anchors > 0 && signChanged && noSwap > scaledTeleport && swap < noSwap * swapMargin;

  // --- Orientation path: vertical (upside-down) inversion. ---
  // Independent of the horizontal ordering above: the up-vector (shoulders − hips)
  // reverses by more than the configured angle AND the torso centroids teleport by
  // more than a torso length in a single step. A real inversion turns the axis
  // gradually with the centroids staying put, so it fails the teleport guard and is
  // left alone. The teleport budget is torso-relative (not a frame fraction) so the
  // test fires for a small / distant climber as well as a large one.
  let orientationFlip = false;
  const pa = torsoAxis(prev);
  const ca = torsoAxis(cur);
  if (pa && ca && pa.length > MIN_TORSO_LENGTH && ca.length > MIN_UP_VECTOR_LENGTH) {
    const cos = (pa.upX * ca.upX + pa.upY * ca.upY) / (pa.length * ca.length);
    const teleport = dist(pa.shoulder, ca.shoulder) + dist(pa.hip, ca.hip);
    const torsoScale = Math.max(pa.length, ca.length);
    orientationFlip =
      cos < orientationFlipCos && teleport > torsoScale * ORIENTATION_TELEPORT_TORSO_FACTOR;
  }

  return lrFlip || orientationFlip;
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
 * **Run cap and re-anchor.** Comparing against the last accepted frame is what
 * makes a rejection run self-sustaining: the reference stays where the Climber
 * was before the run started, so every later frame is further from it than the
 * one before. After {@link FLIP_MAX_RUN} consecutive discards the walk therefore
 * accepts the current frame — recording it in `flaggedTimestamps` rather than
 * `flippedTimestamps` — and **re-anchors `prevKept` to it**, so comparison
 * resumes against fresh geometry. The re-anchor is the part that actually ends
 * the run; the cap alone would only convert a discard run into a flag run.
 *
 * A sustained mislabel therefore costs at most `FLIP_MAX_RUN` frames per
 * re-anchor cycle instead of the whole stretch, while a genuine one-or-two-frame
 * glitch is still discarded in full and never reaches the overlay.
 *
 * @param frames  - Sparse detected poses, ascending by timestamp.
 * @param options - Flip-detection thresholds (scale `teleportThreshold` with frameStep).
 * @returns Kept frames, the timestamps discarded as flips (for Adaptive
 *          Refinement), and the timestamps accepted under the run cap.
 */
export function detectFlips(
  frames: PoseFrame[],
  options: FlipDetectionOptions = {},
): FlipScanResult {
  const maxRun = options.maxRun ?? FLIP_MAX_RUN;
  const kept: PoseFrame[] = [];
  const flippedTimestamps: number[] = [];
  const flaggedTimestamps: number[] = [];
  let prevKept: PoseFrame | null = null;
  let run = 0;

  for (const frame of frames) {
    if (prevKept && isLandmarkFlip(prevKept, frame, options)) {
      if (run < maxRun) {
        run += 1;
        flippedTimestamps.push(frame.timestamp);
        continue;
      }
      // Cap reached: a run this long is evidence the reference is stale, not
      // that every pose since is wrong. Accept under suspicion and re-anchor.
      flaggedTimestamps.push(frame.timestamp);
    }
    kept.push(frame);
    prevKept = frame;
    run = 0;
  }

  return { kept, flippedTimestamps, flaggedTimestamps };
}
