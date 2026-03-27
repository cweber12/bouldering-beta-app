/**
 * In-memory session store backed by a Map.
 *
 * Holds route attempt data for the current browser session — no persistence.
 * The IndexedDB layer will be added in a later commit; consumers should import
 * from this module only, so the storage backend stays swappable.
 */

import type { PoseFrame } from "@/pipeline/poseDetection";
import type { OrbFeatures, OrbMatch } from "@/pipeline/orbDetector";
import type { CropBox } from "@/pipeline/cropDetector";
export type { OrbKeypoint, OrbFeatures, OrbMatch } from "@/pipeline/orbDetector";
export type { CropBox } from "@/pipeline/cropDetector";

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

export interface RouteAttempt {
  id: string;
  videoMeta: VideoMeta;
  /** Processed pose frames in chronological order. */
  frames: PoseFrame[];
  /**
   * ORB features extracted from the reference frame (frame 0 by default).
   * Null when ORB extraction was skipped or failed.
   */
  orbFeatures: OrbFeatures | null;
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
  /**
   * For outdoor mode: one FrameCapture per frame on which pose detection was
   * actually executed (every N-th sampled frame). Null for indoor mode.
   */
  frameCaptures: FrameCapture[] | null;
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
