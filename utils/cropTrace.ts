/**
 * Dev-only per-frame crop trace for the detection eval harness.
 *
 * One entry per crop event the seek loop touches while scanning a **Test Video**:
 * the **Adaptive Crop** search region fed to MediaPipe, the tight landmark box
 * derived from the pose it found, and flags for the full-frame re-acquire and
 * **Adaptive Refinement** paths. Consumed by the harness **Detection Preview**
 * (via `FramePlayer`) to draw the crops used in detection.
 *
 * This is dev-machine-only review data — it is deliberately NOT part of
 * `RouteAttempt`, so it never rides to S3 through `fsHelpers`. It mirrors the
 * `scanDiagnostics` pattern: produced under `DIAGNOSTICS_ENABLED`, exposed as a
 * `useVideoProcessor` return value, and gone on reload.
 *
 * Plain data — no React imports.
 */

import type { CropBox } from "@/pipeline/tracking/cropDetector";

/** One crop event, in full-frame video-pixel space, keyed by real video time. */
export interface CropTraceEntry {
  /** Video timestamp in seconds (real video time, not playback-logical time). */
  timestamp: number;
  /**
   * Index this entry came from: the sampled frame index for main-loop rows, or
   * the `allTimestamps` index for an **Adaptive Refinement** row. Informational.
   */
  frameIndex: number;
  /** Whether a Climber pose was accepted on this frame. */
  detected: boolean;
  /** The Adaptive Crop search region missed, so a full-frame re-acquire ran. */
  reacquired: boolean;
  /** This row was produced by the **Adaptive Refinement** pass (full-frame). */
  refinement: boolean;
  /**
   * The Adaptive Crop region fed to the detector, in video pixels. Null means
   * the whole frame was searched (first-acquisition fallback or Refinement).
   */
  searchRegion: CropBox | null;
  /**
   * The tight landmark box (`deriveClimberCrop`) of the accepted pose, in video
   * pixels. Null on a miss (no pose to derive it from).
   */
  landmarkBox: CropBox | null;
}

/** A whole scan's crop events, sorted ascending by `timestamp`. */
export type CropTrace = CropTraceEntry[];
