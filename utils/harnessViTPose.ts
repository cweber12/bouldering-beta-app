/**
 * ViTPose++ scaffold — the reference-model poses the downloader produces per
 * Test Video (ADR 0019). Loaded from the bundle's `vitpose.json` and remapped
 * into the harness `PoseFrame` shape so it can seed Ground Truth authoring in
 * place of the throwaway MediaPipe scaffold. The human still owns the truth;
 * ViTPose is only a better starting guess — a stronger, independent reference
 * model than the detector under test, which breaks the self-reference on
 * unverified frames.
 *
 * Framework-agnostic — no React imports. Used by the calibration page (client)
 * and the dev proxy (server), and unit-tested without a canvas.
 */

import type { CropFraction } from "@/utils/cropFraction";
import type { Keypoint, PoseFrame } from "@/pipeline/pose/poseDetection";

/** Bumped only on a breaking change to the `vitpose.json` shape. */
export const VITPOSE_VERSION = 1;

/**
 * One ViTPose keypoint: named (COCO/Halpe topology), video-normalized [0, 1],
 * with the model's per-keypoint confidence. The core body joints (nose + the
 * twelve limb joints) share names with MediaPipe/BlazePose, so the remap is
 * near-identity — but names are carried explicitly so the downloader's topology
 * can evolve without touching the harness.
 */
export interface ViTPoseKeypoint {
  /** COCO/Halpe keypoint name (e.g. "left_wrist"). */
  name: string;
  /** X position normalized to [0, 1] relative to the frame width. */
  x: number;
  /** Y position normalized to [0, 1] relative to the frame height. */
  y: number;
  /** Model confidence in [0, 1] — feeds the occluded/needs-review seed. */
  score: number;
}

/** ViTPose poses for one Detection Frame, keyed by video timestamp. */
export interface ViTPoseFrame {
  /** Video timestamp in seconds — matched to a Detection Frame within epsilon. */
  timestamp: number;
  /** The Climber's keypoints; empty when the tracker had no box here. */
  keypoints: ViTPoseKeypoint[];
}

/** The `vitpose.json` bundle artifact the downloader writes (ADR 0019). */
export interface ViTPoseScaffold {
  version: number;
  /**
   * Scan Setup hash the downloader seeded this scaffold from. Legacy artifacts
   * may omit it; the harness then falls back to the setup save response.
   */
  setupHash?: string;
  frames: ViTPoseFrame[];
}

/**
 * The Climber selection beta-scanner sends to start a ViTPose job. The
 * downloader tracks the Climber from `climberPoint` and poses the track's box.
 * This is the cross-program request contract (ADR 0019); keep it in sync with
 * the downloader's endpoint.
 */
export interface ViTPoseRequest {
  /** External-API relative path to the Test Video (from `relativeVideoPath`). */
  videoPath: string;
  /** Tap that seeds Climber Identity, video-normalized; may be absent. */
  climberPoint?: { x: number; y: number; t?: number };
  /** Climber Crop — the first-acquisition search region. */
  climberCrop: CropFraction;
  /** Wall Crop — carried for parity with Scan Setup, unused by pose. */
  wallCrop: CropFraction;
  /** Fixed vs Panning Capture flag. */
  panning: boolean;
  /**
   * The exact Detection Frame timestamps (seconds) to pose. The downloader must
   * emit one `vitpose.json` frame per entry, **echoing the same timestamp value**
   * so beta-scanner matches the seed frame-for-frame (ADR 0019). Not a denser
   * grid — one ViTPose frame per Detection Frame.
   */
  frames: { timestamp: number }[];
}

/**
 * ViTPose keypoint names that differ from the MediaPipe/BlazePose name for the
 * same anatomical joint. The core joint set coincides, so this is empty today;
 * it exists as the single place to reconcile a divergent head anchor or a
 * Halpe-26 rename without editing call sites.
 */
export const VITPOSE_TO_MP_NAME: Record<string, string> = {};

/** Remap one ViTPose keypoint into the harness `Keypoint` shape (MP names). */
function toKeypoint(k: ViTPoseKeypoint): Keypoint {
  return { name: VITPOSE_TO_MP_NAME[k.name] ?? k.name, x: k.x, y: k.y, score: k.score };
}

/**
 * Convert a ViTPose scaffold into the `PoseFrame[]` the Ground Truth scaffold
 * builder consumes. Names are remapped to MediaPipe topology; positions and
 * confidence pass through (confidence becomes the occlusion seed downstream).
 */
export function viTPoseToPoseFrames(scaffold: ViTPoseScaffold): PoseFrame[] {
  return scaffold.frames.map((f) => ({
    timestamp: f.timestamp,
    keypoints: f.keypoints.map(toKeypoint),
  }));
}

/**
 * True when the scaffold posed at least one frame — i.e. the downloader's
 * tracker actually found the Climber. An all-empty scaffold is a tracker miss,
 * not 48 genuinely-absent frames, so the harness disables authoring rather than
 * seeding every Detection Frame "absent".
 */
export function scaffoldHasPose(scaffold: ViTPoseScaffold): boolean {
  return scaffold.frames.some((f) => f.keypoints.length > 0);
}

/**
 * The terminal message for a landed-but-poseless scaffold. When the job sidecar
 * reports `seedFound: false` the cause is pinpointed — the tracker ran but no
 * tracked person ever matched the Climber tap — so the message names the remedy
 * (re-tap) instead of the symptom. Null/absent keeps the generic message.
 */
export function noClimberMessage(seedFound: boolean | null): string {
  return seedFound === false
    ? "ViTPose matched no tracked person to the Climber tap — re-tap the Climber (position and frame time) in the calibrator, then re-run."
    : "ViTPose tracked no climber.";
}

// ---------------------------------------------------------------------------
// Validation — the proxy trusts nothing it reads back from the bundle file.
// ---------------------------------------------------------------------------

/** Hard cap on frames, mirroring the Ground Truth bound. */
const MAX_FRAMES = 100_000;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseKeypoint(v: unknown): ViTPoseKeypoint | null {
  if (typeof v !== "object" || v === null) return null;
  const k = v as Record<string, unknown>;
  if (typeof k.name !== "string" || k.name.length === 0) return null;
  if (!isFiniteNumber(k.x) || !isFiniteNumber(k.y) || !isFiniteNumber(k.score)) return null;
  return { name: k.name, x: k.x, y: k.y, score: k.score };
}

function parseFrame(v: unknown): ViTPoseFrame | null {
  if (typeof v !== "object" || v === null) return null;
  const f = v as Record<string, unknown>;
  if (!isFiniteNumber(f.timestamp) || f.timestamp < 0) return null;
  if (!Array.isArray(f.keypoints)) return null;
  const keypoints: ViTPoseKeypoint[] = [];
  for (const raw of f.keypoints) {
    const kp = parseKeypoint(raw);
    if (!kp) return null;
    keypoints.push(kp);
  }
  return { timestamp: f.timestamp, keypoints };
}

/**
 * Validate an untrusted `vitpose.json` body into a {@link ViTPoseScaffold}, or
 * null when malformed. Shared by the proxy GET and the tests.
 */
export function parseViTPoseScaffold(body: unknown): ViTPoseScaffold | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!Number.isInteger(b.version)) return null;
  if (b.setupHash !== undefined && typeof b.setupHash !== "string") return null;
  if (!Array.isArray(b.frames) || b.frames.length > MAX_FRAMES) return null;
  const frames: ViTPoseFrame[] = [];
  for (const raw of b.frames) {
    const frame = parseFrame(raw);
    if (!frame) return null;
    frames.push(frame);
  }
  return {
    version: b.version as number,
    ...(typeof b.setupHash === "string" && b.setupHash.length > 0
      ? { setupHash: b.setupHash }
      : {}),
    frames,
  };
}

// ---------------------------------------------------------------------------
// Harness client — start a ViTPose job, then poll the bundle for its artifact.
// ---------------------------------------------------------------------------

/**
 * Kick off the downloader's ViTPose job for a bundle. Resolves once the job is
 * accepted (202); the artifact is fetched later via {@link loadViTPose}.
 */
export async function requestViTPoseScaffold(
  bundleKey: string,
  req: ViTPoseRequest,
): Promise<void> {
  const res = await fetch(`/api/dev/corpus/vitpose?key=${encodeURIComponent(bundleKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to start the ViTPose job.");
  }
}

/**
 * How long the harness polls for the artifact before giving up. A generous
 * backstop for a downloader that dies silently *without* writing an error
 * sidecar; a reported failure short-circuits well before this (ADR 0019).
 */
export const VITPOSE_POLL_TIMEOUT_MS = 10 * 60_000;

/** One poll of the bundle: the artifact once written, or a terminal job error. */
export interface ViTPosePollResult {
  /** The scaffold once the job has written it; null while pending or failed. */
  scaffold: ViTPoseScaffold | null;
  /** Non-null when the downloader reported the job failed after acceptance. */
  error: string | null;
  /** Non-fatal downloader advisories about the Climber selection (a legacy tap
   * with no timestamp, or an ambiguous `t=0` tap). Empty when the run was clean. */
  warnings: string[];
  /** The job sidecar's `seedDebug.seedFound`: false when the tracker matched no
   * person to the Climber tap (the artifact lands poseless). Null when the
   * sidecar is absent or predates the field. */
  seedFound: boolean | null;
}

/**
 * Read back the bundle's ViTPose scaffold. `scaffold` is null while the job is
 * still running (no artifact yet); `error` is non-null when the downloader
 * reported a terminal failure via its status sidecar. Callers poll until one of
 * the two is set (or the {@link VITPOSE_POLL_TIMEOUT_MS} backstop fires).
 */
export async function loadViTPose(bundleKey: string): Promise<ViTPosePollResult> {
  const res = await fetch(`/api/dev/corpus/vitpose?key=${encodeURIComponent(bundleKey)}`);
  if (!res.ok) throw new Error("Failed to load the ViTPose scaffold.");
  const body = await res.json();
  return {
    scaffold: (body.vitpose as ViTPoseScaffold | null) ?? null,
    error: (body.error as string | null) ?? null,
    warnings: Array.isArray(body.warnings)
      ? (body.warnings as unknown[]).filter(
          (w): w is string => typeof w === "string" && w.length > 0,
        )
      : [],
    seedFound: typeof body.seedFound === "boolean" ? (body.seedFound as boolean) : null,
  };
}
