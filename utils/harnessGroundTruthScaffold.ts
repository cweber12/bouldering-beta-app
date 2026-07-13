/**
 * Ground Truth authoring helpers — seed a throwaway scaffold from the scan's
 * scaffold detection, and the pure geometry the landmark-correction editor drives
 * (translate a whole pose, measure per-joint drift from the scaffold). See
 * docs/adr/0018 §2 and issue 04.
 *
 * Framework-agnostic — no React imports. The editor component (client) and the
 * tests both build on these; keeping them here makes the drag/translate maths
 * unit-testable without a canvas.
 */

import {
  CORE_JOINT_NAMES,
  type GroundTruthFrame,
  type GroundTruthInput,
  type GroundTruthJoint,
} from "@/utils/harnessGroundTruth";
import type { Keypoint } from "@/pipeline/pose/poseDetection";

const CORE_JOINT_NAME_SET = new Set<string>(CORE_JOINT_NAMES);

/** Scaffold joints scored below this seed as occluded (a soft, editable default). */
export const OCCLUSION_SEED_SCORE = 0.5;

/** Two frame timestamps within this many seconds are treated as the same frame. */
const TIMESTAMP_EPSILON = 1e-3;

/** Clamp to the normalised [0, 1] range a joint position must stay within. */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * The core body joints of a scaffold pose, keyed by name and video-normalised,
 * with `occluded` pre-seeded from the model's confidence. Non-core (face / hand /
 * foot-tip) points are dropped — they are context-only, never scored.
 */
export function coreJointsFromKeypoints(keypoints: Keypoint[]): Record<string, GroundTruthJoint> {
  const out: Record<string, GroundTruthJoint> = {};
  for (const kp of keypoints) {
    if (!CORE_JOINT_NAME_SET.has(kp.name)) continue;
    out[kp.name] = { x: clamp01(kp.x), y: clamp01(kp.y), occluded: kp.score < OCCLUSION_SEED_SCORE };
  }
  return out;
}

/** All of a pose's keypoints as a name → position lookup, for faint context drawing. */
export function keypointsToPositions(keypoints: Keypoint[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const kp of keypoints) out[kp.name] = { x: kp.x, y: kp.y };
  return out;
}

/** Find the scaffold pose whose timestamp matches `t` (nearest within epsilon). */
function poseAt(
  poseFrames: readonly { timestamp: number; keypoints: Keypoint[] }[],
  t: number,
): { timestamp: number; keypoints: Keypoint[] } | null {
  let best: { timestamp: number; keypoints: Keypoint[] } | null = null;
  let bestDelta = TIMESTAMP_EPSILON;
  for (const f of poseFrames) {
    const delta = Math.abs(f.timestamp - t);
    if (delta <= bestDelta) {
      bestDelta = delta;
      best = f;
    }
  }
  return best;
}

/** The scaffold context keypoints (all points, normalised) for a Detection Frame. */
export function contextKeypointsAt(
  poseFrames: readonly { timestamp: number; keypoints: Keypoint[] }[],
  timestamp: number,
): Record<string, { x: number; y: number }> {
  const pose = poseAt(poseFrames, timestamp);
  return pose ? keypointsToPositions(pose.keypoints) : {};
}

/**
 * Seed a Ground Truth from the scan's scaffold, one record per Detection Frame:
 * a `missing` frame (or one with no matching pose) is `absent`; every other frame
 * is `present`, its core joints seeded from the scaffold detection. Any frame the
 * human already authored in `existing` (matched by `frameIndex`) is preserved
 * verbatim — re-scanning never clobbers verified corrections.
 */
export function buildGroundTruthScaffold(
  detectionFrames: readonly { timestamp: number; status: string }[],
  poseFrames: readonly { timestamp: number; keypoints: Keypoint[] }[],
  existing: GroundTruthInput | null,
): GroundTruthInput {
  const priorByIndex = new Map<number, GroundTruthFrame>();
  for (const f of existing?.frames ?? []) priorByIndex.set(f.frameIndex, f);

  const frames: GroundTruthFrame[] = detectionFrames.map((df, frameIndex) => {
    const prior = priorByIndex.get(frameIndex);
    if (prior) return prior;

    const pose = df.status === "missing" ? null : poseAt(poseFrames, df.timestamp);
    const joints = pose ? coreJointsFromKeypoints(pose.keypoints) : {};
    return {
      frameIndex,
      timestamp: df.timestamp,
      state: pose && Object.keys(joints).length > 0 ? "present" : "absent",
      joints,
      verified: false,
    };
  });

  return { frames };
}

// ---------------------------------------------------------------------------
// Editor geometry — the drag / translate maths the canvas editor drives.
// ---------------------------------------------------------------------------

/** Move one joint to an absolute normalised position (clamped to the frame). */
export function moveJoint(
  joints: Record<string, GroundTruthJoint>,
  name: string,
  x: number,
  y: number,
): Record<string, GroundTruthJoint> {
  const prev = joints[name];
  if (!prev) return joints;
  return { ...joints, [name]: { ...prev, x: clamp01(x), y: clamp01(y) } };
}

/**
 * Translate every joint by (dx, dy) in normalised space — used when the pose
 * shape is right but the whole skeleton is offset. Positions clamp to the frame.
 */
export function translateJoints(
  joints: Record<string, GroundTruthJoint>,
  dx: number,
  dy: number,
): Record<string, GroundTruthJoint> {
  const out: Record<string, GroundTruthJoint> = {};
  for (const name of Object.keys(joints)) {
    const j = joints[name];
    out[name] = { ...j, x: clamp01(j.x + dx), y: clamp01(j.y + dy) };
  }
  return out;
}

export interface DriftReadout {
  /** Largest single-joint move from the scaffold, normalised [0, 1]. */
  maxDist: number;
  /** Mean move across joints present in both, normalised [0, 1]. */
  meanDist: number;
  /** How many joints moved a visible amount from the scaffold. */
  movedJoints: number;
}

/** A joint that moved less than this (normalised) counts as untouched. */
const DRIFT_EPSILON = 1e-4;

/**
 * How far the current joints have moved from their scaffold seed — the live
 * authoring readout (not a score). Compares joints present in both sets.
 */
export function jointDrift(
  seed: Record<string, GroundTruthJoint>,
  current: Record<string, GroundTruthJoint>,
): DriftReadout {
  let maxDist = 0;
  let total = 0;
  let count = 0;
  let moved = 0;
  for (const name of Object.keys(current)) {
    const s = seed[name];
    if (!s) continue;
    const c = current[name];
    const dist = Math.hypot(c.x - s.x, c.y - s.y);
    if (dist > maxDist) maxDist = dist;
    if (dist > DRIFT_EPSILON) moved += 1;
    total += dist;
    count += 1;
  }
  return { maxDist, meanDist: count > 0 ? total / count : 0, movedJoints: moved };
}
