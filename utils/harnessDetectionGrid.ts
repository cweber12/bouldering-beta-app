/**
 * The Detection Frame grid — the timestamps a Test Video's Ground Truth is
 * authored on. Computed by pure arithmetic from the video's duration at a
 * uniform 100 ms stride, so the grid is video-keyed: independent of the Scan
 * Setup, the Quality Tier, and above all the detector under test.
 *
 * This is why the stride is uniform. The production seek loop probes at
 * `i × 100 ms` for every tier and every adaptive refinement re-probe, so any
 * run's frames land on grid timestamps by construction and pair with truth by
 * exact set-intersection. A grid derived from one detector's probe times could
 * never be re-probed by a later detector version, and those Ground Truth frames
 * would score `missing` forever (ADR 0018).
 *
 * Framework-agnostic — no React imports.
 */

/** Detection Frame stride. Matches the production seek loop's base interval. */
export const DETECTION_GRID_INTERVAL_MS = 100;

/**
 * Absolute-video-time tolerance (ms) applied when deciding whether the duration
 * reaches the final grid frame. A duration that is a 100 ms multiple in intent
 * can arrive a hair short as a float (2.9999999 for 3 s), which would drop the
 * final frame; a microsecond of slack keeps the grid deterministic without ever
 * inventing a frame past the end of the video.
 */
const DURATION_EPSILON_MS = 1e-3;

/** One Detection Frame: a video timestamp in seconds. */
export interface DetectionGridFrame {
  timestamp: number;
}

/**
 * The Detection Frame grid for a video of `durationSec` seconds: `i × 100 ms`
 * for `i = 0 … floor(duration / 100 ms)`, inclusive of the final frame when the
 * duration lands on a stride boundary. Deterministic for a given duration.
 *
 * Returns an empty grid for a duration that is not a usable number (unloaded
 * metadata reports `NaN`), so callers can gate on `length` rather than guarding
 * the video element themselves.
 */
export function buildDetectionGrid(durationSec: number): DetectionGridFrame[] {
  if (!Number.isFinite(durationSec) || durationSec < 0) return [];
  const lastIndex = Math.floor(
    (durationSec * 1000 + DURATION_EPSILON_MS) / DETECTION_GRID_INTERVAL_MS,
  );
  const frames: DetectionGridFrame[] = [];
  for (let i = 0; i <= lastIndex; i += 1) {
    frames.push({ timestamp: (i * DETECTION_GRID_INTERVAL_MS) / 1000 });
  }
  return frames;
}
