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
 * How many Detection Frames a video of `durationSec` seconds has — the length
 * {@link buildDetectionGrid} returns, without materialising it. Callers that
 * only need to bound a grid index (snapping a marker, windowing a film strip)
 * read this rather than allocating thousands of frames per keystroke.
 *
 * Zero for a duration that is not a usable number, matching the empty grid.
 */
export function detectionFrameCount(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec < 0) return 0;
  return (
    Math.floor((durationSec * 1000 + DURATION_EPSILON_MS) / DETECTION_GRID_INTERVAL_MS) + 1
  );
}

/** The timestamp of Detection Frame `index`, in seconds. */
export function detectionFrameTime(index: number): number {
  return (index * DETECTION_GRID_INTERVAL_MS) / 1000;
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
  const count = detectionFrameCount(durationSec);
  const frames: DetectionGridFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    frames.push({ timestamp: detectionFrameTime(i) });
  }
  return frames;
}

/**
 * Tolerance (ms) for calling a run's probe time a grid timestamp. The seek loop
 * probes at the same `i × 100 ms` arithmetic the grid is built from, so an
 * aligned frame is exact up to float noise; a millisecond of slack absorbs a
 * video element that reports a seeked position back a hair off the requested one
 * without ever admitting a frame from a neighbouring stride.
 */
const ON_GRID_TOLERANCE_MS = 1;

/** True when `timestampSec` lands on a Detection Frame stride (within 1 ms). */
export function isOnDetectionGrid(timestampSec: number): boolean {
  if (!Number.isFinite(timestampSec) || timestampSec < 0) return false;
  const ms = timestampSec * 1000;
  const offset = ms % DETECTION_GRID_INTERVAL_MS;
  const distance = Math.min(offset, DETECTION_GRID_INTERVAL_MS - offset);
  return distance <= ON_GRID_TOLERANCE_MS;
}

/** How many of a run's Detection Frames land on the grid. */
export interface GridAlignment {
  total: number;
  onGrid: number;
  offGrid: number;
  /** The off-grid probe times, for surfacing which frames drifted. */
  offGridTimestamps: number[];
}

/**
 * Classify a detection run's probe times against the Detection Frame grid.
 *
 * Every frame the production seek loop can probe — base samples at any tier
 * stride and Adaptive Refinement re-probes alike — is computed as `i × 100 ms`,
 * so a healthy run is entirely on-grid and pairs with Ground Truth by exact
 * set-intersection. A non-zero `offGrid` count means that arithmetic no longer
 * holds and the run's frames can never be scored against stored truth, so the
 * harness surfaces it rather than letting the misalignment score as `missing`.
 */
export function summarizeGridAlignment(frames: readonly { timestamp: number }[]): GridAlignment {
  const offGridTimestamps = frames.map((f) => f.timestamp).filter((t) => !isOnDetectionGrid(t));
  return {
    total: frames.length,
    onGrid: frames.length - offGridTimestamps.length,
    offGrid: offGridTimestamps.length,
    offGridTimestamps,
  };
}
