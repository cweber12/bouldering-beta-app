/**
 * Parse and format the epoch-millisecond timestamp embedded in a run identifier.
 *
 * Accepts the current `run-{ms}` id, the legacy `attempt-{ms}` id, and the
 * `.json` filename variants (`run-{ms}-{type}.json`, `attempt-{ms}.json`).
 * Returns separate `date` and `time` strings so callers can lay them out
 * independently, or `null` when no timestamp can be parsed.
 */

export interface RunTimestampParts {
  /** e.g. "May 30, 2026" */
  date: string;
  /** e.g. "4:50 PM" */
  time: string;
}

/** Extract the epoch-ms timestamp from a run/attempt id or filename. */
export function runTimestampMs(idOrName: string): number | null {
  const m = idOrName.match(/(?:run|attempt)-(\d+)/);
  if (!m) return null;
  const ms = parseInt(m[1], 10);
  return Number.isNaN(ms) ? null : ms;
}

/** Format a run id/filename into clean `date` + `time` parts, or null. */
export function formatRunTimestamp(idOrName: string): RunTimestampParts | null {
  const ms = runTimestampMs(idOrName);
  if (ms == null) return null;
  const d = new Date(ms);
  return {
    date: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}
