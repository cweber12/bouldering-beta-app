/**
 * Scoring a detection run against a Test Video's Ground Truth (ADR 0018 §2,
 * amended by the calibration-analyze-split PRD): the probed-frame domain.
 *
 * The scoring domain is the set-intersection of the Ground Truth grid and the
 * timestamps the run actually probed (matched within {@link
 * PROBE_MATCH_TOLERANCE_MS}). A sparse-stride run over a dense grid is scored
 * only on the frames it visited — it is never charged `missing` for grid frames
 * it was never scheduled to probe. Run probes that pair with no Ground Truth
 * frame should not exist (every probe is an i × 100 ms multiple, see
 * harnessDetectionGrid.ts) and are ignored with a count when encountered.
 *
 * Per probed present frame the verdict ladder resolves in fixed precedence —
 * `missing > unscored > extreme > wrong > drift > good` — keyed off the max
 * displacement over non-occluded core joints, normalized by the frame's GT body
 * scale so thresholds are resolution- and scale-free. Probed absent frames
 * score `wrong` when the run detected a pose there and `good` when it did not,
 * counted separately in the rollup (`absentViolation` / `absentOk`). Skip
 * frames and occluded joints are excluded everywhere.
 *
 * Unverified frames are scored identically to verified ones; the rollup splits
 * the two so trust policy stays downstream (trend analysis), never in here.
 *
 * Framework-agnostic — no React imports, no async, no DOM.
 */

import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import type { GroundTruthFrame } from "@/utils/harnessGroundTruth";

// ---------------------------------------------------------------------------
// Thresholds — named starter constants (issue-08 grilled design), to be tuned
// against the corpus drift histogram once real scored runs accumulate.
// ---------------------------------------------------------------------------

/** Max-joint drift (torso-diag units) below which a frame is `good`. */
export const DRIFT_MIN = 0.08;

/** Max-joint drift (torso-diag units) at or above which a frame is `wrong`. */
export const WRONG_MAX = 0.35;

/**
 * Joint-coverage floor: `returnedCoreJoints / nonOccludedGtCoreJoints`. Below
 * it the frame is `missing` regardless of how the returned joints scored — a
 * mostly-absent skeleton is a miss, not a pose.
 */
export const MIN_JOINT_COVERAGE = 0.6;

/**
 * Relative bone-length deviation (|run − gt| / gt) beyond which a pose is
 * anatomically implausible (`extreme`). The rigid-body constraint pass (ADR
 * 0015) holds real bones far inside this band, so crossing it means the
 * skeleton is broken, not merely displaced.
 */
export const BONE_LENGTH_TOLERANCE = 0.5;

/**
 * Tolerance (ms) for pairing a run probe with a Ground Truth frame. Probes and
 * grid timestamps come from the same i × 100 ms arithmetic, so a genuine pair
 * is exact up to float noise; a millisecond never reaches a neighbouring frame.
 */
export const PROBE_MATCH_TOLERANCE_MS = 1;

/**
 * Torso segments whose mean length is the frame's body scale: shoulder width,
 * hip width, and the two shoulder↔hip sides. A segment is resolvable when both
 * ends are authored and non-occluded; the mean over whatever subset resolves
 * degrades gracefully when a torso joint is occluded.
 */
const TORSO_SEGMENTS: readonly (readonly [string, string])[] = [
  ["left_shoulder", "right_shoulder"],
  ["left_hip", "right_hip"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
];

/**
 * The core-joint bones checked for the `extreme` verdict — the limb chains the
 * ADR 0015 constraint tree covers, restricted to the authored core-joint set
 * (no hands/feet extremities). Torso segments are the scale itself and the
 * head anchor has no bone, so neither appears here.
 */
const CORE_BONES: readonly (readonly [string, string])[] = [
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

/** A bone shorter than this (normalized units) cannot carry a length ratio. */
const MIN_BONE_LENGTH = 1e-6;

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** One frame's verdict. On absent frames only `wrong` / `good` occur. */
export type DetectionErrorKind =
  | "good"
  | "drift"
  | "wrong"
  | "extreme"
  | "missing"
  | "unscored";

/**
 * Why a frame carries no drift verdict. `no-body-scale` — fewer than one
 * resolvable torso segment. `flagged-wrong-joints` — the frame is
 * `human-flagged-wrong`: its joints are kept as known-bad presence truth (ADR
 * 0018 §1) and must never be drift-scored against.
 */
export type UnscoredReason = "no-body-scale" | "flagged-wrong-joints";

/** One Detection Error row — one per scored (probed, non-skip) frame. */
export interface DetectionErrorRow {
  frameIndex: number;
  /** Ground Truth timestamp (seconds) the probe paired with. */
  timestamp: number;
  state: "present" | "absent";
  kind: DetectionErrorKind;
  /** "Nobody objected" — rides on every row; trust policy lives downstream. */
  verified: boolean;
  /** Set only when `kind === "unscored"`. */
  unscoredReason?: UnscoredReason;
  /** GT body scale (normalized units), null when unresolvable / not needed. */
  bodyScale: number | null;
  /** Mean drift over the scored joints, in body-scale units. */
  driftAvg: number | null;
  /** Max drift over the scored joints — the value the ladder keys off. */
  driftMax: number | null;
  /** Joint name carrying `driftMax`. */
  worstJoint: string | null;
  /** Normalized displacement per scored (non-occluded, returned) core joint. */
  jointDrift: Record<string, number>;
}

/** Verdict counts for one rollup set. */
export interface VerdictCounts {
  good: number;
  drift: number;
  wrong: number;
  extreme: number;
  missing: number;
  unscored: number;
  absentOk: number;
  absentViolation: number;
}

/** Aggregate of per-frame `driftMax` over `good` + `drift` frames only. */
export interface DriftStats {
  min: number;
  avg: number;
  max: number;
}

/** One half of the verified / unverified rollup split. */
export interface ScoringRollupSet {
  counts: VerdictCounts;
  /**
   * Drift aggregated only over `good` + `drift` frames — the right-ish poses.
   * `wrong` / `extreme` are counted, not averaged. Null when no frame in the
   * set carries a drift verdict.
   */
  drift: DriftStats | null;
}

/** The per-run rollup. */
export interface ScoringRollup {
  verified: ScoringRollupSet;
  unverified: ScoringRollupSet;
  /** Present GT frames, probed or not. */
  totalPresent: number;
  /** Present GT frames the run probed — the scoring domain. */
  probedPresent: number;
  /** probedPresent / totalPresent; null when the truth has no present frame. */
  probeCoverage: number | null;
  /** Verified share of the probed present frames; null when none probed. */
  verifiedCoverage: number | null;
  /**
   * Probed present frames on which the run holds a pose, over probedPresent —
   * the denominator matches the frames the run could possibly have detected.
   */
  detectionRateVsGT: number | null;
  /** Run probes that paired with no GT frame — ignored, counted (see header). */
  offGridRunFrames: number;
}

/** The scoring block folded into the posted `pose` payload. */
export interface DetectionScoring {
  /** The exact Ground Truth version this run was measured against. */
  groundTruthHash: string;
  rows: DetectionErrorRow[];
  rollup: ScoringRollup;
}

/** The run evidence scoring consumes. */
export interface DetectionRunInput {
  /**
   * Every timestamp the run probed, whatever came of it — the base-stride
   * timeline including missing / flip-discarded probes. Accepted pose frames
   * (Adaptive Refinement re-probes included) are unioned in from `frames`, so
   * passing only the base timeline here is fine.
   */
  probes: readonly { timestamp: number }[];
  /** The accepted pose frames — the ones the posted payload carries. */
  frames: readonly PoseFrame[];
}

/** Frames that represent detector evidence, not scanner-inferred continuity. */
export function detectorEvidenceFrames(frames: readonly PoseFrame[]): PoseFrame[] {
  return frames.filter(
    (frame) => frame.source === undefined || frame.source === "raw" || frame.source === "limbExpanded",
  );
}

// ---------------------------------------------------------------------------
// Timestamp pairing
// ---------------------------------------------------------------------------

/** Key a timestamp (seconds) to its nearest millisecond bucket. */
function msKey(timestampSec: number): number {
  return Math.round(timestampSec * 1000);
}

/** Float slack on top of the 1 ms tolerance so an exact-boundary pair holds. */
const MATCH_EPSILON_MS = 1e-6;

/**
 * Find the entry whose timestamp is within {@link PROBE_MATCH_TOLERANCE_MS} of
 * `timestampSec`, via an ms-bucketed index (neighbouring buckets included so a
 * pair straddling a rounding boundary still matches).
 */
function findByTimestamp<T extends { timestamp: number }>(
  index: Map<number, T>,
  timestampSec: number,
): T | null {
  const key = msKey(timestampSec);
  const ms = timestampSec * 1000;
  for (const k of [key, key - 1, key + 1]) {
    const candidate = index.get(k);
    if (
      candidate &&
      Math.abs(candidate.timestamp * 1000 - ms) <= PROBE_MATCH_TOLERANCE_MS + MATCH_EPSILON_MS
    ) {
      return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-frame scoring
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The frame's body scale: mean length of the resolvable torso segments (both
 * ends authored + non-occluded). Null when fewer than one segment resolves.
 */
export function computeBodyScale(frame: GroundTruthFrame): number | null {
  const lengths: number[] = [];
  for (const [a, b] of TORSO_SEGMENTS) {
    const ja = frame.joints[a];
    const jb = frame.joints[b];
    if (!ja || !jb || ja.occluded || jb.occluded) continue;
    lengths.push(dist(ja, jb));
  }
  if (lengths.length === 0) return null;
  return lengths.reduce((s, l) => s + l, 0) / lengths.length;
}

function scorePresentFrame(gt: GroundTruthFrame, pose: PoseFrame | null): DetectionErrorRow {
  const base = {
    frameIndex: gt.frameIndex,
    timestamp: gt.timestamp,
    state: "present" as const,
    verified: gt.verified,
    bodyScale: null,
    driftAvg: null,
    driftMax: null,
    worstJoint: null,
    jointDrift: {},
  };

  const runJoints = new Map<string, Point>();
  for (const kp of pose?.keypoints ?? []) runJoints.set(kp.name, kp);

  // missing — the probe returned no pose at all.
  if (runJoints.size === 0) return { ...base, kind: "missing" };

  // Flagged-wrong joints are presence truth only (ADR 0018 §1): the run's pose
  // exists, but there is nothing valid to measure drift against.
  if (gt.review === "human-flagged-wrong") {
    return { ...base, kind: "unscored", unscoredReason: "flagged-wrong-joints" };
  }

  // Non-occluded authored joints are the reference set for every joint metric.
  const gtJoints: Array<[string, Point]> = [];
  for (const [name, joint] of Object.entries(gt.joints)) {
    if (!joint.occluded) gtJoints.push([name, joint]);
  }

  // missing — a partial pose below the coverage floor is a miss, not a pose.
  if (gtJoints.length > 0) {
    const returned = gtJoints.filter(([name]) => runJoints.has(name)).length;
    if (returned / gtJoints.length < MIN_JOINT_COVERAGE) {
      return { ...base, kind: "missing" };
    }
  }

  // unscored — a GT torso too degraded to yield a body scale carries no drift
  // verdict but still counts toward coverage denominators.
  const bodyScale = computeBodyScale(gt);
  if (bodyScale === null || bodyScale < MIN_BONE_LENGTH) {
    return { ...base, kind: "unscored", unscoredReason: "no-body-scale" };
  }

  const jointDrift: Record<string, number> = {};
  let driftSum = 0;
  let driftMax = -Infinity;
  let worstJoint: string | null = null;
  for (const [name, gtJoint] of gtJoints) {
    const runJoint = runJoints.get(name);
    if (!runJoint) continue;
    const d = dist(gtJoint, runJoint) / bodyScale;
    jointDrift[name] = d;
    driftSum += d;
    if (d > driftMax) {
      driftMax = d;
      worstJoint = name;
    }
  }
  const scoredCount = Object.keys(jointDrift).length;
  if (scoredCount === 0) {
    // Coverage passed only because the GT frame authored no joints — nothing
    // to measure against, same outcome as an unresolvable torso.
    return { ...base, kind: "unscored", unscoredReason: "no-body-scale" };
  }

  const scored = {
    ...base,
    bodyScale,
    driftAvg: driftSum / scoredCount,
    driftMax,
    worstJoint,
    jointDrift,
  };

  // extreme — an anatomically implausible pose: any core bone whose projected
  // length deviates from the GT bone beyond tolerance (ADR 0015).
  for (const [a, b] of CORE_BONES) {
    const gtA = gt.joints[a];
    const gtB = gt.joints[b];
    if (!gtA || !gtB || gtA.occluded || gtB.occluded) continue;
    const runA = runJoints.get(a);
    const runB = runJoints.get(b);
    if (!runA || !runB) continue;
    const gtLen = dist(gtA, gtB);
    if (gtLen < MIN_BONE_LENGTH) continue;
    if (Math.abs(dist(runA, runB) - gtLen) / gtLen > BONE_LENGTH_TOLERANCE) {
      return { ...scored, kind: "extreme" };
    }
  }

  if (driftMax >= WRONG_MAX) return { ...scored, kind: "wrong" };
  if (driftMax >= DRIFT_MIN) return { ...scored, kind: "drift" };
  return { ...scored, kind: "good" };
}

function scoreAbsentFrame(gt: GroundTruthFrame, pose: PoseFrame | null): DetectionErrorRow {
  const hasPose = (pose?.keypoints.length ?? 0) > 0;
  return {
    frameIndex: gt.frameIndex,
    timestamp: gt.timestamp,
    state: "absent",
    // A pose over an absent frame is a violation (`wrong`); silence is `good`.
    // The rollup counts these under absentViolation / absentOk, never in the
    // present-frame buckets.
    kind: hasPose ? "wrong" : "good",
    verified: gt.verified,
    bodyScale: null,
    driftAvg: null,
    driftMax: null,
    worstJoint: null,
    jointDrift: {},
  };
}

// ---------------------------------------------------------------------------
// Rollup
// ---------------------------------------------------------------------------

function emptyCounts(): VerdictCounts {
  return {
    good: 0,
    drift: 0,
    wrong: 0,
    extreme: 0,
    missing: 0,
    unscored: 0,
    absentOk: 0,
    absentViolation: 0,
  };
}

function countRow(counts: VerdictCounts, row: DetectionErrorRow): void {
  if (row.state === "absent") {
    if (row.kind === "wrong") counts.absentViolation += 1;
    else counts.absentOk += 1;
    return;
  }
  counts[row.kind] += 1;
}

function buildRollupSet(rows: readonly DetectionErrorRow[]): ScoringRollupSet {
  const counts = emptyCounts();
  const driftValues: number[] = [];
  for (const row of rows) {
    countRow(counts, row);
    if (
      row.state === "present" &&
      (row.kind === "good" || row.kind === "drift") &&
      row.driftMax !== null
    ) {
      driftValues.push(row.driftMax);
    }
  }
  const drift =
    driftValues.length > 0
      ? {
          min: Math.min(...driftValues),
          avg: driftValues.reduce((s, v) => s + v, 0) / driftValues.length,
          max: Math.max(...driftValues),
        }
      : null;
  return { counts, drift };
}

// ---------------------------------------------------------------------------
// The scoring pass
// ---------------------------------------------------------------------------

/**
 * Score one detection run against the video's Ground Truth over the probed
 * frames, per the module header. Pure and synchronous; the caller stamps the
 * result into the posted payload.
 */
export function scoreRunAgainstGroundTruth(args: {
  groundTruth: { frames: readonly GroundTruthFrame[]; groundTruthHash: string };
  run: DetectionRunInput;
}): DetectionScoring {
  const { groundTruth, run } = args;

  // The probed set: base-timeline probes ∪ accepted frames (refinement
  // re-probes appear only in the latter), de-duplicated by ms bucket.
  const probeIndex = new Map<number, { timestamp: number }>();
  for (const probe of run.probes) {
    const key = msKey(probe.timestamp);
    if (!probeIndex.has(key)) probeIndex.set(key, probe);
  }
  for (const frame of run.frames) {
    const key = msKey(frame.timestamp);
    if (!probeIndex.has(key)) probeIndex.set(key, frame);
  }

  // Accepted poses by ms bucket, for pairing a scored frame to its run pose.
  const poseIndex = new Map<number, PoseFrame>();
  for (const frame of run.frames) {
    const key = msKey(frame.timestamp);
    if (!poseIndex.has(key)) poseIndex.set(key, frame);
  }

  const rows: DetectionErrorRow[] = [];
  let totalPresent = 0;
  let probedPresent = 0;
  let probedPresentDetected = 0;
  let probedPresentVerified = 0;
  const matchedProbeKeys = new Set<number>();

  const gtFrames = [...groundTruth.frames].sort((a, b) => a.frameIndex - b.frameIndex);
  for (const gt of gtFrames) {
    const probe = findByTimestamp(probeIndex, gt.timestamp);
    if (probe) matchedProbeKeys.add(msKey(probe.timestamp));

    // Skip frames are excluded from scoring and every denominator; the probe
    // still pairs (it is on the grid), it just produces nothing.
    if (gt.state === "skip") continue;

    if (gt.state === "present") totalPresent += 1;
    if (!probe) continue; // unprobed — outside the scoring domain, never missing

    const pose = findByTimestamp(poseIndex, gt.timestamp);
    if (gt.state === "present") {
      probedPresent += 1;
      if (gt.verified) probedPresentVerified += 1;
      if ((pose?.keypoints.length ?? 0) > 0) probedPresentDetected += 1;
      rows.push(scorePresentFrame(gt, pose));
    } else {
      rows.push(scoreAbsentFrame(gt, pose));
    }
  }

  // Probes that paired with no GT frame should not exist (alignment by
  // arithmetic); under a sparse legacy grid they are the unprobed complement.
  // Either way: ignored, counted.
  let offGridRunFrames = 0;
  for (const key of probeIndex.keys()) {
    if (!matchedProbeKeys.has(key)) offGridRunFrames += 1;
  }

  const rollup: ScoringRollup = {
    verified: buildRollupSet(rows.filter((r) => r.verified)),
    unverified: buildRollupSet(rows.filter((r) => !r.verified)),
    totalPresent,
    probedPresent,
    probeCoverage: totalPresent > 0 ? probedPresent / totalPresent : null,
    verifiedCoverage: probedPresent > 0 ? probedPresentVerified / probedPresent : null,
    detectionRateVsGT: probedPresent > 0 ? probedPresentDetected / probedPresent : null,
    offGridRunFrames,
  };

  return { groundTruthHash: groundTruth.groundTruthHash, rows, rollup };
}

/** The row scored at `timestampSec` (within pairing tolerance), or null. */
export function findScoredRow(
  rows: readonly DetectionErrorRow[],
  timestampSec: number,
): DetectionErrorRow | null {
  const index = new Map<number, DetectionErrorRow>();
  for (const row of rows) {
    const key = msKey(row.timestamp);
    if (!index.has(key)) index.set(key, row);
  }
  return findByTimestamp(index, timestampSec);
}
