/**
 * Detection-diagnostics record types and pure assembly functions.
 *
 * Each scan produces a {@link ScanDiagnostics} record; each route-photo match
 * produces a {@link MatchDiagnostics} record. Both are self-contained — they
 * carry the full input conditions, resolved detection config, an `appVersion`
 * git SHA, and the result, keyed by SHA-256 content hashes — so dev-local trend
 * analysis needs no join back to the pose/ORB artifacts. One field,
 * {@link ReferenceFrameMeta}, lives in S3 on the Run artifact (read back at
 * match time) rather than locally.
 *
 * See `docs/adr/0006-dev-local-detection-diagnostics.md` and the CONTEXT.md
 * glossary terms Scan Diagnostics / Match Diagnostics / Reference Frame Metadata.
 *
 * This module is framework-agnostic — no React imports. The assembly functions
 * are pure (no OpenCV, no I/O): they take already-computed values and shape the
 * record. Keep it that way.
 */

import type { RegionStats, FrameAnalysis } from "@/pipeline/analysis/frameAnalyzer";

/** Schema version stamped onto every diagnostics record. */
export const DIAGNOSTICS_SCHEMA_VERSION = 1;

/**
 * A detected frame whose average keypoint confidence is below this floor counts
 * as "weak" for bad-stretch detection (alongside "missing" — no detection).
 */
export const WEAK_CONFIDENCE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** The five frame-condition flags produced by {@link FrameAnalysis}. */
export interface ConditionFlags {
  isOverexposed: boolean;
  isUnderexposed: boolean;
  isBacklit: boolean;
  isLowContrast: boolean;
  isBlurry: boolean;
}

/** Region brightness/contrast/sharpness stats + condition flags for a frame. */
export interface FrameConditions {
  overall: RegionStats;
  climber: RegionStats | null;
  wall: RegionStats | null;
  flags: ConditionFlags;
}

/** Distribution summary used for confidence / keyframe-keypoint spreads. */
export interface MinAvgMax {
  min: number;
  avg: number;
  max: number;
}

export type CaptureMode = "fixed" | "panning";

/** Manual quality tag applied from the dev panel for a scan's Route Overlay. */
export type OverlayQuality = "good" | "drift" | "fail";

/** Manual quality tag applied from the dev panel for a route-photo match. */
export type MatchQuality = "good" | "weak" | "fail";

// ---------------------------------------------------------------------------
// Homography stats (out-param populated by computeHomography)
// ---------------------------------------------------------------------------

/**
 * Why a homography computation returned the result it did. `ok` is the only
 * success value; the rest label the three null return paths of
 * {@link computeHomography} so a failed match is a data point, not an
 * indistinguishable `null`.
 */
export type HomographyFailureReason =
  | "ok"
  | "too_few_matches"
  | "degenerate"
  | "gate_rejected";

/**
 * Stats out-param for `computeHomography`. The caller pre-allocates one (e.g.
 * via {@link emptyHomographyStats}) and passes it as `opts.stats`; the function
 * populates it on every return path including the three null cases.
 */
export interface HomographyStats {
  /** Candidate matches fed to RANSAC. */
  matchCount: number;
  /** Matches RANSAC kept as inliers (0 on every failure path). */
  inlierCount: number;
  /** inlierCount / matchCount (0 when matchCount is 0). */
  inlierRatio: number;
  /** True only when a non-degenerate, gate-passing homography was returned. */
  homographyFound: boolean;
  failureReason: HomographyFailureReason;
}

/** A fresh, zeroed {@link HomographyStats} to pass as the `opts.stats` out-param. */
export function emptyHomographyStats(): HomographyStats {
  return {
    matchCount: 0,
    inlierCount: 0,
    inlierRatio: 0,
    homographyFound: false,
    failureReason: "too_few_matches",
  };
}

// ---------------------------------------------------------------------------
// Reference Frame Metadata (S3, on the RouteAttempt)
// ---------------------------------------------------------------------------

/**
 * The quality characteristics of a Run's processed reference frame, stored in
 * S3 alongside the reference ORB features so the features always travel with the
 * conditions they were extracted under. Read back at match time to build the
 * `input.reference` block of a {@link MatchDiagnostics} record.
 */
export interface ReferenceFrameMeta {
  width: number;
  height: number;
  refKeypointCount: number;
  overall: RegionStats;
  climber: RegionStats | null;
  wall: RegionStats | null;
  flags: ConditionFlags;
}

// ---------------------------------------------------------------------------
// Scan diagnostics
// ---------------------------------------------------------------------------

/** One detection-frame row inside a {@link BadStretch}. */
export interface BadStretchFrame {
  timestamp: number;
  frameIndex: number;
  status: "missing" | "weak";
  avgConfidence: number;
  keypointCount: number;
  wasFlip: boolean;
}

/** A run of consecutive bad (missing/weak) detection frames. */
export interface BadStretch {
  startTs: number;
  endTs: number;
  frames: BadStretchFrame[];
}

/**
 * Per-sampled-frame detection status, fed to {@link detectBadStretches}. One row
 * per frame the seek loop ran pose detection on (every Nth sampled frame).
 */
export interface SampledFrameStatus {
  timestamp: number;
  frameIndex: number;
  /** False when `detectClimber` returned null for this frame. */
  detected: boolean;
  /** Mean keypoint confidence (0 when not detected). */
  avgConfidence: number;
  /** Keypoint count (0 when not detected). */
  keypointCount: number;
  /** Whether this frame was discarded by the landmark-flip pass. */
  wasFlip: boolean;
}

export interface ScanDiagnostics {
  schemaVersion: number;
  recordType: "scan";
  scanId: string;
  createdAt: string;
  videoHash: string;
  appVersion: string;
  input: {
    video: {
      width: number;
      height: number;
      durationSec: number;
      frameCount: number;
      fileType: string;
      source: "recorded" | "uploaded";
    };
    captureMode: CaptureMode;
    referenceFrame: FrameConditions;
    /** Climber bbox area ÷ frame area across detection frames. */
    climberFrameCoverage: { min: number; avg: number };
    /** Average centroid displacement between detected anchors. */
    motionMagnitude: number;
  };
  config: {
    frameStep: number;
    frameIntervalMs: number;
    minScore: number;
    maxRecoveryFrames: number;
    /** May be Infinity (serialises as null) when motion-triggered refinement is off. */
    motionThreshold: number;
    filterTolerance: number | null;
    flipTeleportBase: number;
    refineStride: number;
  };
  result: {
    pose: {
      sampledFrames: number;
      detectedFrames: number;
      detectionRate: number;
      flippedFrames: number;
      keptFrames: number;
      goodFrames: number;
      confidence: MinAvgMax;
      avgKeypointCount: number;
      /** Detection frames where a missing limb grew the crop via a reach disk (ADR 0014). */
      limbExpandedFrames: number;
      refinement: { gapsRefined: number; recoveryFramesUsed: number };
    };
    orb: {
      refKeypointCount: number;
      keyframeCount: number;
      keyframeKeypoints: MinAvgMax;
    };
    /** Manual tag from the dev panel; null until tagged. */
    overlayQuality: OverlayQuality | null;
    badStretches: BadStretch[];
  };
}

// ---------------------------------------------------------------------------
// Match diagnostics
// ---------------------------------------------------------------------------

/**
 * Match result shape. Fixed Capture carries a single {@link HomographyStats};
 * Panning Capture aggregates one stats entry per attempted Keyframe into a
 * single record (min/avg/max inlier ratio + matched-keyframe count).
 */
export type MatchResultInput =
  | { mode: "fixed"; stats: HomographyStats }
  | { mode: "panning"; perKeyframe: HomographyStats[] };

export interface MatchDiagnostics {
  schemaVersion: number;
  recordType: "match";
  createdAt: string;
  appVersion: string;
  videoHash: string;
  imageHash: string;
  scanId: string;
  input: {
    /** Pulled from the Run's S3 Reference Frame Metadata; null for legacy Runs. */
    reference: {
      width: number;
      height: number;
      refKeypointCount: number;
      wall: RegionStats | null;
      flags: ConditionFlags;
    } | null;
    /** Fresh analyzeFrame on the uploaded photo. */
    query: {
      width: number;
      height: number;
      queryKeypointCount: number;
      overall: RegionStats;
      flags: ConditionFlags;
      /** The queryMaxEdgeFor downscale factor applied before extraction. */
      downscaleApplied: number;
    };
  };
  result: {
    matchCount: number;
    inlierCount: number;
    /** A single ratio (fixed) or the {min,avg,max} spread across keyframes (panning). */
    inlierRatio: number | MinAvgMax;
    homographyFound: boolean;
    captureMode: CaptureMode;
    failureReason: HomographyFailureReason;
    /** Manual tag from the dev panel; null until tagged. */
    matchQuality: MatchQuality | null;
    /** Panning only: how many Keyframes produced a valid homography. */
    keyframesMatched?: number;
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Summarise a list of numbers as {min, avg, max}. Empty input → all zero. */
export function summarizeMinAvgMax(values: number[]): MinAvgMax {
  if (values.length === 0) return { min: 0, avg: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, avg: sum / values.length, max };
}

/** Map a {@link FrameAnalysis} to the {@link FrameConditions} block. */
export function toFrameConditions(analysis: FrameAnalysis): FrameConditions {
  return {
    overall: analysis.overall,
    climber: analysis.climber,
    wall: analysis.wall,
    flags: {
      isOverexposed: analysis.isOverexposed,
      isUnderexposed: analysis.isUnderexposed,
      isBacklit: analysis.isBacklit,
      isLowContrast: analysis.isLowContrast,
      isBlurry: analysis.isBlurry,
    },
  };
}

/**
 * Build the S3 {@link ReferenceFrameMeta} from the frame-0 analysis and the
 * reference ORB keypoint count.
 */
export function buildReferenceFrameMeta(
  analysis: FrameAnalysis,
  refKeypointCount: number,
  width: number,
  height: number,
): ReferenceFrameMeta {
  const conditions = toFrameConditions(analysis);
  return {
    width,
    height,
    refKeypointCount,
    overall: conditions.overall,
    climber: conditions.climber,
    wall: conditions.wall,
    flags: conditions.flags,
  };
}

/**
 * Detect bad stretches: runs of `minRunLength` or more consecutive detection
 * frames that are bad, where bad = missing (no detection) OR average confidence
 * below {@link WEAK_CONFIDENCE_THRESHOLD}. Pure scan over the sampled rows; does
 * not re-analyse frames.
 *
 * @param rows         Per-sampled-frame status, in capture order.
 * @param minRunLength Minimum consecutive bad frames to qualify as a stretch
 *                     (the caller passes `GAP_RECOVERY_THRESHOLD = 3 * frameStep`).
 */
export function detectBadStretches(
  rows: SampledFrameStatus[],
  minRunLength: number,
): BadStretch[] {
  const stretches: BadStretch[] = [];
  let run: BadStretchFrame[] = [];

  const flush = () => {
    if (run.length >= minRunLength) {
      stretches.push({
        startTs: run[0].timestamp,
        endTs: run[run.length - 1].timestamp,
        frames: run,
      });
    }
    run = [];
  };

  for (const row of rows) {
    const isBad = !row.detected || row.avgConfidence < WEAK_CONFIDENCE_THRESHOLD;
    if (isBad) {
      run.push({
        timestamp: row.timestamp,
        frameIndex: row.frameIndex,
        status: row.detected ? "weak" : "missing",
        avgConfidence: row.avgConfidence,
        keypointCount: row.keypointCount,
        wasFlip: row.wasFlip,
      });
    } else {
      flush();
    }
  }
  flush();

  return stretches;
}

// ---------------------------------------------------------------------------
// Record assembly
// ---------------------------------------------------------------------------

/** Inputs to {@link buildScanDiagnostics} — already-computed values. */
export interface ScanDiagnosticsInput {
  scanId: string;
  videoHash: string;
  appVersion: string;
  video: ScanDiagnostics["input"]["video"];
  captureMode: CaptureMode;
  referenceAnalysis: FrameAnalysis;
  climberFrameCoverage: { min: number; avg: number };
  motionMagnitude: number;
  config: ScanDiagnostics["config"];
  pose: ScanDiagnostics["result"]["pose"];
  orb: ScanDiagnostics["result"]["orb"];
  badStretches: BadStretch[];
  /** Manual tag, if already applied (otherwise null). */
  overlayQuality?: OverlayQuality | null;
  /** Defaults to `new Date().toISOString()`. */
  createdAt?: string;
}

/** Assemble a {@link ScanDiagnostics} record from already-computed values. */
export function buildScanDiagnostics(input: ScanDiagnosticsInput): ScanDiagnostics {
  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    recordType: "scan",
    scanId: input.scanId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    videoHash: input.videoHash,
    appVersion: input.appVersion,
    input: {
      video: input.video,
      captureMode: input.captureMode,
      referenceFrame: toFrameConditions(input.referenceAnalysis),
      climberFrameCoverage: input.climberFrameCoverage,
      motionMagnitude: input.motionMagnitude,
    },
    config: input.config,
    result: {
      pose: input.pose,
      orb: input.orb,
      overlayQuality: input.overlayQuality ?? null,
      badStretches: input.badStretches,
    },
  };
}

/** Inputs to {@link buildMatchDiagnostics} — already-computed values. */
export interface MatchDiagnosticsInput {
  scanId: string;
  videoHash: string;
  imageHash: string;
  appVersion: string;
  reference: MatchDiagnostics["input"]["reference"];
  query: MatchDiagnostics["input"]["query"];
  match: MatchResultInput;
  /** Manual tag, if already applied (otherwise null). */
  matchQuality?: MatchQuality | null;
  /** Defaults to `new Date().toISOString()`. */
  createdAt?: string;
}

/**
 * Shape the `result` block from the per-mode match input. Fixed Capture copies
 * the single stats; Panning Capture aggregates across attempted keyframes.
 */
function shapeMatchResult(
  match: MatchResultInput,
  matchQuality: MatchQuality | null,
): MatchDiagnostics["result"] {
  if (match.mode === "fixed") {
    const s = match.stats;
    return {
      matchCount: s.matchCount,
      inlierCount: s.inlierCount,
      inlierRatio: s.inlierRatio,
      homographyFound: s.homographyFound,
      captureMode: "fixed",
      failureReason: s.failureReason,
      matchQuality,
    };
  }

  const matched = match.perKeyframe.filter((s) => s.homographyFound);
  const matchCount = match.perKeyframe.reduce((sum, s) => sum + s.matchCount, 0);
  const inlierCount = match.perKeyframe.reduce((sum, s) => sum + s.inlierCount, 0);
  return {
    matchCount,
    inlierCount,
    inlierRatio: summarizeMinAvgMax(matched.map((s) => s.inlierRatio)),
    homographyFound: matched.length > 0,
    captureMode: "panning",
    failureReason: matched.length > 0 ? "ok" : "too_few_matches",
    matchQuality,
    keyframesMatched: matched.length,
  };
}

/** Assemble a {@link MatchDiagnostics} record from already-computed values. */
export function buildMatchDiagnostics(input: MatchDiagnosticsInput): MatchDiagnostics {
  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    recordType: "match",
    createdAt: input.createdAt ?? new Date().toISOString(),
    appVersion: input.appVersion,
    videoHash: input.videoHash,
    imageHash: input.imageHash,
    scanId: input.scanId,
    input: {
      reference: input.reference,
      query: input.query,
    },
    result: shapeMatchResult(input.match, input.matchQuality ?? null),
  };
}
