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

import type { PoseFrame, Keypoint, PoseFrameSource } from "@/pipeline/pose/poseDetection";
import { MP_KP_NAMES, MP_SKELETON_EDGES, type PoseBackend } from "@/utils/poseConstants";

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

/** Build an adjacency map from a set of skeleton edges and keypoint names. */
function buildAdjacency(
  edges: [number, number][],
  names: Record<number, string>,
): ReadonlyMap<string, readonly string[]> {
  const adj = new Map<string, string[]>();
  for (const [fromIdx, toIdx] of edges) {
    const from = names[fromIdx];
    const to = names[toIdx];
    if (!from || !to) continue;
    if (!adj.has(from)) adj.set(from, []);
    if (!adj.has(to)) adj.set(to, []);
    adj.get(from)!.push(to);
    adj.get(to)!.push(from);
  }
  return adj;
}

/** Build a set of all keypoint names for a given keypoint name record. */
function buildAllNames(names: Record<number, string>): ReadonlySet<string> {
  return new Set(Object.values(names) as string[]);
}

// Precomputed MediaPipe topology values.
const ADJACENCY: ReadonlyMap<string, readonly string[]> = buildAdjacency(
  MP_SKELETON_EDGES,
  MP_KP_NAMES,
);

const ALL_KP_NAMES: ReadonlySet<string> = buildAllNames(MP_KP_NAMES);

function getAdjacency(_backend?: PoseBackend): ReadonlyMap<string, readonly string[]> {
  return ADJACENCY;
}

function getAllKpNames(_backend?: PoseBackend): ReadonlySet<string> {
  return ALL_KP_NAMES;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Weighted climbing-relevant keypoint subset used to judge frame quality.
 *
 * A climber's beta is carried by their hands, shoulders, and hips; the legs and
 * feet are routinely occluded against the wall or by the body, so a missing
 * foot should not, on its own, discard an otherwise-good frame. Core
 * load-bearing joints therefore carry full weight while feet contribute only a
 * small fraction — so both feet can drop out and the frame still survives, but
 * losing the hands/torso/hips quickly pushes a frame over the budget.
 *
 * Names match {@link MP_KP_NAMES} (MediaPipe / BlazePose topology).
 */
export const CLIMBING_KEYPOINT_WEIGHTS: Readonly<Record<string, number>> = {
  // Hands + upper torso + hips — full weight.
  left_wrist: 1,
  right_wrist: 1,
  left_shoulder: 1,
  right_shoulder: 1,
  left_hip: 1,
  right_hip: 1,
  // Feet — low weight; legitimately occluded while climbing.
  left_ankle: 0.25,
  right_ankle: 0.25,
  left_foot_index: 0.25,
  right_foot_index: 0.25,
};

/**
 * Default weighted-bad-keypoint budget for {@link filterLandmarks}.
 *
 * Mirrors the Balanced quality tier. With the weights above, a frame whose
 * feet are fully occluded carries only 4 × 0.25 = 1.0 of "bad" weight and is
 * comfortably kept; a frame missing most of its hands/torso/hips exceeds the
 * budget and is dropped.
 */
export const DEFAULT_FILTER_TOLERANCE = 3;

/**
 * Drop frames whose climbing-relevant keypoints are too degraded.
 *
 * Each keypoint in {@link CLIMBING_KEYPOINT_WEIGHTS} is "bad" if it is absent
 * from the frame or its confidence score is below `minScore`. Bad keypoints
 * accrue their weight; a frame is kept only when the total stays within
 * `tolerance`. Keypoints outside the climbing subset (face, fingers, knees)
 * never affect the verdict.
 *
 * Use this to obtain clean anchor frames before calling
 * {@link interpolatePoseFrames}, preventing poor detections from polluting
 * the interpolated timeline.
 *
 * @param frames    - Input pose frames (may be sparse or dense).
 * @param minScore  - Confidence threshold; keypoints below this count as bad.
 *                    Default: 0.3.
 * @param tolerance - Maximum total weighted "bad" budget before the frame is
 *                    discarded. Looser for the Fast tier, stricter for
 *                    Accurate. Default: {@link DEFAULT_FILTER_TOLERANCE}.
 */
export function filterLandmarks(
  frames: PoseFrame[],
  minScore = 0.3,
  tolerance = DEFAULT_FILTER_TOLERANCE,
): PoseFrame[] {
  return frames.filter((f) => {
    const present = new Map(f.keypoints.map((kp) => [kp.name, kp]));
    let badWeight = 0;
    for (const [name, weight] of Object.entries(CLIMBING_KEYPOINT_WEIGHTS)) {
      const kp = present.get(name);
      if (!kp || kp.score < minScore) badWeight += weight;
    }
    return badWeight <= tolerance;
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Confidence multiplier applied to a keypoint that exists in only ONE of the two
 * anchor frames. The joint is held at the anchor that has it (rather than dropped
 * from the whole segment, which makes connectors flicker), but its score is
 * attenuated so it reads as inferred — and so the renderer can dim it when the
 * hold is long / low-confidence.
 */
const HELD_KEYPOINT_SCORE_FACTOR = 0.5;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function frameSource(frame: PoseFrame, fallback: PoseFrameSource): PoseFrameSource {
  return frame.source ?? fallback;
}

/** Catmull-Rom spline evaluation for a single scalar. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Largest temporal gap (seconds) across which a joint that drops out of the
 * detector will still be bridged by interpolation. Beyond this the absence is
 * treated as a genuine loss of tracking — the joint is omitted (leaving the gap
 * for {@link estimateMissingLandmarks}' structural pass, or the renderer to skip)
 * rather than drawing a long, possibly-wrong straight line through it.
 *
 * Anchor frames sit ~0.5 s apart at the default sampling, so this comfortably
 * bridges a joint occluded across one or two consecutive anchors — the common
 * "hand pressed to the wall" case — without inventing motion over multi-second
 * dropouts.
 */
export const DEFAULT_MAX_BRIDGE_GAP = 1.0;

/** One detection of a single keypoint, tagged with its source anchor index. */
interface KeypointSample {
  /** Index into the source `processedFrames` array. */
  anchorIdx: number;
  /** Anchor timestamp (seconds). */
  t: number;
  x: number;
  y: number;
  score: number;
}

/**
 * Group every detection by keypoint name, preserving anchor order.
 *
 * Each joint gets its own timeline of real detections — anchors where the joint
 * was occluded simply don't appear — so a joint can be interpolated across its
 * OWN trajectory independently of joints that stayed visible. This is what lets
 * a blinked-out wrist track smoothly between its real positions instead of being
 * frozen while the connected elbow keeps moving.
 *
 * The per-name arrays inherit `processedFrames`' ascending-timestamp order.
 */
function buildKeypointTimelines(processedFrames: PoseFrame[]): Map<string, KeypointSample[]> {
  const timelines = new Map<string, KeypointSample[]>();
  processedFrames.forEach((frame, anchorIdx) => {
    for (const kp of frame.keypoints) {
      let series = timelines.get(kp.name);
      if (!series) {
        series = [];
        timelines.set(kp.name, series);
      }
      series.push({ anchorIdx, t: frame.timestamp, x: kp.x, y: kp.y, score: kp.score });
    }
  });
  return timelines;
}

/** Binary search: index of the first sample with timestamp >= target. */
function lowerBoundSample(samples: KeypointSample[], target: number): number {
  let lo = 0,
    hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Sample one keypoint at `timestamp` from its own detection timeline.
 *
 * - Exact hit on a detection → that detection (full score).
 * - Between two detections → Catmull-Rom through the joint's neighbouring
 *   detections (linear at the ends). If those two detections skip one or more
 *   anchors (the joint was occluded between them) the value is *bridged*: it is
 *   still interpolated smoothly, but its score is attenuated so the renderer can
 *   dim it — and the bridge is refused entirely once the gap exceeds
 *   `maxBridgeGap`, leaving the joint absent.
 * - Before the joint's first detection → absent (no backward fill).
 * - After the joint's last detection → held at the last position, attenuated.
 *
 * @returns The sampled keypoint, or `null` when the joint should be absent here.
 */
function sampleKeypoint(
  name: string,
  samples: KeypointSample[],
  timestamp: number,
  maxBridgeGap: number,
): Keypoint | null {
  const n = samples.length;
  const idx = lowerBoundSample(samples, timestamp);

  // After the joint's final detection — hold (attenuated), don't extrapolate.
  if (idx >= n) {
    const last = samples[n - 1];
    return { name, x: last.x, y: last.y, score: last.score * HELD_KEYPOINT_SCORE_FACTOR };
  }

  const b = samples[idx];
  if (b.t === timestamp) {
    return { name, x: b.x, y: b.y, score: b.score };
  }

  // Before the joint's first detection — absent (no backward fill).
  if (idx === 0) return null;

  const a = samples[idx - 1];
  const span = b.t - a.t;
  // A bridge spans skipped anchors where the joint was occluded.
  const bridged = b.anchorIdx - a.anchorIdx > 1;
  if (bridged && span > maxBridgeGap) return null;

  const t = span > 0 ? (timestamp - a.t) / span : 0;

  // Catmull-Rom through this joint's own neighbouring detections for
  // C1-continuous motion; linear at the timeline boundaries.
  const p0 = idx - 2 >= 0 ? samples[idx - 2] : null;
  const p3 = idx + 1 < n ? samples[idx + 1] : null;
  const x = p0 && p3 ? catmullRom(p0.x, a.x, b.x, p3.x, t) : lerp(a.x, b.x, t);
  const y = p0 && p3 ? catmullRom(p0.y, a.y, b.y, p3.y, t) : lerp(a.y, b.y, t);

  const score = bridged
    ? Math.min(a.score, b.score) * HELD_KEYPOINT_SCORE_FACTOR
    : Math.min(a.score, b.score);

  return { name, x, y, score };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produce a dense PoseFrame array from a sparse set of detected frames.
 *
 * Each keypoint is interpolated independently along its own timeline of real
 * detections (see {@link buildKeypointTimelines}), so a joint that the detector
 * loses for an anchor or two tracks smoothly between its real positions instead
 * of freezing while the rest of the body keeps moving — the cause of the
 * "limb stretches then snaps" artefact. Anchors where a joint was occluded are
 * skipped for that joint, not treated as the joint sitting still.
 *
 * Interior detections use Catmull-Rom for C1-continuous motion; the timeline
 * boundaries fall back to linear. A joint absent across more than
 * `maxBridgeGap` seconds is left out rather than bridged with a long straight
 * line. Binary search keeps each sample O(log n).
 *
 * @param processedFrames - Pose frames returned by the detector (one per
 *                          N-th sampled video frame). Must be sorted by
 *                          ascending timestamp.
 * @param allTimestamps   - Timestamps for every sampled video frame (dense).
 *                          The output array is aligned to this sequence.
 * @param maxBridgeGap    - Longest joint dropout (seconds) still bridged by
 *                          interpolation. Default: {@link DEFAULT_MAX_BRIDGE_GAP}.
 * @returns One PoseFrame per entry in `allTimestamps`.
 */
export function interpolatePoseFrames(
  processedFrames: PoseFrame[],
  allTimestamps: number[],
  maxBridgeGap = DEFAULT_MAX_BRIDGE_GAP,
): PoseFrame[] {
  if (processedFrames.length === 0) {
    return allTimestamps.map((timestamp) => ({ timestamp, source: "interpolated", keypoints: [] }));
  }

  const timelines = buildKeypointTimelines(processedFrames);
  const sourceByTimestamp = new Map(
    processedFrames.map((frame) => [frame.timestamp, frameSource(frame, "raw")]),
  );

  return allTimestamps.map((timestamp) => {
    const keypoints: Keypoint[] = [];
    for (const [name, samples] of timelines) {
      const kp = sampleKeypoint(name, samples, timestamp, maxBridgeGap);
      if (kp) keypoints.push(kp);
    }
    return { timestamp, source: sourceByTimestamp.get(timestamp) ?? "interpolated", keypoints };
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
 *  1. Identify which keypoints are absent (based on the active topology).
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
 * @param backend         - Which pose backend produced these frames. Default: "mediapipe".
 */
export function estimateMissingLandmarks(
  frames: PoseFrame[],
  maxTemporalGap = 10,
  maxEstimatable = 5,
  backend?: PoseBackend,
): PoseFrame[] {
  if (frames.length === 0) return frames;

  const adjacency = getAdjacency(backend);
  const allNames = getAllKpNames(backend);

  return frames.map((frame, i) => {
    const existing = new Map(frame.keypoints.map((kp) => [kp.name, kp]));
    const missing: string[] = [];
    for (const name of allNames) {
      if (!existing.has(name)) missing.push(name);
    }
    if (missing.length === 0 || missing.length > maxEstimatable) return frame;

    const estimated: Keypoint[] = [...frame.keypoints];
    let addedAny = false;

    for (const name of missing) {
      // 1. Temporal: nearest prev/next frames that contain the keypoint.
      let prevKp: Keypoint | null = null;
      let prevDist = 0;
      for (let j = i - 1; j >= Math.max(0, i - maxTemporalGap); j--) {
        const kp = frames[j].keypoints.find((k) => k.name === name);
        if (kp) {
          prevKp = kp;
          prevDist = i - j;
          break;
        }
      }

      let nextKp: Keypoint | null = null;
      let nextDist = 0;
      for (let j = i + 1; j <= Math.min(frames.length - 1, i + maxTemporalGap); j++) {
        const kp = frames[j].keypoints.find((k) => k.name === name);
        if (kp) {
          nextKp = kp;
          nextDist = j - i;
          break;
        }
      }

      if (prevKp && nextKp) {
        const t = prevDist / (prevDist + nextDist);
        estimated.push({
          name,
          x: lerp(prevKp.x, nextKp.x, t),
          y: lerp(prevKp.y, nextKp.y, t),
          score: Math.min(prevKp.score, nextKp.score) * 0.8,
        });
        addedAny = true;
        continue;
      }

      // 2. Structural: bone-vector from a connected joint in a nearby frame.
      const neighbors = adjacency.get(name);
      if (neighbors) {
        let found = false;
        for (const neighborName of neighbors) {
          const currentNeighbor = existing.get(neighborName);
          if (!currentNeighbor) continue;
          for (
            let j = Math.max(0, i - maxTemporalGap);
            j <= Math.min(frames.length - 1, i + maxTemporalGap);
            j++
          ) {
            if (j === i) continue;
            const refTarget = frames[j].keypoints.find((k) => k.name === name);
            const refNeighbor = frames[j].keypoints.find((k) => k.name === neighborName);
            if (refTarget && refNeighbor) {
              estimated.push({
                name,
                x: currentNeighbor.x + (refTarget.x - refNeighbor.x),
                y: currentNeighbor.y + (refTarget.y - refNeighbor.y),
                score: currentNeighbor.score * 0.6,
              });
              addedAny = true;
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
        addedAny = true;
      } else if (nextKp && nextDist <= 2) {
        estimated.push({ ...nextKp, name, score: nextKp.score * 0.5 });
        addedAny = true;
      }
    }

    return { ...frame, source: addedAny ? "filled" : frame.source, keypoints: estimated };
  });
}

// ---------------------------------------------------------------------------
// Persistent-gap fill (no-gap guarantee)
// ---------------------------------------------------------------------------

/**
 * Confidence multiplier for a joint reconstructed by {@link fillPersistentGaps}.
 *
 * Kept deliberately below the renderer's Estimated-Landmark dim threshold (0.4)
 * so every gap-filled joint reads as clearly inferred — a faint, dimmed limb
 * rather than a crisp one the detector never actually saw.
 */
export const PERSISTENT_GAP_SCORE_FACTOR = 0.35;

/**
 * Longest dropout (seconds) across which {@link fillPersistentGaps} will bridge a
 * bracketed joint. The no-gap guarantee exists for genuine occlusions — a hand
 * pressed to the wall, a foot tucked behind the body — which last a second or two.
 * A multi-second absence is not an occlusion: the detector has lost the climber
 * entirely (they shrank below the size floor, blended into the wall, left frame).
 * Bridging that draws a full skeleton linearly morphing between the poses on either
 * side of the blackout — the torso visibly squashing and limbs stretching as it
 * interpolates across motion the climber actually made. Past this cap the joint is
 * left absent so the overlay simply shows nothing while tracking is lost, which is
 * honest rather than wrong. Comfortably longer than interpolatePoseFrames' own
 * {@link DEFAULT_MAX_BRIDGE_GAP} so ordinary occlusions are still covered.
 */
export const DEFAULT_PERSISTENT_FILL_MAX_GAP = 2.5;

/** Largest sample index strictly less than `i` in an ascending index array. */
function bracketBefore(idxs: number[], i: number): number | null {
  let lo = 0,
    hi = idxs.length,
    ans: number | null = null;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (idxs[mid] < i) {
      ans = idxs[mid];
      lo = mid + 1;
    } else hi = mid;
  }
  return ans;
}

/** Smallest sample index strictly greater than `i` in an ascending index array. */
function bracketAfter(idxs: number[], i: number): number | null {
  let lo = 0,
    hi = idxs.length,
    ans: number | null = null;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (idxs[mid] > i) {
      ans = idxs[mid];
      hi = mid;
    } else lo = mid + 1;
  }
  return ans;
}

/**
 * Guarantee that no joint **winks out** mid-sequence: any keypoint that the
 * detector saw both *before* and *after* the current frame is always present in
 * that frame, even across a dropout too long for {@link interpolatePoseFrames}
 * to bridge or too degraded for {@link estimateMissingLandmarks} to touch.
 *
 * This is the final safety net in the pose chain. {@link interpolatePoseFrames}
 * deliberately *omits* a joint absent for longer than its bridge gap (to avoid a
 * stretched straight line), and {@link estimateMissingLandmarks} skips frames
 * missing more than a handful of joints (an occluded arm + leg trivially exceeds
 * it) — so an outdoor climber pressed to the wall leaves whole limbs absent for
 * a second or more, which the overlay shows as a flickering glitch. This pass
 * closes those holes:
 *
 *  - **Bracketed only.** A joint is filled only when it has a real detection on
 *    *both* temporal sides. A joint never yet seen, or gone for the rest of the
 *    clip (genuinely off-frame), is left absent — we never invent a limb the
 *    detector had no evidence for.
 *  - **Structural where possible.** When a skeleton neighbour is present in the
 *    current frame and a bracketing reference frame holds both joints, the gap
 *    joint is placed by that frame's bone vector off the *current* neighbour, so
 *    it stays attached to the moving limb instead of sliding a straight line.
 *  - **Temporal otherwise.** With no usable neighbour, the joint is linearly
 *    interpolated between its bracketing detections.
 *  - **Dimmed.** Every filled joint's score is attenuated by
 *    {@link PERSISTENT_GAP_SCORE_FACTOR} below the renderer's dim threshold, so
 *    reconstructed limbs render faint — honest about being inferred.
 *
 * Run after {@link estimateMissingLandmarks} and before {@link smoothPoseFrames}
 * so the filled joints are smoothed with the rest of the pose.
 *
 * @param frames       - Dense PoseFrame array (output of estimateMissingLandmarks).
 * @param backend      - Pose backend, selects the skeleton topology. Default mediapipe.
 * @param maxBridgeGap - Longest dropout (seconds) still filled; beyond it the joint
 *                       is left absent. Default {@link DEFAULT_PERSISTENT_FILL_MAX_GAP}.
 */
export function fillPersistentGaps(
  frames: PoseFrame[],
  backend?: PoseBackend,
  maxBridgeGap = DEFAULT_PERSISTENT_FILL_MAX_GAP,
): PoseFrame[] {
  if (frames.length < 3) return frames;

  const adjacency = getAdjacency(backend);
  const allNames = getAllKpNames(backend);

  // Per-joint ascending list of frame indices where the joint is present.
  const presentIdx = new Map<string, number[]>();
  for (const name of allNames) presentIdx.set(name, []);
  frames.forEach((f, i) => {
    for (const kp of f.keypoints) presentIdx.get(kp.name)?.push(i);
  });

  return frames.map((frame, i) => {
    // Resolve every missing-but-bracketed joint for this frame up front.
    const present = new Map(frame.keypoints.map((kp) => [kp.name, kp]));
    const gaps: { name: string; prevI: number; nextI: number }[] = [];
    for (const name of allNames) {
      if (present.has(name)) continue;
      const idxs = presentIdx.get(name);
      if (!idxs || idxs.length === 0) continue;
      const prevI = bracketBefore(idxs, i);
      const nextI = bracketAfter(idxs, i);
      if (prevI === null || nextI === null) continue; // not bracketed → leave absent
      // Genuine occlusion vs. lost tracking: only bridge across a bounded dropout.
      // A longer absence is a blackout — leave the joint absent so the overlay
      // hides rather than morphing a squashed skeleton across it.
      if (frames[nextI].timestamp - frames[prevI].timestamp > maxBridgeGap) continue;
      gaps.push({ name, prevI, nextI });
    }
    if (gaps.length === 0) return frame;

    const findKp = (idx: number, name: string): Keypoint | undefined =>
      frames[idx].keypoints.find((k) => k.name === name);

    const added: Keypoint[] = [];
    for (const { name, prevI, nextI } of gaps) {
      const prevKp = findKp(prevI, name)!;
      const nextKp = findKp(nextI, name)!;
      const t = (i - prevI) / (nextI - prevI);

      // Structural: keep the joint attached to a still-visible neighbour using a
      // bone vector from whichever bracketing frame holds both. Prefer the
      // temporally nearer reference so the limb pose is the most relevant one.
      let filled: Keypoint | null = null;
      const neighbours = adjacency.get(name);
      if (neighbours) {
        const refOrder = t <= 0.5 ? [prevI, nextI] : [nextI, prevI];
        for (const neighbourName of neighbours) {
          const current = present.get(neighbourName);
          if (!current) continue;
          for (const refI of refOrder) {
            const refJoint = findKp(refI, name);
            const refNeighbour = findKp(refI, neighbourName);
            if (refJoint && refNeighbour) {
              filled = {
                name,
                x: current.x + (refJoint.x - refNeighbour.x),
                y: current.y + (refJoint.y - refNeighbour.y),
                score: Math.min(prevKp.score, nextKp.score) * PERSISTENT_GAP_SCORE_FACTOR,
              };
              break;
            }
          }
          if (filled) break;
        }
      }

      // Temporal fallback — linear across the bracketing detections.
      if (!filled) {
        filled = {
          name,
          x: lerp(prevKp.x, nextKp.x, t),
          y: lerp(prevKp.y, nextKp.y, t),
          score: Math.min(prevKp.score, nextKp.score) * PERSISTENT_GAP_SCORE_FACTOR,
        };
      }
      added.push(filled);
    }

    return { ...frame, source: "filled", keypoints: [...frame.keypoints, ...added] };
  });
}

// ---------------------------------------------------------------------------
// Adaptive smoothing (One-Euro filter)
// ---------------------------------------------------------------------------

/**
 * Run a single directional One-Euro pass over a frame sequence.
 *
 * `timeOf` supplies the monotonic time used for each frame's filter step, so the
 * same pass serves both directions: forward uses `+timestamp`, the reverse pass
 * uses `-timestamp` (over a reversed array) to keep `dt` positive and equal in
 * magnitude. Only keypoints present in a frame are filtered; absent keypoints
 * stay absent and never carry state.
 */
function oneEuroPass(
  frames: PoseFrame[],
  minCutoff: number,
  beta: number,
  timeOf: (f: PoseFrame) => number,
): PoseFrame[] {
  const stateX = new Map<string, OneEuroState>();
  const stateY = new Map<string, OneEuroState>();

  return frames.map((frame) => {
    const t = timeOf(frame);
    const smoothed: Keypoint[] = frame.keypoints.map((kp) => {
      const rx = oneEuroStep(
        kp.x,
        t,
        stateX.get(kp.name) ?? null,
        minCutoff,
        beta,
        ONE_EURO_D_CUTOFF,
      );
      const ry = oneEuroStep(
        kp.y,
        t,
        stateY.get(kp.name) ?? null,
        minCutoff,
        beta,
        ONE_EURO_D_CUTOFF,
      );
      stateX.set(kp.name, rx.state);
      stateY.set(kp.name, ry.state);
      return { ...kp, x: rx.value, y: ry.value };
    });
    return { ...frame, keypoints: smoothed };
  });
}

/**
 * Apply a **zero-phase** adaptive low-pass filter across a dense PoseFrame
 * sequence (forward + backward One-Euro, filtfilt-style).
 *
 * The One-Euro filter adapts its effective cutoff frequency based on the speed
 * of each keypoint: when still, smoothing is heavy (removes jitter); when
 * moving fast, smoothing is light (preserves responsiveness). A single forward
 * pass is *causal* — it inherently lags the true motion, and can't undo a spike
 * it has already emitted. Because the Scan is an offline batch (the full
 * sequence is known), we run the filter forward, then backward over the result.
 * The two passes cancel each other's phase lag, so the overlay tracks the real
 * motion with no directional delay while jitter is suppressed twice as hard.
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

  // Forward pass (causal): smooths but lags.
  const forward = oneEuroPass(frames, minCutoff, beta, (f) => f.timestamp);

  // Backward pass over the forward result cancels the forward lag (zero phase).
  // Negate the timestamp so time still increases as we walk the reversed array.
  const back = oneEuroPass([...forward].reverse(), minCutoff, beta, (f) => -f.timestamp);
  back.reverse();
  return back;
}

// ---------------------------------------------------------------------------
// Rigid-body bone constraint (bone-space reconstruction)
// ---------------------------------------------------------------------------

/**
 * Skeleton bones as [parent, child] name pairs, ordered **proximal → distal**.
 *
 * The order is load-bearing: {@link constrainSkeleton} walks it in sequence and
 * mutates joints as it goes, so a child is always reconstructed off an
 * already-corrected parent (shoulder→elbow before elbow→wrist before
 * wrist→hand). Only the limb + extremity chains are listed — the torso quad and
 * the head are anchors / drawn separately, and the finger↔finger and heel↔toe
 * web edges are cross-links, not tree bones, so they are omitted.
 *
 * MediaPipe / BlazePose topology (see {@link MP_KP_NAMES}).
 */
const BONE_TREE: readonly (readonly [string, string])[] = [
  // Upper arms.
  ["left_shoulder", "left_elbow"],
  ["right_shoulder", "right_elbow"],
  // Forearms.
  ["left_elbow", "left_wrist"],
  ["right_elbow", "right_wrist"],
  // Hands (off the wrist).
  ["left_wrist", "left_thumb"],
  ["left_wrist", "left_index"],
  ["left_wrist", "left_pinky"],
  ["right_wrist", "right_thumb"],
  ["right_wrist", "right_index"],
  ["right_wrist", "right_pinky"],
  // Thighs.
  ["left_hip", "left_knee"],
  ["right_hip", "right_knee"],
  // Shins.
  ["left_knee", "left_ankle"],
  ["right_knee", "right_ankle"],
  // Feet (off the ankle).
  ["left_ankle", "left_heel"],
  ["left_ankle", "left_foot_index"],
  ["right_ankle", "right_heel"],
  ["right_ankle", "right_foot_index"],
];

/** One real detection of a bone: its world angle and projected length. */
interface BoneSample {
  t: number;
  /** atan2(child − parent) in the image plane (radians). */
  angle: number;
  /** |child − parent| — the projected bone length (honours foreshortening). */
  len: number;
}

/** Shortest signed angular delta from `a` to `b`, wrapped to (−π, π]. */
function shortestArc(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Interpolate a bone's {angle, len} at `t` from its own real-detection timeline.
 *
 * The angle follows the **shortest arc** between the bracketing detections (so a
 * rotating limb sweeps its true arc instead of being copied stale), and the
 * length is linear (so a limb that legitimately foreshortens between two anchors
 * shrinks smoothly rather than being pinned to a fixed length). Before the first
 * / after the last detection the nearest sample is held. Returns null only when
 * the bone was never detected.
 */
function sampleBone(samples: BoneSample[], t: number): { angle: number; len: number } | null {
  const n = samples.length;
  if (n === 0) return null;
  if (t <= samples[0].t) return { angle: samples[0].angle, len: samples[0].len };
  if (t >= samples[n - 1].t) return { angle: samples[n - 1].angle, len: samples[n - 1].len };

  // Binary search for the first sample with t' >= t.
  let lo = 0,
    hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const b = samples[lo];
  if (b.t === t) return { angle: b.angle, len: b.len };
  const a = samples[lo - 1];
  const frac = (t - a.t) / (b.t - a.t);
  return {
    angle: a.angle + shortestArc(a.angle, b.angle) * frac,
    len: a.len + (b.len - a.len) * frac,
  };
}

/**
 * Enforce rigid-body bone geometry across a dense pose sequence — the final
 * stage of the pose chain, run **after** {@link smoothPoseFrames}.
 *
 * The interpolation / estimation / smoothing passes above each move a joint's
 * x and y **independently of its skeletal parent**, so a rotating limb's child
 * joint is carried along the *chord* of its arc (the bone foreshortens then
 * snaps back — the "limb stretches" artefact) and an occluded joint is placed by
 * a bone vector copied verbatim from one bracketing frame (the "joint bends the
 * wrong way" artefact). This pass removes both by reconstructing each child joint
 * in **bone space**: its position is recomputed as `parent + polar(angle, len)`,
 * where `angle` and `len` are interpolated between the bone's own **real
 * detections** (`referenceFrames`) via {@link sampleBone}.
 *
 * Because the references are the true detections, the bone's *projected* length
 * at each anchor — including legitimate foreshortening when the limb points
 * toward the camera — is preserved and merely interpolated between anchors, so
 * this does **not** flatten out-of-plane motion the way a fixed median length
 * would. Walking {@link BONE_TREE} proximal→distal means each child is rebuilt
 * off an already-corrected parent, propagating the fix down the limb.
 *
 * Conservative by construction:
 *  - **Only present joints move.** A joint the earlier passes deliberately left
 *    absent (dropout past the bridge/fill cap, before its first detection) stays
 *    absent — this never invents a limb.
 *  - **Parents must be present.** A child whose parent is missing this frame is
 *    left untouched (nothing to anchor to).
 *  - **Torso and head are untouched.** Only the limb + extremity chains in
 *    {@link BONE_TREE} are constrained; shoulders/hips are the anchors and the
 *    head is drawn separately.
 *  - **Scores are preserved**, so the renderer's Estimated-Landmark dimming still
 *    reflects how a joint was obtained.
 *
 * @param frames          - Dense PoseFrame array (output of smoothPoseFrames).
 * @param referenceFrames - The sparse real detections (the filtered anchor
 *                          frames fed to interpolation), ascending by timestamp.
 * @param backend         - Pose backend; selects the topology. Default mediapipe.
 */
export function constrainSkeleton(
  frames: PoseFrame[],
  referenceFrames: PoseFrame[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  backend?: PoseBackend,
): PoseFrame[] {
  if (frames.length === 0) return frames;

  // Per-bone timeline of real detections (angle + projected length), from the
  // reference detections only — never the interpolated/estimated dense frames.
  const boneSamples: BoneSample[][] = BONE_TREE.map(([parent, child]) => {
    const samples: BoneSample[] = [];
    for (const rf of referenceFrames) {
      const p = rf.keypoints.find((k) => k.name === parent);
      const c = rf.keypoints.find((k) => k.name === child);
      if (!p || !c) continue;
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      samples.push({ t: rf.timestamp, angle: Math.atan2(dy, dx), len: Math.hypot(dx, dy) });
    }
    // referenceFrames are ascending, so samples inherit ascending order.
    return samples;
  });

  return frames.map((frame) => {
    // Mutable working map so tree propagation sees corrected parents downstream.
    const kp = new Map(frame.keypoints.map((k) => [k.name, { ...k }]));

    for (let bi = 0; bi < BONE_TREE.length; bi++) {
      const [parentName, childName] = BONE_TREE[bi];
      const child = kp.get(childName);
      if (!child) continue; // absent by design — do not invent it
      const parent = kp.get(parentName);
      if (!parent) continue; // no anchor this frame — leave the child as-is

      const bone = sampleBone(boneSamples[bi], frame.timestamp);
      if (!bone) continue; // bone never detected — nothing to constrain against

      child.x = parent.x + Math.cos(bone.angle) * bone.len;
      child.y = parent.y + Math.sin(bone.angle) * bone.len;
    }

    return { ...frame, keypoints: [...kp.values()] };
  });
}
