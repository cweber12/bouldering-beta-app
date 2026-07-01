/**
 * In-memory session store backed by a Map.
 *
 * Holds route attempt data for the current browser session — no persistence.
 * The IndexedDB layer will be added in a later commit; consumers should import
 * from this module only, so the storage backend stays swappable.
 */

import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import type { OrbFeatures, OrbMatch, KeyframeFeatures } from "@/pipeline/matching/orbDetector";
import type { CropBox } from "@/pipeline/tracking/cropDetector";
import type { PoseBackend } from "@/utils/poseConstants";
import type { ReferenceFrameMeta } from "@/pipeline/analysis/diagnostics";
export type { OrbKeypoint, OrbFeatures, OrbMatch, KeyframeFeatures } from "@/pipeline/matching/orbDetector";
export type { CropBox } from "@/pipeline/tracking/cropDetector";
export type { PoseBackend } from "@/utils/poseConstants";

export interface VideoMeta {
  /** Original filename. */
  name: string;
  /** Duration in seconds. */
  duration: number;
  /** Frames per second (may be approximate). */
  fps: number;
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
}

/**
 * Metadata about a single frame that had pose detection executed on it.
 * Stored for outdoor mode to record which frames were sampled and what
 * crop was applied.
 */
export interface FrameCapture {
  /** 0-based index into the sampled frame sequence. */
  frameIndex: number;
  /** Video timestamp in seconds for this frame. */
  timestamp: number;
  /**
   * Crop applied before pose detection.
   * Null for the first outdoor frame (full frame was used) or in indoor mode.
   */
  cropBox: CropBox | null;
}

/** Whether this run was a climbing attempt or a successful send. */
export type RunType = "attempt" | "send";

/**
 * A **Hold** authored on the Detection Preview at scan time and persisted with
 * the Run (Fixed Capture only). Stored in **normalized [0,1] video-frame space**
 * so it is resolution-independent and projects onto the Route Photo through the
 * same homography the on-the-fly path uses (see ADR 0009).
 *
 * Deliberately carries no `order`/`id`: the printed rank is always re-derived
 * from first-use order on load, so adding or removing a Hold renumbers the rest
 * automatically.
 */
export interface StoredHold {
  /** Normalized [0,1] x in video-frame space. */
  x: number;
  /** Normalized [0,1] y in video-frame space. */
  y: number;
  /** Which limb kind used it — pairs with `side` to drive the marker colour/glyph. */
  kind: "hand" | "foot";
  /**
   * Which side's limb used it. Optional for backward compatibility: legacy
   * authored Holds predate this field and default to `"right"` on load.
   */
  side?: "left" | "right";
  /** Absolute video time (seconds) the Climber first used this Hold. */
  firstUseTime: number;
}

export interface RouteAttempt {
  id: string;
  videoMeta: VideoMeta;
  /** Processed pose frames in chronological order. */
  frames: PoseFrame[];
  /**
   * Which pose-detection backend produced the frames.
   * Only "mediapipe" is supported. Legacy data defaults to "mediapipe".
   */
  poseBackend?: PoseBackend;
  /**
   * ORB features extracted from the reference frame (frame 0 by default).
   * Null when ORB extraction was skipped or failed.
   */
  orbFeatures: OrbFeatures | null;
  /**
   * Panning Capture only: ordered ORB **Keyframe** feature sets (Wall Crop,
   * one per ~0.5–1 s of pan), each tagged with its video timestamp. The Route
   * Photo is matched to each Keyframe independently to stay drift-free.
   *
   * Absent/null for Fixed Capture, which uses the single frame-0 `orbFeatures`.
   * Legacy attempts predate this field and load with it undefined.
   */
  keyframes?: KeyframeFeatures[] | null;
  /**
   * Per-frame ORB match results against the reference frame.
   * Index aligns with the `frames` array. Frame 0 (reference) is always [].
   * Null when matching was not run.
   */
  matchesPerFrame: OrbMatch[][] | null;
  /** User-supplied location metadata used for device folder organisation. */
  state: string;
  area: string;
  route: string;
  /** Classifies the run as an attempt (did not top) or a send (topped). */
  runType: RunType;
  /** Optional difficulty grade (e.g. "V3", "5.10a"). */
  rating?: string;
  /** Optional freeform notes about the run. */
  notes?: string;
  /**
   * **Holds** authored on the Detection Preview at scan time, in normalized
   * [0,1] video space (Fixed Capture only). When present they win over the
   * on-the-fly `detectHolds` path on every Holds surface; when absent (every
   * legacy Run, every Panning Capture Run) the on-the-fly path is used. See
   * ADR 0009.
   */
  holds?: StoredHold[];
  /**
   * Scaled-down PNG data URL of the middle video frame with ORB keypoints
   * drawn as green dots. Used as a preview thumbnail in the route picker.
   */
  thumbnail?: string;
  /**
   * For outdoor mode: one FrameCapture per frame on which pose detection was
   * actually executed (every N-th sampled frame). Null for indoor mode.
   */
  frameCaptures: FrameCapture[] | null;
  /** GPS coordinates tagged at upload time. Optional. */
  coordinates?: { lat: number; lng: number };
  /**
   * Reference Frame Metadata — the frame-0 condition stats + ORB keypoint count,
   * written at scan time so it travels with the reference ORB features in S3 and
   * can be read back at match time to build a Match Diagnostics record. Optional:
   * legacy attempts predate it and load without it.
   */
  referenceFrameMeta?: ReferenceFrameMeta;
  /**
   * SHA-256 content hash of the source video, computed once at scan time. Stored
   * so a Match Diagnostics record (built at match time, possibly from an attempt
   * reloaded from S3 with no video File in hand) can stay keyed to the video.
   * Optional: legacy attempts predate it.
   */
  videoHash?: string;
}

// Module-level store — shared across all hook/component instances.
const store = new Map<string, RouteAttempt>();
const MAX_ENTRIES = 10;

/** Save (or overwrite) a route attempt. Evicts the oldest entry when full. */
export function saveAttempt(attempt: RouteAttempt): void {
  store.set(attempt.id, attempt);
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

/** Retrieve a route attempt by ID. Returns undefined if not found. */
export function getAttempt(id: string): RouteAttempt | undefined {
  return store.get(id);
}

/** Return all stored attempt IDs. */
export function listAttemptIds(): string[] {
  return Array.from(store.keys());
}

/** Delete an attempt by ID. No-op if the ID does not exist. */
export function deleteAttempt(id: string): void {
  store.delete(id);
}

/** Clear everything — useful for testing. */
export function clearStore(): void {
  store.clear();
}
