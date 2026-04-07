/**
 * Pose estimation wrapper for MediaPipe Pose Landmarker.
 *
 * Accepts a canvas element (drawn from a video frame) and returns an array
 * of normalized keypoints with confidence scores, filtered by minScore.
 *
 * Includes a confidence-aware retry mechanism that progressively tightens the
 * crop when detection quality is poor, keeping the best result across attempts.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

import type { PoseBackend } from "@/utils/poseConstants";
import { estimateFrameMediaPipe } from "@/pipeline/mediapipePoseDetection";

export type { PoseBackend };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;

export interface Keypoint {
  /** Keypoint name (e.g. "left_wrist"). */
  name: string;
  /** X position normalized to [0, 1] relative to the frame width. */
  x: number;
  /** Y position normalized to [0, 1] relative to the frame height. */
  y: number;
  /** Model confidence score in [0, 1]. */
  score: number;
}

export interface PoseFrame {
  /** Video timestamp in seconds. */
  timestamp: number;
  /** Filtered keypoints for this frame. Empty if no pose was detected. */
  keypoints: Keypoint[];
}

/** Options for {@link estimateFrameWithRetry}. */
export interface RetryOptions {
  /** Mean confidence below which a tighter-crop retry is attempted. Default: 0.5. */
  retryThreshold?: number;
  /** Mean confidence below which the result is discarded entirely. Default: 0.3. */
  discardThreshold?: number;
  /** Maximum number of tighter-crop retries. Default: 2. */
  maxRetries?: number;
  /** Fraction to shrink the crop from each edge per retry (0–0.5). Default: 0.05 (5%). */
  shrinkStep?: number;
}

const DEFAULT_MIN_SCORE = 0.3;

// Retry defaults
const DEFAULT_RETRY_THRESHOLD  = 0.5;
const DEFAULT_DISCARD_THRESHOLD = 0.3;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_SHRINK_STEP = 0.05;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a PoseFrame for ranking competing detection results.
 * Higher is better. Combines keypoint count with average confidence.
 */
export function scorePoseFrame(frame: PoseFrame | null): number {
  if (!frame || frame.keypoints.length === 0) return 0;
  const avgScore = frame.keypoints.reduce((s, kp) => s + kp.score, 0) / frame.keypoints.length;
  return frame.keypoints.length * avgScore;
}

/**
 * Compute mean confidence across all keypoints in a PoseFrame.
 * Returns 0 for null frames or frames with no keypoints.
 */
export function meanConfidence(frame: PoseFrame | null): number {
  if (!frame || frame.keypoints.length === 0) return 0;
  return frame.keypoints.reduce((s, kp) => s + kp.score, 0) / frame.keypoints.length;
}

// ---------------------------------------------------------------------------
// Core estimation
// ---------------------------------------------------------------------------

/**
 * Run pose estimation on a single video frame using MediaPipe Pose Landmarker.
 *
 * @param detector  - The loaded MediaPipe PoseLandmarker instance.
 * @param canvas    - A canvas element containing the current video frame pixels.
 * @param timestamp - The video timestamp (seconds) this frame corresponds to.
 * @param _backend  - Ignored (only MediaPipe is supported). Kept for API compatibility.
 * @param minScore  - Keypoints below this confidence threshold are dropped.
 * @returns A PoseFrame, or null if no pose was detected.
 */
export async function estimateFrameUnified(
  detector: PoseDetector,
  canvas: HTMLCanvasElement,
  timestamp: number,
  _backend?: PoseBackend,
  minScore: number = DEFAULT_MIN_SCORE,
): Promise<PoseFrame | null> {
  return Promise.resolve(
    estimateFrameMediaPipe(detector, canvas, timestamp, minScore),
  );
}

// ---------------------------------------------------------------------------
// Confidence-aware retry
// ---------------------------------------------------------------------------

/**
 * Run pose estimation with automatic crop-refinement retries when confidence
 * is below the threshold.
 *
 * Strategy:
 *  1. Run initial detection on the provided canvas.
 *  2. If mean confidence ≥ retryThreshold → accept immediately.
 *  3. Otherwise, progressively shrink the canvas region by `shrinkStep` from
 *     each edge and re-run detection (up to `maxRetries` times).
 *  4. Track the best result by {@link scorePoseFrame}. Stop early if a retry
 *     produces fewer keypoints than the current best (diminishing returns).
 *  5. Accept the best result if its confidence ≥ discardThreshold; else null.
 *
 * The retry canvas is created once and reused across retries to avoid repeated
 * allocation. Keypoint coordinates from tighter crops are remapped back to the
 * original canvas coordinate space.
 *
 * @param detector  - The loaded PoseLandmarker.
 * @param canvas    - Full (or already-cropped) frame canvas.
 * @param timestamp - Video timestamp in seconds.
 * @param minScore  - Per-keypoint confidence floor.
 * @param opts      - Retry behaviour options.
 * @returns Best PoseFrame found, or null if all attempts are below discard threshold.
 */
export function estimateFrameWithRetry(
  detector: PoseDetector,
  canvas: HTMLCanvasElement,
  timestamp: number,
  minScore: number = DEFAULT_MIN_SCORE,
  opts: RetryOptions = {},
): PoseFrame | null {
  const retryThreshold  = opts.retryThreshold  ?? DEFAULT_RETRY_THRESHOLD;
  const discardThreshold = opts.discardThreshold ?? DEFAULT_DISCARD_THRESHOLD;
  const maxRetries       = opts.maxRetries       ?? DEFAULT_MAX_RETRIES;
  const shrinkStep       = opts.shrinkStep       ?? DEFAULT_SHRINK_STEP;

  // Initial attempt on the full canvas.
  const initial = estimateFrameMediaPipe(detector, canvas, timestamp, minScore);
  if (meanConfidence(initial) >= retryThreshold) return initial;

  let best = initial;
  let bestScore = scorePoseFrame(initial);

  // Retry with progressively tighter crops.
  let retryCanvas: HTMLCanvasElement | null = null;
  let retryCtx: CanvasRenderingContext2D | null = null;

  for (let r = 1; r <= maxRetries; r++) {
    const margin = shrinkStep * r; // cumulative shrink fraction per edge
    const srcX = Math.round(canvas.width * margin);
    const srcY = Math.round(canvas.height * margin);
    const srcW = Math.round(canvas.width * (1 - 2 * margin));
    const srcH = Math.round(canvas.height * (1 - 2 * margin));
    if (srcW < 32 || srcH < 32) break; // crop too small for meaningful detection

    // Lazy-allocate and reuse a single retry canvas.
    if (!retryCanvas) {
      retryCanvas = document.createElement("canvas");
      retryCtx = retryCanvas.getContext("2d");
      if (!retryCtx) break;
    }
    retryCanvas.width = srcW;
    retryCanvas.height = srcH;
    retryCtx!.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

    const retryResult = estimateFrameMediaPipe(detector, retryCanvas, timestamp, minScore);
    if (!retryResult) continue;

    // Remap keypoints from retry-crop coordinates back to original canvas space.
    const remapped: PoseFrame = {
      timestamp: retryResult.timestamp,
      keypoints: retryResult.keypoints.map(kp => ({
        ...kp,
        x: (kp.x * srcW + srcX) / canvas.width,
        y: (kp.y * srcH + srcY) / canvas.height,
      })),
    };

    const retryScore = scorePoseFrame(remapped);

    // Stop early if fewer keypoints detected than best — crop is too tight.
    if (remapped.keypoints.length < (best?.keypoints.length ?? 0)) break;

    if (retryScore > bestScore) {
      best = remapped;
      bestScore = retryScore;
    }

    // Good enough — stop retrying.
    if (meanConfidence(remapped) >= retryThreshold) break;
  }

  // Accept the best result only if it clears the discard threshold.
  if (meanConfidence(best) >= discardThreshold) return best;
  return null;
}
