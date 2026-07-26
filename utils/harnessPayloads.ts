/**
 * Harness detection-run payloads.
 *
 * Shapes the `pose` and `orb` bodies pushed to the downloader's POST
 * /api/detections for one Test Video run (see docs/adr/0017). Both reuse the
 * self-contained ScanDiagnostics record — no new metrics — and carry the
 * `setupHash` that ties the run to the Scan Setup it replayed. Attribution
 * (appVersion, resolved config) already lives inside ScanDiagnostics.
 *
 * Posting is append-only: each Analyze run adds a row, and a run superseded by a
 * later Setup edit or code change is left in place to be told apart by its
 * stamps rather than deleted (ADR 0018).
 *
 * Framework-agnostic — no React imports.
 */

import type { FrameConditions, ScanDiagnostics, ReferenceFrameMeta } from "@/pipeline/analysis/diagnostics";
import type { Keypoint, PoseFrame } from "@/pipeline/pose/poseDetection";
import type { DetectionScoring } from "@/utils/harnessScoring";

/** Normalized full-frame search region. Use this value instead of `null` for full-frame attempts. */
export const DETECTOR_ATTEMPT_FULL_FRAME_REGION = { x: 0, y: 0, w: 1, h: 1 } as const;

/** A normalized video-frame rectangle. */
export interface DetectorAttemptRegion {
  /** X origin normalized to [0, 1] relative to the frame width. */
  x: number;
  /** Y origin normalized to [0, 1] relative to the frame height. */
  y: number;
  /** Width normalized to [0, 1] relative to the frame width. */
  w: number;
  /** Height normalized to [0, 1] relative to the frame height. */
  h: number;
}

export type DetectorAttemptStatus = "accepted" | "missing" | "flipRejected" | "qualityRejected";
export type DetectorAttemptSelectionMethod = "tap" | "tracked" | "strongest";

/** One rung of the re-acquire search: the region searched, and what it found there. */
export interface DetectorAttemptReacquireStep {
  /** Normalized rectangle fed to MediaPipe for this rung. */
  region: DetectorAttemptRegion;
  /** True when this rung produced the Climber pose the attempt selected. */
  found: boolean;
}

/**
 * Why a `missing` attempt selected nothing:
 *
 * - `no-candidates` — MediaPipe returned zero poses on every region searched,
 *   so there was nothing to select. A detector failure.
 * - `identity-gated` — candidates existed, but every one fell outside the
 *   identity gate in `selectClimberPose`. A scanner gating decision, not a
 *   detector failure.
 */
export type DetectorAttemptMissReason = "no-candidates" | "identity-gated";

interface DetectorAttemptBase {
  /** Video timestamp in seconds on the dev Analyze 100 ms grid. */
  timestamp: number;
  status: DetectorAttemptStatus;
  /** First normalized rectangle fed to MediaPipe; full-frame attempts use the explicit full-frame region. */
  initialSearchRegion: DetectorAttemptRegion | null;
  /** Normalized rectangle that produced `rawKeypoints`; `null` when no pose was selected. */
  detectionRegion: DetectorAttemptRegion | null;
  /** True when the initial adaptive crop missed and a full-frame fallback was tried. */
  reacquireAttempted: boolean;
  /** True only when full-frame fallback found and accepted the Climber. */
  reacquired: boolean;
  /**
   * The regions the re-acquire searched, in search order, each flagged with
   * whether it found the Climber. Empty when no re-acquire ran. Absent on
   * payloads produced before this field existed — `reacquireAttempted` /
   * `reacquired` remain the compatible summary.
   */
  reacquireSteps?: DetectorAttemptReacquireStep[];
  /**
   * Highest mean keypoint confidence among the MediaPipe candidates that were
   * *not* selected on this attempt, across every region searched. `null` when
   * every returned candidate was selected or none was returned — which is what
   * separates a hard miss (nothing seen) from a near miss (a candidate just
   * outside the gate). Absent on payloads produced before this field existed.
   */
  bestUnselectedCandidateScore?: number | null;
  /** Selected MediaPipe Climber pose before scanner-side rejection or mutation; empty when none was selected. */
  rawKeypoints: Keypoint[];
  /** Pixel conditions for `initialSearchRegion`; `null` when unavailable. */
  searchConditions: FrameConditions | null;
  /** Pixel conditions for the fallback full-frame region; `null` when fallback did not run or is unavailable. */
  reacquireConditions: FrameConditions | null;
  candidateCount: number;
  rejectedCandidateCount: number;
  selectionMethod: DetectorAttemptSelectionMethod;
}

export interface AcceptedDetectorAttempt extends DetectorAttemptBase {
  status: "accepted";
  detectionRegion: DetectorAttemptRegion;
  /** Scanner-accepted keypoints after detector gates; present only for accepted attempts. */
  acceptedKeypoints: Keypoint[];
  missReason?: never;
}

export interface MissingDetectorAttempt extends DetectorAttemptBase {
  status: "missing";
  rawKeypoints: [];
  detectionRegion: null;
  acceptedKeypoints?: never;
  /** Why nothing was selected; absent on payloads produced before this field existed. */
  missReason?: DetectorAttemptMissReason | null;
}

export interface FlipRejectedDetectorAttempt extends DetectorAttemptBase {
  status: "flipRejected";
  detectionRegion: DetectorAttemptRegion;
  acceptedKeypoints?: never;
  missReason?: never;
}

export interface QualityRejectedDetectorAttempt extends DetectorAttemptBase {
  status: "qualityRejected";
  detectionRegion: DetectorAttemptRegion;
  acceptedKeypoints?: never;
  missReason?: never;
}

export type DetectorAttempt =
  | AcceptedDetectorAttempt
  | MissingDetectorAttempt
  | FlipRejectedDetectorAttempt
  | QualityRejectedDetectorAttempt;

/** The `pose` half: full diagnostics record + dense pose frames, with optional detector attempts. */
export interface HarnessPosePayload {
  setupHash: string;
  /**
   * The exact Ground Truth version the run was scored against, or null when
   * the video has no accepted truth (the run posts unscored).
   */
  groundTruthHash: string | null;
  /** The probed-frame scoring block (utils/harnessScoring.ts), or null. */
  scoring: DetectionScoring | null;
  diagnostics: ScanDiagnostics;
  /**
   * Analysis-only MediaPipe attempt evidence. Omitted on legacy/current runs
   * until the detector-attempt capture path supplies a canonical stream.
   */
  detectorAttempts?: DetectorAttempt[];
  frames: PoseFrame[];
}

/** The `orb` half: capture-time extraction data (Reference Frame Metadata + summary). */
export interface HarnessOrbPayload {
  setupHash: string;
  appVersion: string;
  referenceFrameMeta: ReferenceFrameMeta | null;
  summary: ScanDiagnostics["result"]["orb"];
}

/** Build the pose + orb payloads for one detection run. */
export function buildHarnessPayloads(args: {
  diagnostics: ScanDiagnostics;
  frames: PoseFrame[];
  detectorAttempts?: DetectorAttempt[];
  referenceFrameMeta: ReferenceFrameMeta | null;
  setupHash: string;
  /** Scoring vs the video's Ground Truth; null posts the run unscored. */
  scoring?: DetectionScoring | null;
}): { pose: HarnessPosePayload; orb: HarnessOrbPayload } {
  const { diagnostics, frames, detectorAttempts, referenceFrameMeta, setupHash, scoring = null } = args;
  return {
    pose: {
      setupHash,
      groundTruthHash: scoring?.groundTruthHash ?? null,
      scoring,
      diagnostics,
      ...(detectorAttempts ? { detectorAttempts } : {}),
      frames,
    },
    orb: {
      setupHash,
      appVersion: diagnostics.appVersion,
      referenceFrameMeta,
      summary: diagnostics.result.orb,
    },
  };
}

/**
 * Post one Analyze run to the downloader through the dev relay, which forwards
 * it server-to-server so the page never crosses an origin boundary. Resolves
 * with the run identifier the downloader assigned, when it reports one.
 */
export async function postDetectionRun(args: {
  videoPath: string;
  pose: HarnessPosePayload;
  orb: HarnessOrbPayload;
}): Promise<{ runId: string | null }> {
  const res = await fetch("/api/dev/detections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_path: args.videoPath, pose: args.pose, orb: args.orb }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // The relay passes the downloader's body through verbatim, so a non-JSON
    // body is possible; the status still decides success.
  }
  if (!res.ok) {
    const error = typeof body.error === "string" ? body.error : null;
    throw new Error(error ?? `Failed to post the detection run (${res.status}).`);
  }
  return { runId: typeof body.run_id === "string" ? body.run_id : null };
}
