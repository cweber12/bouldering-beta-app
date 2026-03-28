/**
 * Browser File System Access API helpers shared across pages.
 *
 * Provides typed wrappers for directory listing and attempt file loading.
 * All functions gracefully handle the absence of FSAPI by returning empty arrays
 * or falling back — callers should guard with `"showDirectoryPicker" in window`.
 */

import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FSDir = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle & { kind: string; name: string }>;
};

export interface AttemptEntry {
  /** JSON file name, e.g. "attempt-1234567890.json" */
  name: string;
  /** Human-readable date/time label derived from the embedded timestamp. */
  label: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitise a string for use as a directory or file path segment.
 * Strips characters invalid in Windows/macOS/Linux paths and returns
 * "Unknown" when the result would be empty.
 */
export function sanitizeDirName(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*]/g, "_") || "Unknown";
}

/**
 * Format an attempt filename as a human-readable date/time string.
 * Falls back to the raw filename when no timestamp can be parsed.
 */
export function attemptTimestampLabel(fileName: string): string {
  const m = fileName.match(/attempt-(\d+)\.json/);
  if (!m) return fileName;
  return new Date(parseInt(m[1], 10)).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** List all sub-directory names inside a directory handle, sorted alphabetically. */
export async function listDirectories(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of (dir as FSDir).values()) {
    if (entry.kind === "directory") names.push(entry.name);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/**
 * List all attempt JSON files in a directory, sorted newest-first by
 * the timestamp embedded in the filename.
 */
export async function listAttemptFiles(dir: FileSystemDirectoryHandle): Promise<AttemptEntry[]> {
  const entries: AttemptEntry[] = [];
  for await (const entry of (dir as FSDir).values()) {
    if (entry.kind === "file" && entry.name.endsWith(".json")) {
      entries.push({ name: entry.name, label: attemptTimestampLabel(entry.name) });
    }
  }
  return entries.sort((a, b) => {
    const ta = parseInt(a.name.match(/(\d+)/)?.[1] ?? "0", 10);
    const tb = parseInt(b.name.match(/(\d+)/)?.[1] ?? "0", 10);
    return tb - ta;
  });
}

/**
 * Return a JSON-safe copy of a RouteAttempt.
 *
 * Converts `orbFeatures.descriptors` from `Uint8Array` to a plain `number[]`
 * so `JSON.stringify` can handle it.
 */
export function serializeAttemptForJson(
  attempt: RouteAttempt,
): Record<string, unknown> {
  return {
    ...attempt,
    orbFeatures: attempt.orbFeatures
      ? { ...attempt.orbFeatures, descriptors: Array.from(attempt.orbFeatures.descriptors) }
      : null,
  };
}

/**
 * Deserialise a raw JSON value into a RouteAttempt.
 *
 * Re-hydrates the `orbFeatures.descriptors` field from a plain number array
 * (as serialised to JSON) back to a `Uint8Array`.
 *
 * @throws When the input is not a non-null object.
 */
export function loadAttemptFromJson(raw: unknown): RouteAttempt {
  if (!raw || typeof raw !== "object") throw new Error("Invalid attempt data.");
  const obj = raw as Record<string, unknown>;
  if (obj.orbFeatures && typeof obj.orbFeatures === "object") {
    const orb = obj.orbFeatures as Record<string, unknown>;
    if (Array.isArray(orb.descriptors)) {
      orb.descriptors = new Uint8Array(orb.descriptors as number[]);
    }
  }
  return { state: "", area: "", route: "", ...obj } as unknown as RouteAttempt;
}
