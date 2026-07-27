/**
 * The climb window — where a Bundle's climb starts and ends — and the planning,
 * validation and framing the Mark-ends capture gesture runs on it (harness
 * ADR 0007 §4; the `harness-contract-adr0007-adoption` PRD, issue 02).
 *
 * The **start** needs no gesture: it is the setup tap's `t`, which the human
 * already gave at calibration. Only the **end** — a topout, or the point the
 * attempt is over — has to be captured explicitly, because nothing in the video
 * announces it. Absent means the window is open on that side, which is exactly
 * how the harness behaves today, so an unmarked Bundle is a to-do rather than an
 * error state.
 *
 * The marker is a **scoring** concept the harness applies; it never bounds this
 * scanner's seek loop, which would be a detection-behavior change.
 *
 * Framework-agnostic — no React imports.
 */

import {
  DETECTION_GRID_INTERVAL_MS,
  detectionFrameCount,
  detectionFrameTime,
  type DetectionGridFrame,
} from "@/utils/harnessDetectionGrid";

/** Grid index nearest `seconds`, computed in ms so float noise never rounds down. */
function nearestFrameIndex(seconds: number): number {
  return Math.round((seconds * 1000) / DETECTION_GRID_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Sweep planning — which Bundles still need a marker.
// ---------------------------------------------------------------------------

/** The per-Bundle facts the Mark-ends sweep plan gates on. */
export interface ClimbWindowCandidate {
  hasSetup: boolean;
  /** The setup tap's `t`, when the Scan Setup carries one. */
  climbStart?: number;
  /** The end-of-climb marker, when the Bundle has been marked. */
  climbEnd?: number;
}

/** The Mark-ends sweep plan: which Bundles the sweep walks, and what it skips. */
export interface ClimbEndPlan<T> {
  /** Bundles with a Scan Setup but no marker yet, in corpus-list order. */
  queue: T[];
  /** Bundles already carrying a marker — nothing to author. */
  marked: number;
  /** Bundles with no Scan Setup, so no climb start to validate a marker against. */
  skippedNoSetup: number;
  /** Every candidate considered. */
  total: number;
}

/**
 * Plan a Mark-ends sweep over the corpus listing. The queue is the marker
 * backlog: Bundles that have been set up but never marked. An already-marked
 * Bundle is done — revising one is a deliberate per-Bundle act in the
 * Calibrator, never something a sweep walks the operator back through.
 *
 * A Bundle without a Scan Setup is skipped rather than queued: the setup route
 * refuses a climb-end-only write with nothing to merge onto (422), so marking it
 * could not persist even if the operator picked a frame.
 */
export function planClimbEndSweep<T extends ClimbWindowCandidate>(
  items: readonly T[],
): ClimbEndPlan<T> {
  const queue: T[] = [];
  let marked = 0;
  let skippedNoSetup = 0;
  for (const item of items) {
    if (item.climbEnd !== undefined) marked += 1;
    else if (!item.hasSetup) skippedNoSetup += 1;
    else queue.push(item);
  }
  return { queue, marked, skippedNoSetup, total: items.length };
}

// ---------------------------------------------------------------------------
// Validation — the same rule the setup route and the harness endpoint enforce.
// ---------------------------------------------------------------------------

/** A candidate marker, accepted or refused with a reason the UI can show. */
export type ClimbEndCheck = { ok: true; value: number } | { ok: false; reason: string };

/**
 * Check a candidate end-of-climb marker against the climb start, mirroring
 * `parseClimbEndEdit` in `utils/harnessSetup` (and, through it, the harness
 * endpoint's own `climb_end > climb_start`, both ≥ 0).
 *
 * The UI checks before writing so a bad marker is refused **with a reason** at
 * the gesture rather than silently clamped into a window the operator never
 * chose — and so the round trip to a 422 is not the first the operator hears of
 * it. The server still re-checks; this never becomes the only guard.
 */
export function checkClimbEnd(seconds: number, climbStart?: number): ClimbEndCheck {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return { ok: false, reason: "The marker must be a time in the video." };
  }
  if (climbStart !== undefined && seconds <= climbStart) {
    return {
      ok: false,
      reason:
        `The climb ends after it starts — this frame is at or before the setup tap at ` +
        `${formatClipTime(climbStart)}. Scrub past it to mark the topout.`,
    };
  }
  return { ok: true, value: seconds };
}

// ---------------------------------------------------------------------------
// Framing — snapping a scrub position to the grid, and the film-strip window.
// ---------------------------------------------------------------------------

/** How far either side of the scrub position the confirmation strip reaches. */
export const CLIMB_END_STRIP_RADIUS_SEC = 2;

/**
 * The Detection Frame nearest `seconds`, clamped into the video's grid. The
 * marker is snapped because scoring is per Detection Frame: a marker between two
 * frames names a boundary no scored frame sits on, and the strip the operator
 * confirmed against is drawn from the same grid.
 *
 * Returns 0 for a video whose duration has not loaded (an empty grid).
 */
export function snapToDetectionFrame(seconds: number, durationSec: number): number {
  const count = detectionFrameCount(durationSec);
  if (count === 0) return 0;
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return detectionFrameTime(Math.min(count - 1, nearestFrameIndex(seconds)));
}

/** A slice of the Detection Frame grid around a scrub position. */
export interface DetectionFrameWindow {
  /** The frames in the window, in play order. */
  frames: DetectionGridFrame[];
  /** Grid index of `frames[0]`, so a caller can map back to absolute frames. */
  offset: number;
}

/**
 * The Detection Frames within `radiusSec` of `centerSec` — the confirmation
 * strip's contents. Deliberately a *local* window: thumbnailing a whole video is
 * hundreds of sequential seeks per Bundle, which at ninety Bundles is the
 * difference between a sitting and an afternoon. Forty-odd frames is enough to
 * tell a topout from the frame either side of it, which is all the marker needs.
 */
export function detectionFrameWindow(
  centerSec: number,
  durationSec: number,
  radiusSec: number = CLIMB_END_STRIP_RADIUS_SEC,
): DetectionFrameWindow {
  const count = detectionFrameCount(durationSec);
  if (count === 0) return { frames: [], offset: 0 };
  const center = Math.min(
    count - 1,
    Math.max(0, nearestFrameIndex(Number.isFinite(centerSec) ? centerSec : 0)),
  );
  const span = Math.max(0, nearestFrameIndex(radiusSec));
  const offset = Math.max(0, center - span);
  const end = Math.min(count - 1, center + span);
  const frames: DetectionGridFrame[] = [];
  for (let i = offset; i <= end; i += 1) frames.push({ timestamp: detectionFrameTime(i) });
  return { frames, offset };
}

// ---------------------------------------------------------------------------
// Labels.
// ---------------------------------------------------------------------------

/** `m:ss.d` — tenths kept because the marker lands on the 100 ms grid. */
export function formatClipTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** The label for an unmarked Bundle — a to-do, not an error. */
export const CLIMB_WINDOW_UNMARKED = "unmarked";

/**
 * The corpus column's label for a Bundle's climb window. An absent end reads
 * "unmarked" (distinct from a Bundle marked at the video's end, which shows its
 * time); an absent start — a Setup whose tap carries no `t` — reads `?`.
 */
export function formatClimbWindow(climbStart?: number, climbEnd?: number): string {
  if (climbEnd === undefined) return CLIMB_WINDOW_UNMARKED;
  const start = climbStart === undefined ? "?" : formatClipTime(climbStart);
  return `${start}–${formatClipTime(climbEnd)}`;
}
