/**
 * Ground Truth authoring helpers — seed an auto-accepted scaffold from the
 * reference-model poses and apply the flag-only review model. See docs/adr/0018
 * §2 and the calibration flag-review PRD.
 *
 * Framework-agnostic — no React imports. The reviewer component (client) and
 * the tests both build on these.
 */

import {
  CORE_JOINT_NAMES,
  type GroundTruthFrame,
  type GroundTruthInput,
  type GroundTruthJoint,
  type GroundTruthReview,
} from "@/utils/harnessGroundTruth";
import type { Keypoint } from "@/pipeline/pose/poseDetection";
import type { ViTPoseScaffold } from "@/utils/harnessViTPose";
import { scaffoldIsSeedReady } from "@/utils/harnessFreshness";

const CORE_JOINT_NAME_SET = new Set<string>(CORE_JOINT_NAMES);

/** Scaffold joints scored below this seed as occluded (a soft, editable default). */
export const OCCLUSION_SEED_SCORE = 0.5;

/** Two frame timestamps within this many seconds are treated as the same frame. */
const TIMESTAMP_EPSILON = 1e-3;

/**
 * The identity a frame's timestamp carries for matching: milliseconds, rounded.
 * Every Detection Frame timestamp is a 100 ms multiple by construction (the
 * uniform grid), so this collapses float noise without ever merging two grid
 * frames — the 1 ms resolution of {@link TIMESTAMP_EPSILON}, as an exact key.
 */
function timestampKey(timestamp: number): number {
  return Math.round(timestamp / TIMESTAMP_EPSILON);
}

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
 * a pose — no detector under test is involved in seeding truth at all, so the
 * seed can never inherit a detector's misses (ADR 0019). Every frame arrives
 * `review: "auto"` (nobody has objected yet) and `verified: false`; the human's
 * job is only to flag exceptions.
 *
 * Carry-forward is keyed on **timestamp**: a prior frame's human *flags*
 * (Wrong / Absent) re-apply onto whichever fresh grid frame shares its
 * timestamp, however the Scan Setup has changed since — the expensive human
 * review survives every re-calibration, because crops, tap, tier and panning
 * cannot geometrically invalidate truth whose landmarks are full-frame
 * normalised. Grid frames the prior truth never held (a sparse legacy grid
 * densifying onto the 100 ms grid) arrive auto-accepted, and there is no
 * discard path. Joints always come from the new seed, never the old file;
 * `"auto"` frames carry nothing (the fresh seed already is auto).
 *
 * `detectionFrames` supplies the frame grid + timestamps (the uniform 100 ms
 * grid from `buildDetectionGrid`); `poseFrames` supplies the landmarks (the
 * ViTPose scaffold); `setupHash` is the hash of the Scan Setup the scaffold was
 * generated under — the harness pairs runs to truth by exactly this hash
 * (ADR 0020), so it must come from the scaffold actually used, never from
 * whatever setup.json holds at export time.
 */
export function buildGroundTruthScaffold(
  detectionFrames: readonly { timestamp: number }[],
  poseFrames: readonly { timestamp: number; keypoints: Keypoint[] }[],
  setupHash: string,
  existing: GroundTruthInput | null,
): GroundTruthInput {
  const priorFlagByTimestamp = new Map<number, ReviewFlag>();
  for (const f of existing?.frames ?? []) {
    priorFlagByTimestamp.set(timestampKey(f.timestamp), reviewToFlag(f.review));
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

    const flag = priorFlagByTimestamp.get(timestampKey(df.timestamp));
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
 * Whether a video already has accepted Ground Truth — any saved truth holding at
 * least one frame. Accepted truth survives every Scan Setup edit (editing crops /
 * tap / tier / panning skips the ViTPose seed and the review, leaving the truth
 * file untouched until the author asks for a re-seed) — but it only remains
 * valid *evidence* while its stamped `setupHash` matches the current Setup's:
 * the harness pairs runs to truth by that hash (ADR 0020), so a Setup save that
 * changes the hash flips the truth to a surfaced stale state
 * (utils/harnessFreshness) rather than silently reading as healthy.
 */
export function hasAcceptedGroundTruth(existing: GroundTruthInput | null): boolean {
  return !!existing && existing.frames.length > 0;
}

/**
 * How a Detection Frame should read on the review filmstrip. `auto` (an
 * unflagged, posed seed) needs no second look; `seeded-absent` (the seed tracked
 * no climber) and the two human flags each mark a frame worth jumping to. Legacy
 * `skip` frames read as `auto` — the new flow never produces them.
 */
export type FrameReviewMark = "auto" | "seeded-absent" | "flagged-wrong" | "flagged-absent";

/**
 * Classify a Ground Truth frame for the filmstrip: human flags are distinguished
 * by kind (Wrong vs. Absent), an auto frame the seed left untracked reads as
 * `seeded-absent`, and an ordinary auto-accepted pose reads as `auto`.
 */
export function frameReviewMark(frame: GroundTruthFrame): FrameReviewMark {
  switch (frame.review) {
    case "human-flagged-wrong":
      return "flagged-wrong";
    case "human-flagged-absent":
      return "flagged-absent";
    default:
      return frame.state === "absent" ? "seeded-absent" : "auto";
  }
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

/**
 * Which affordance the calibrator's re-seed control offers on a stale-truth
 * bundle. A seed-ready scaffold (stamps the current calibration, poses at
 * least one Detection Frame — utils/harnessFreshness) opens the flag review
 * straight from the on-disk artifact: no job, no waiting, flags carried
 * forward by timestamp exactly as a job-based re-seed. A stale, missing, or
 * poseless scaffold falls back to submitting a ViTPose job as before — a
 * poseless scaffold never invites a review that authoring would refuse.
 */
export type ReseedAffordance = "review-seed" | "run-job";

/** Decide the re-seed affordance from the probed on-disk scaffold. */
export function reseedAffordanceDecision(
  scaffold: ViTPoseScaffold | null | undefined,
  currentSetupHash: string | null | undefined,
): ReseedAffordance {
  return scaffoldIsSeedReady(scaffold, currentSetupHash) ? "review-seed" : "run-job";
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

