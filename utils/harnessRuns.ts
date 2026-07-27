/**
 * Reading posted detection runs back off the corpus.
 *
 * Every Analyze run — manual or batch — posts a {@link HarnessPosePayload} that
 * the downloader writes to `<bundle>/detections/<runTs>_pose.json`, wrapped in
 * its own envelope (`{ video_key, route_folder, run_ts, written_at, type, data
 * }`). That file is the only durable record of what the detector did: the
 * scanner throws the payload away when the page unmounts. This module is the
 * read half — the pure validating parsers plus the thin `fetch` seam over
 * `GET /api/dev/detections`, mirroring the split in `utils/harnessGroundTruth`.
 *
 * The parsers trust the disk no more than a request body. A run file may have
 * been hand-edited, truncated mid-write, or written by an older scanner, and the
 * reviewer must be told *why* a run will not open rather than discover a missing
 * field halfway through a render. So a parse either yields a fully-typed payload
 * or an error string.
 *
 * Legacy tolerance is deliberate and load-bearing: most of the corpus predates
 * `detectorAttempts`, and older attempt streams predate `missReason` and
 * `selectionMethod`. Those are documented optional in `utils/harnessPayloads`,
 * and a run without them is valid v1 evidence — it must load, not 422.
 *
 * Framework-agnostic apart from the `fetch` seam at the bottom — no React.
 */

import type { FrameConditions, ScanDiagnostics } from "@/pipeline/analysis/diagnostics";
import type { Keypoint, PoseFrame, PoseFrameSource } from "@/pipeline/pose/poseDetection";
import type {
  DetectorAttempt,
  DetectorAttemptMissReason,
  DetectorAttemptRegion,
  DetectorAttemptReacquireStep,
  DetectorAttemptSelectionMethod,
  DetectorAttemptStatus,
  HarnessPosePayload,
} from "@/utils/harnessPayloads";
import type {
  DetectionErrorKind,
  DetectionErrorRow,
  DetectionScoring,
  DriftStats,
  ScoringRollup,
  ScoringRollupSet,
  UnscoredReason,
  VerdictCounts,
} from "@/utils/harnessScoring";

// ---------------------------------------------------------------------------
// List shapes — everything needed to pick a run *without* downloading it
// ---------------------------------------------------------------------------

/**
 * The run's verdict rollup, kept in the verified / unverified split the scoring
 * pass produces. Merging the two here would hide exactly the distinction
 * `harnessScoring` exists to preserve.
 */
export interface HarnessRunVerdicts {
  verified: VerdictCounts;
  unverified: VerdictCounts;
}

/**
 * One run as it appears in the Bundle's run list. Carries the stamps and the
 * verdict rollup — never the frames or detector attempts, which are the large
 * part of the payload and travel only on the single-run fetch.
 */
export interface HarnessRunSummary {
  /** The run identifier, from the `<runTs>_pose.json` file name. */
  runTs: string;
  /** The envelope's `written_at`; null on a bare payload or an unreadable file. */
  writtenAt: string | null;
  /** The Scan Setup the run was scanned under; null when unstamped/unreadable. */
  setupHash: string | null;
  /** The Ground Truth version the run was scored against; null when unscored. */
  groundTruthHash: string | null;
  /**
   * True when the run's `setupHash` pairs with the Bundle's Ground Truth — i.e.
   * the run is evaluation evidence (`utils/harnessFreshness`). Always false on a
   * truthless Bundle: there is nothing to pair with.
   */
  pairsWithTruth: boolean;
  /** The scoring rollup's verdict counts; null when the run posted unscored. */
  verdicts: HarnessRunVerdicts | null;
  /**
   * True when the file could not be read or parsed far enough to yield the
   * stamps above. Such a run still lists — it exists on disk and the operator
   * should see it — but opening it will fail, and the row should say so rather
   * than read as an unstamped legacy run.
   */
  malformed: boolean;
}

/** The stamps read off one run file, before pairing is resolved. */
export interface HarnessRunFacts {
  writtenAt: string | null;
  setupHash: string | null;
  groundTruthHash: string | null;
  verdicts: HarnessRunVerdicts | null;
  malformed: boolean;
}

/** A parse that either produced a typed payload or a reason it could not. */
export type HarnessRunParse =
  | { ok: true; payload: HarnessPosePayload }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** The downloader's run envelope, unwrapped. */
export interface HarnessRunEnvelope {
  /** `run_ts` from the envelope; null on a bare payload. */
  runTs: string | null;
  /** `written_at` from the envelope; null on a bare payload. */
  writtenAt: string | null;
  /** The scanner's payload — still unvalidated. */
  data: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Unwrap a `<ts>_pose.json` body. The downloader wraps the scanner payload in
 * an envelope; a bare payload (top-level `setupHash`, no `data`) is accepted
 * too, matching how the corpus lister reads a run's stamp. Null when the body
 * is not an object at all.
 *
 * The `data` **key** decides which shape this is, not whether its value looks
 * usable: an envelope carrying a gutted `data` must surface as a broken run,
 * not silently re-read as a bare payload with every stamp missing.
 */
export function unwrapRunEnvelope(body: unknown): HarnessRunEnvelope | null {
  if (!isRecord(body)) return null;
  if (!("data" in body)) return { runTs: null, writtenAt: null, data: body };
  return {
    runTs: str(body.run_ts),
    writtenAt: str(body.written_at),
    data: body.data,
  };
}

// ---------------------------------------------------------------------------
// Scalar guards
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A count field: a finite non-negative number. */
function isCount(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0;
}

function nullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

/** A `number | null` field, where a missing value reads as null. */
function nullableNumber(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return isFiniteNumber(v) ? v : undefined;
}

// ---------------------------------------------------------------------------
// Verdict counts — the one part of `scoring` the list response carries
// ---------------------------------------------------------------------------

const VERDICT_KEYS = [
  "good",
  "drift",
  "wrong",
  "extreme",
  "missing",
  "unscored",
  "absentOk",
  "absentViolation",
] as const satisfies readonly (keyof VerdictCounts)[];

function parseVerdictCounts(v: unknown): VerdictCounts | null {
  if (!isRecord(v)) return null;
  for (const key of VERDICT_KEYS) {
    if (!isCount(v[key])) return null;
  }
  return {
    good: v.good as number,
    drift: v.drift as number,
    wrong: v.wrong as number,
    extreme: v.extreme as number,
    missing: v.missing as number,
    unscored: v.unscored as number,
    absentOk: v.absentOk as number,
    absentViolation: v.absentViolation as number,
  };
}

/**
 * The verdict rollup from an unvalidated `scoring` block, or null when the run
 * posted unscored or its rollup is unreadable. Cheap by design: the list walk
 * runs this over every run file in a Bundle, so it never touches `rows`.
 */
export function parseRunVerdicts(scoring: unknown): HarnessRunVerdicts | null {
  if (!isRecord(scoring) || !isRecord(scoring.rollup)) return null;
  const { verified, unverified } = scoring.rollup;
  if (!isRecord(verified) || !isRecord(unverified)) return null;
  const verifiedCounts = parseVerdictCounts(verified.counts);
  const unverifiedCounts = parseVerdictCounts(unverified.counts);
  if (!verifiedCounts || !unverifiedCounts) return null;
  return { verified: verifiedCounts, unverified: unverifiedCounts };
}

/**
 * Read one run file's list-level facts out of its raw JSON body. Tolerant by
 * design — a file the reviewer cannot open still belongs in the list, flagged
 * `malformed`, rather than dropping out of it or breaking the whole listing.
 */
export function summarizeRunFile(body: unknown): HarnessRunFacts {
  const envelope = unwrapRunEnvelope(body);
  if (!envelope || !isRecord(envelope.data)) {
    return {
      writtenAt: null,
      setupHash: null,
      groundTruthHash: null,
      verdicts: null,
      malformed: true,
    };
  }
  const data = envelope.data;
  return {
    writtenAt: envelope.writtenAt,
    setupHash: str(data.setupHash),
    groundTruthHash: str(data.groundTruthHash),
    verdicts: parseRunVerdicts(data.scoring),
    malformed: false,
  };
}

// ---------------------------------------------------------------------------
// Payload validation — the single-run read path
// ---------------------------------------------------------------------------

/** Hard cap on frames / attempts, mirroring the Ground Truth bound. */
const MAX_FRAMES = 100_000;

function parseKeypoints(v: unknown): Keypoint[] | null {
  if (!Array.isArray(v)) return null;
  const out: Keypoint[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) return null;
    if (typeof raw.name !== "string" || raw.name.length === 0) return null;
    if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.score)) return null;
    out.push({ name: raw.name, x: raw.x, y: raw.y, score: raw.score });
  }
  return out;
}

const POSE_FRAME_SOURCES: readonly PoseFrameSource[] = [
  "raw",
  "interpolated",
  "filled",
  "flipDiscarded",
  "limbExpanded",
];

function parseFrames(v: unknown): PoseFrame[] | null {
  if (!Array.isArray(v) || v.length > MAX_FRAMES) return null;
  const out: PoseFrame[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) return null;
    if (!isFiniteNumber(raw.timestamp)) return null;
    const keypoints = parseKeypoints(raw.keypoints);
    if (!keypoints) return null;
    // Legacy persisted frames carry no provenance — absent is valid, a value
    // outside the union is not.
    if (raw.source !== undefined && !POSE_FRAME_SOURCES.includes(raw.source as PoseFrameSource)) {
      return null;
    }
    out.push({
      timestamp: raw.timestamp,
      ...(raw.source !== undefined ? { source: raw.source as PoseFrameSource } : {}),
      keypoints,
    });
  }
  return out;
}

function parseRegion(v: unknown): DetectorAttemptRegion | null {
  if (!isRecord(v)) return null;
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return null;
  if (!isFiniteNumber(v.w) || !isFiniteNumber(v.h)) return null;
  return { x: v.x, y: v.y, w: v.w, h: v.h };
}

/** `false` distinguishes "present but invalid" from a legitimate `null`. */
function parseNullableRegion(v: unknown): DetectorAttemptRegion | null | false {
  if (v === null || v === undefined) return null;
  return parseRegion(v) ?? false;
}

/**
 * Pixel conditions ride along verbatim. The record is a closed shape the
 * scanner writes and the diagnostics panel reads back through its own props, so
 * it is checked for structure (object or explicit null) rather than re-derived
 * leaf by leaf here.
 */
function parseConditions(v: unknown): FrameConditions | null | false {
  if (v === null || v === undefined) return null;
  return isRecord(v) ? (v as unknown as FrameConditions) : false;
}

function parseReacquireSteps(v: unknown): DetectorAttemptReacquireStep[] | null {
  if (!Array.isArray(v)) return null;
  const out: DetectorAttemptReacquireStep[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) return null;
    const region = parseRegion(raw.region);
    if (!region || typeof raw.found !== "boolean") return null;
    out.push({ region, found: raw.found });
  }
  return out;
}

const ATTEMPT_STATUSES: readonly DetectorAttemptStatus[] = [
  "accepted",
  "missing",
  "flipRejected",
  "qualityRejected",
];
const MISS_REASONS: readonly DetectorAttemptMissReason[] = ["no-candidates", "identity-gated"];
const SELECTION_METHODS: readonly DetectorAttemptSelectionMethod[] = [
  "tap",
  "tracked",
  "strongest",
];

/** The fields every attempt shares, whatever its status. */
interface AttemptBaseFields {
  timestamp: number;
  initialSearchRegion: DetectorAttemptRegion | null;
  reacquireAttempted: boolean;
  reacquired: boolean;
  reacquireSteps?: DetectorAttemptReacquireStep[];
  bestUnselectedCandidateScore?: number | null;
  rawKeypoints: Keypoint[];
  searchConditions: FrameConditions | null;
  reacquireConditions: FrameConditions | null;
  candidateCount: number;
  rejectedCandidateCount: number;
  selectionMethod?: DetectorAttemptSelectionMethod;
  inferenceMs?: number;
}

function parseAttemptBase(a: Record<string, unknown>): AttemptBaseFields | null {
  if (!isFiniteNumber(a.timestamp)) return null;
  if (typeof a.reacquireAttempted !== "boolean" || typeof a.reacquired !== "boolean") return null;
  if (!isCount(a.candidateCount) || !isCount(a.rejectedCandidateCount)) return null;

  const initialSearchRegion = parseNullableRegion(a.initialSearchRegion);
  if (initialSearchRegion === false) return null;

  const rawKeypoints = parseKeypoints(a.rawKeypoints);
  if (!rawKeypoints) return null;

  const searchConditions = parseConditions(a.searchConditions);
  if (searchConditions === false) return null;
  const reacquireConditions = parseConditions(a.reacquireConditions);
  if (reacquireConditions === false) return null;

  // Every field below is optional on v1 payloads — absent is valid evidence.
  let reacquireSteps: DetectorAttemptReacquireStep[] | undefined;
  if (a.reacquireSteps !== undefined) {
    const steps = parseReacquireSteps(a.reacquireSteps);
    if (!steps) return null;
    reacquireSteps = steps;
  }

  let bestUnselectedCandidateScore: number | null | undefined;
  if (a.bestUnselectedCandidateScore !== undefined) {
    const score = nullableNumber(a.bestUnselectedCandidateScore);
    if (score === undefined) return null;
    bestUnselectedCandidateScore = score;
  }

  let selectionMethod: DetectorAttemptSelectionMethod | undefined;
  if (a.selectionMethod !== undefined) {
    if (!SELECTION_METHODS.includes(a.selectionMethod as DetectorAttemptSelectionMethod)) {
      return null;
    }
    selectionMethod = a.selectionMethod as DetectorAttemptSelectionMethod;
  }

  let inferenceMs: number | undefined;
  if (a.inferenceMs !== undefined) {
    if (!isCount(a.inferenceMs)) return null;
    inferenceMs = a.inferenceMs;
  }

  return {
    timestamp: a.timestamp,
    initialSearchRegion,
    reacquireAttempted: a.reacquireAttempted,
    reacquired: a.reacquired,
    ...(reacquireSteps !== undefined ? { reacquireSteps } : {}),
    ...(bestUnselectedCandidateScore !== undefined ? { bestUnselectedCandidateScore } : {}),
    rawKeypoints,
    searchConditions,
    reacquireConditions,
    candidateCount: a.candidateCount,
    rejectedCandidateCount: a.rejectedCandidateCount,
    ...(selectionMethod !== undefined ? { selectionMethod } : {}),
    ...(inferenceMs !== undefined ? { inferenceMs } : {}),
  };
}

/**
 * One detector attempt. The status decides which fields must be present: an
 * `accepted` attempt owns a detection region and accepted keypoints, a `missing`
 * one owns neither and may carry a miss reason. Legacy attempts predate
 * `missReason` and `selectionMethod`, so both stay optional.
 */
function parseAttempt(v: unknown): DetectorAttempt | null {
  if (!isRecord(v)) return null;
  if (typeof v.status !== "string" || !ATTEMPT_STATUSES.includes(v.status as DetectorAttemptStatus)) {
    return null;
  }
  const base = parseAttemptBase(v);
  if (!base) return null;

  const detectionRegion = parseNullableRegion(v.detectionRegion);
  if (detectionRegion === false) return null;

  if (v.status === "missing") {
    if (base.rawKeypoints.length > 0 || detectionRegion !== null) return null;
    let missReason: DetectorAttemptMissReason | null | undefined;
    if (v.missReason !== undefined) {
      if (v.missReason !== null && !MISS_REASONS.includes(v.missReason as DetectorAttemptMissReason)) {
        return null;
      }
      missReason = v.missReason as DetectorAttemptMissReason | null;
    }
    return {
      ...base,
      status: "missing",
      rawKeypoints: [],
      detectionRegion: null,
      ...(missReason !== undefined ? { missReason } : {}),
    };
  }

  // The three pose-bearing statuses all localise the pose they found.
  if (!detectionRegion) return null;

  if (v.status === "accepted") {
    const acceptedKeypoints = parseKeypoints(v.acceptedKeypoints);
    if (!acceptedKeypoints) return null;
    let synthesizedJoints: string[] | undefined;
    if (v.synthesizedJoints !== undefined) {
      if (!Array.isArray(v.synthesizedJoints)) return null;
      if (!v.synthesizedJoints.every((j): j is string => typeof j === "string")) return null;
      synthesizedJoints = v.synthesizedJoints;
    }
    if (v.flipFlagged !== undefined && v.flipFlagged !== true) return null;
    return {
      ...base,
      status: "accepted",
      detectionRegion,
      acceptedKeypoints,
      ...(synthesizedJoints !== undefined ? { synthesizedJoints } : {}),
      ...(v.flipFlagged === true ? { flipFlagged: true } : {}),
    };
  }

  if (v.status === "flipRejected") {
    return { ...base, status: "flipRejected", detectionRegion };
  }
  return { ...base, status: "qualityRejected", detectionRegion };
}

function parseAttempts(v: unknown): DetectorAttempt[] | null {
  if (!Array.isArray(v) || v.length > MAX_FRAMES) return null;
  const out: DetectorAttempt[] = [];
  for (const raw of v) {
    const attempt = parseAttempt(raw);
    if (!attempt) return null;
    out.push(attempt);
  }
  return out;
}

const ERROR_KINDS: readonly DetectionErrorKind[] = [
  "good",
  "drift",
  "wrong",
  "extreme",
  "missing",
  "unscored",
];
const UNSCORED_REASONS: readonly UnscoredReason[] = ["no-body-scale", "flagged-wrong-joints"];

function parseJointDrift(v: unknown): Record<string, number> | null {
  if (v === undefined) return {};
  if (!isRecord(v)) return null;
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(v)) {
    if (!isFiniteNumber(value)) return null;
    out[name] = value;
  }
  return out;
}

function parseErrorRow(v: unknown): DetectionErrorRow | null {
  if (!isRecord(v)) return null;
  if (!Number.isInteger(v.frameIndex)) return null;
  if (!isFiniteNumber(v.timestamp)) return null;
  if (v.state !== "present" && v.state !== "absent") return null;
  if (typeof v.kind !== "string" || !ERROR_KINDS.includes(v.kind as DetectionErrorKind)) return null;
  if (typeof v.verified !== "boolean") return null;

  const bodyScale = nullableNumber(v.bodyScale);
  const driftAvg = nullableNumber(v.driftAvg);
  const driftMax = nullableNumber(v.driftMax);
  if (bodyScale === undefined || driftAvg === undefined || driftMax === undefined) return null;
  if (!nullableString(v.worstJoint ?? null)) return null;

  const jointDrift = parseJointDrift(v.jointDrift);
  if (!jointDrift) return null;

  let unscoredReason: UnscoredReason | undefined;
  if (v.unscoredReason !== undefined) {
    if (!UNSCORED_REASONS.includes(v.unscoredReason as UnscoredReason)) return null;
    unscoredReason = v.unscoredReason as UnscoredReason;
  }

  return {
    frameIndex: v.frameIndex as number,
    timestamp: v.timestamp,
    state: v.state,
    kind: v.kind as DetectionErrorKind,
    verified: v.verified,
    ...(unscoredReason !== undefined ? { unscoredReason } : {}),
    bodyScale,
    driftAvg,
    driftMax,
    worstJoint: (v.worstJoint as string | null | undefined) ?? null,
    jointDrift,
  };
}

function parseDriftStats(v: unknown): DriftStats | null | false {
  if (v === null || v === undefined) return null;
  if (!isRecord(v)) return false;
  if (!isFiniteNumber(v.min) || !isFiniteNumber(v.avg) || !isFiniteNumber(v.max)) return false;
  return { min: v.min, avg: v.avg, max: v.max };
}

function parseRollupSet(v: unknown): ScoringRollupSet | null {
  if (!isRecord(v)) return null;
  const counts = parseVerdictCounts(v.counts);
  if (!counts) return null;
  const drift = parseDriftStats(v.drift);
  if (drift === false) return null;
  return { counts, drift };
}

function parseRollup(v: unknown): ScoringRollup | null {
  if (!isRecord(v)) return null;
  const verified = parseRollupSet(v.verified);
  const unverified = parseRollupSet(v.unverified);
  if (!verified || !unverified) return null;
  if (!isCount(v.totalPresent) || !isCount(v.probedPresent)) return null;
  if (!isCount(v.offGridRunFrames)) return null;

  const probeCoverage = nullableNumber(v.probeCoverage);
  const verifiedCoverage = nullableNumber(v.verifiedCoverage);
  const detectionRateVsGT = nullableNumber(v.detectionRateVsGT);
  if (
    probeCoverage === undefined ||
    verifiedCoverage === undefined ||
    detectionRateVsGT === undefined
  ) {
    return null;
  }

  return {
    verified,
    unverified,
    totalPresent: v.totalPresent,
    probedPresent: v.probedPresent,
    probeCoverage,
    verifiedCoverage,
    detectionRateVsGT,
    offGridRunFrames: v.offGridRunFrames,
  };
}

function parseScoring(v: unknown): DetectionScoring | null | false {
  if (v === null || v === undefined) return null;
  if (!isRecord(v)) return false;
  if (typeof v.groundTruthHash !== "string") return false;
  if (!Array.isArray(v.rows) || v.rows.length > MAX_FRAMES) return false;
  const rows: DetectionErrorRow[] = [];
  for (const raw of v.rows) {
    const row = parseErrorRow(raw);
    if (!row) return false;
    rows.push(row);
  }
  const rollup = parseRollup(v.rollup);
  if (!rollup) return false;
  return { groundTruthHash: v.groundTruthHash, rows, rollup };
}

/**
 * The diagnostics record's structural spine. The record is large, additively
 * versioned, and rendered through prop-typed panels, so this checks that the
 * blocks those panels index into exist rather than re-validating every leaf —
 * enough to catch a truncated or hand-gutted file, without rejecting a run
 * written by an older schema version.
 */
function parseDiagnostics(v: unknown): ScanDiagnostics | null {
  if (!isRecord(v)) return null;
  if (typeof v.appVersion !== "string") return null;
  if (!isRecord(v.input) || !isRecord(v.config) || !isRecord(v.result)) return null;
  if (!isRecord(v.result.pose) || !isRecord(v.result.orb)) return null;
  return v as unknown as ScanDiagnostics;
}

/**
 * Validate a run's `data` block into a {@link HarnessPosePayload}, or explain
 * why it is not one. The error text names the field that failed so a reviewer
 * can say which file is bad and how, rather than rendering `undefined`.
 */
export function parseHarnessPosePayload(body: unknown): HarnessRunParse {
  if (!isRecord(body)) return { ok: false, error: "The run payload is not an object." };
  if (typeof body.setupHash !== "string") {
    return { ok: false, error: "The run payload has no setupHash." };
  }
  if (!nullableString(body.groundTruthHash ?? null)) {
    return { ok: false, error: "The run payload has an invalid groundTruthHash." };
  }

  const scoring = parseScoring(body.scoring);
  if (scoring === false) return { ok: false, error: "The run payload has an invalid scoring block." };

  const diagnostics = parseDiagnostics(body.diagnostics);
  if (!diagnostics) {
    return { ok: false, error: "The run payload has an invalid diagnostics record." };
  }

  // Absent on every run written before the detector-attempt stream existed.
  let detectorAttempts: DetectorAttempt[] | undefined;
  if (body.detectorAttempts !== undefined && body.detectorAttempts !== null) {
    const parsed = parseAttempts(body.detectorAttempts);
    if (!parsed) return { ok: false, error: "The run payload has invalid detector attempts." };
    detectorAttempts = parsed;
  }

  const frames = parseFrames(body.frames);
  if (!frames) return { ok: false, error: "The run payload has invalid pose frames." };

  return {
    ok: true,
    payload: {
      setupHash: body.setupHash,
      groundTruthHash: (body.groundTruthHash as string | null | undefined) ?? null,
      scoring,
      diagnostics,
      ...(detectorAttempts !== undefined ? { detectorAttempts } : {}),
      frames,
    },
  };
}

/**
 * Parse a whole `<ts>_pose.json` file body — envelope and payload together.
 * This is what the single-run read path runs on the bytes it read off disk.
 */
export function parseRunFile(body: unknown): HarnessRunParse {
  const envelope = unwrapRunEnvelope(body);
  if (!envelope) return { ok: false, error: "The run file is not a JSON object." };
  return parseHarnessPosePayload(envelope.data);
}

// ---------------------------------------------------------------------------
// Harness client — the read seam over the dev route
// ---------------------------------------------------------------------------

/** List a Bundle's detection runs, newest first. Never carries frames. */
export async function listRuns(bundleKey: string): Promise<HarnessRunSummary[]> {
  const res = await fetch(`/api/dev/detections?key=${encodeURIComponent(bundleKey)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Failed to list detection runs.");
  return Array.isArray(body.runs) ? (body.runs as HarnessRunSummary[]) : [];
}

/** Load one detection run's full payload — frames, attempts and all. */
export async function loadRun(bundleKey: string, runTs: string): Promise<HarnessPosePayload> {
  const res = await fetch(
    `/api/dev/detections?key=${encodeURIComponent(bundleKey)}&run=${encodeURIComponent(runTs)}`,
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Failed to load the detection run.");
  const parsed = parseHarnessPosePayload(body.run);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.payload;
}
