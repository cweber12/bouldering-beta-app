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
  type GroundTruthReview,
  type GroundTruthState,
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
 * Seed an auto-accepted Ground Truth from the scaffold poses, one record per
 * Detection Frame: a frame is `present` when a scaffold pose matches its
 * timestamp (core joints seeded from it, with their confidence-seeded `occluded`
 * flags), `absent` when none does. State keys off whether the **scaffold** found
 * a pose, not the detector-under-test's own `status` — a frame MediaPipe missed
 * but the ViTPose scaffold posed is `present` (the Climber is there), so the
 * seed no longer inherits MediaPipe's misses (ADR 0019). Every frame arrives
 * `review: "auto"` (nobody has objected yet) and `verified: false`; the human's
 * job is only to flag exceptions.
 *
 * Carry-forward is keyed on `setupHash`: when prior `existing` truth was seeded
 * from the same Scan Setup, its human *flags* (Wrong / Absent) re-apply onto the
 * fresh seed — joints always come from the new seed, never the old file. When the
 * setup changed, or the prior truth predates hashes, nothing carries and the
 * caller can detect the discard via {@link priorTruthIsStale}. `"auto"` frames
 * carry nothing (the fresh seed already is auto).
 *
 * `detectionFrames` supplies the frame grid + timestamps (established by the
 * MediaPipe pass); `poseFrames` supplies the landmarks (the ViTPose scaffold);
 * `setupHash` is the seed's Scan Setup hash, stamped onto the result.
 */
export function buildGroundTruthScaffold(
  detectionFrames: readonly { timestamp: number; status: string }[],
  poseFrames: readonly { timestamp: number; keypoints: Keypoint[] }[],
  setupHash: string,
  existing: GroundTruthInput | null,
): GroundTruthInput {
  const carryFlags = !priorTruthIsStale(existing, setupHash);
  const priorFlagByIndex = new Map<number, ReviewFlag>();
  if (carryFlags && existing) {
    for (const f of existing.frames) priorFlagByIndex.set(f.frameIndex, reviewToFlag(f.review));
  }

  const frames: GroundTruthFrame[] = detectionFrames.map((df, frameIndex) => {
    const pose = poseAt(poseFrames, df.timestamp);
    const joints = pose ? coreJointsFromKeypoints(pose.keypoints) : {};
    const seedFrame: GroundTruthFrame = {
      frameIndex,
      timestamp: df.timestamp,
      state: Object.keys(joints).length > 0 ? "present" : "absent",
      joints,
      review: "auto",
      verified: false,
    };

    const flag = priorFlagByIndex.get(frameIndex);
    return flag && flag !== "auto" ? applyReviewFlag(seedFrame, flag) : seedFrame;
  });

  return { frames, setupHash };
}

// ---------------------------------------------------------------------------
// Auto-accept review model — the flag-only authoring the reviewer drives.
// ---------------------------------------------------------------------------

/**
 * The three-way review control the author drives per Detection Frame:
 * `"auto"` (unflagged — accept the seed as-is), `"wrong"` (climber present but
 * the seed skeleton is bad), `"absent"` (no climber here). Maps to the persisted
 * {@link GroundTruthReview} provenance values.
 */
export type ReviewFlag = "auto" | "wrong" | "absent";

/** The UI flag a persisted `review` value corresponds to (legacy `"human"` → auto). */
export function reviewToFlag(review: GroundTruthReview): ReviewFlag {
  switch (review) {
    case "human-flagged-wrong":
      return "wrong";
    case "human-flagged-absent":
      return "absent";
    default:
      return "auto";
  }
}

/**
 * Apply the three-way review toggle to a **seeded** frame (the auto-accepted
 * scaffold record). `auto` restores the seed verbatim (state and joints as
 * seeded); `wrong` keeps the climber present with the seed's joints as known-bad
 * (flagging a seeded-absent frame Wrong flips it to present with empty joints);
 * `absent` marks no-climber and clears the joints. `verified` is inherited from
 * the seed — it is stamped `true` for the whole file at save. Pure: pass the
 * seed frame so unflagging back to auto can always recover the original truth.
 */
export function applyReviewFlag(seed: GroundTruthFrame, flag: ReviewFlag): GroundTruthFrame {
  switch (flag) {
    case "wrong":
      return { ...seed, review: "human-flagged-wrong", state: "present", joints: seed.joints };
    case "absent":
      return { ...seed, review: "human-flagged-absent", state: "absent", joints: {} };
    case "auto":
    default:
      return { ...seed, review: "auto" };
  }
}

/**
 * Whether prior saved truth must be discarded rather than carried onto a fresh
 * seed. True when `existing` holds frames but was seeded from a different Scan
 * Setup (`setupHash` mismatch) or predates hashes (either hash empty) — the
 * staleness rule that stops truth authored against different crops from silently
 * pairing with new scans. A clean first authoring (no prior frames) is not stale.
 */
export function priorTruthIsStale(
  existing: GroundTruthInput | null,
  setupHash: string,
): boolean {
  if (!existing || existing.frames.length === 0) return false;
  if (!existing.setupHash || !setupHash) return true;
  return existing.setupHash !== setupHash;
}

/** Seed coverage over the current frames: how many are posed vs. seeded absent. */
export interface SeedCoverage {
  /** Frames whose truth is `present` (a posed climber). */
  posed: number;
  /** Frames whose truth is `absent` (the seed tracked no climber, or flagged absent). */
  seededAbsent: number;
}

/**
 * Count posed vs. absent frames for the accept-button coverage readout — surfaced
 * so the author notices when the seed left much of the video untracked, never
 * blocking. Reflects the current truth, so flipping presence via a flag moves the
 * counts. Legacy `skip` frames count as neither.
 */
export function countSeedCoverage(frames: readonly GroundTruthFrame[]): SeedCoverage {
  let posed = 0;
  let seededAbsent = 0;
  for (const f of frames) {
    if (f.state === "present") posed += 1;
    else if (f.state === "absent") seededAbsent += 1;
  }
  return { posed, seededAbsent };
}

/**
 * The Ground Truth authoring gate. Under the ViTPose hard requirement (ADR 0019)
 * an auto-accepted seed is only trustworthy when it comes from the reference
 * model, never the detector under test — so authoring is `ready` only once
 * ViTPose has landed with at least one posed frame, `pending` while the job runs,
 * and `disabled` (with a reason) on failure or an empty track. Detection Preview
 * and diagnostics stay available regardless; only truth authoring is gated.
 */
export type GroundTruthGate =
  | { authoring: "ready" }
  | { authoring: "pending" }
  | { authoring: "disabled"; reason: string };

export interface SeedGateInput {
  vitposeStatus: "idle" | "requesting" | "polling" | "ready" | "failed";
  vitposeError: string | null;
  /** Whether the landed scaffold posed at least one Detection Frame. */
  seedHasPose: boolean;
}

/** Decide whether Ground Truth authoring is enabled, pending, or disabled. */
export function seedGateDecision({
  vitposeStatus,
  vitposeError,
  seedHasPose,
}: SeedGateInput): GroundTruthGate {
  switch (vitposeStatus) {
    case "ready":
      return seedHasPose
        ? { authoring: "ready" }
        : { authoring: "disabled", reason: "ViTPose tracked no climber." };
    case "failed":
      return { authoring: "disabled", reason: vitposeError ?? "ViTPose scaffold failed." };
    case "requesting":
    case "polling":
    case "idle":
    default:
      return { authoring: "pending" };
  }
}

// ---------------------------------------------------------------------------
// Editor geometry — the drag / translate maths the canvas editor drives.
// ---------------------------------------------------------------------------

/**
 * Add or replace a core joint at an absolute normalised position — used to place
 * a joint the scaffold never detected (missing joint, or a whole absent frame).
 */
export function setJoint(
  joints: Record<string, GroundTruthJoint>,
  name: string,
  x: number,
  y: number,
  occluded = false,
): Record<string, GroundTruthJoint> {
  return { ...joints, [name]: { x: clamp01(x), y: clamp01(y), occluded } };
}

/** Remove a joint — for one placed by accident, or an occluded point to drop. */
export function removeJoint(
  joints: Record<string, GroundTruthJoint>,
  name: string,
): Record<string, GroundTruthJoint> {
  if (!(name in joints)) return joints;
  const out = { ...joints };
  delete out[name];
  return out;
}

/**
 * Flip one joint's `occluded` flag — the human override on the confidence seed.
 * Occluded joints keep their position (so the author can un-occlude later) but
 * are excluded from scoring downstream. A no-op for an unplaced joint.
 */
export function toggleJointOccluded(
  joints: Record<string, GroundTruthJoint>,
  name: string,
): Record<string, GroundTruthJoint> {
  const prev = joints[name];
  if (!prev) return joints;
  return { ...joints, [name]: { ...prev, occluded: !prev.occluded } };
}

/**
 * Apply a per-frame GT state change. `absent` means "no Climber here", so the
 * pose is cleared (a detected pose there is a false positive); `present` and
 * `skip` keep the authored joints. Any state change is a human decision, so it
 * leaves the caller to mark the frame verified.
 */
export function applyFrameState(
  frame: GroundTruthFrame,
  state: GroundTruthState,
): GroundTruthFrame {
  if (state === "absent") return { ...frame, state, joints: {} };
  return { ...frame, state };
}

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
