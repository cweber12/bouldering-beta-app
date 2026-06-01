/**
 * Browser File System Access API helpers shared across pages.
 *
 * Provides typed wrappers for directory listing and attempt file loading.
 * All functions gracefully handle the absence of FSAPI by returning empty arrays
 * or falling back — callers should guard with `"showDirectoryPicker" in window`.
 */

import type { RouteAttempt, RunType } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FSDir = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle & { kind: string; name: string }>;
};

export interface AttemptEntry {
  /** JSON file name, e.g. "run-1234567890-attempt.json" */
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
 * Format a run filename as a human-readable date/time string.
 * Handles both legacy `attempt-{ts}.json` and current `run-{ts}-{type}.json`.
 * Falls back to the raw filename when no timestamp can be parsed.
 */
export function attemptTimestampLabel(fileName: string): string {
  // New format: run-{timestamp}-{attempt|send}.json
  const m2 = fileName.match(/run-(\d+)(?:-\w+)?\.json/);
  if (m2) {
    return new Date(parseInt(m2[1], 10)).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  // Legacy format: attempt-{timestamp}.json
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

/**
 * Extract the run type ("attempt" or "send") from a filename.
 * Returns "attempt" as the default for legacy filenames or when the type
 * segment cannot be parsed.
 */
export function parseRunType(fileName: string): RunType {
  const m = fileName.match(/run-\d+-(\w+)\.json/);
  if (m && (m[1] === "attempt" || m[1] === "send")) return m[1];
  return "attempt";
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

// ---------------------------------------------------------------------------
// Binary <-> base64 (browser-safe, chunked to avoid call-stack limits on large
// arrays). ORB descriptors are stored base64-encoded (~1.33x) rather than as a
// JSON number[] (~4x) — see the save-payload split.
// ---------------------------------------------------------------------------

const B64_CHUNK = 0x8000; // 32 KiB per String.fromCharCode call

/** Encode a Uint8Array as a base64 string. */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(binary);
}

/** Decode a base64 string back into a Uint8Array. */
export function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Schema version stamped onto the metadata object of a split-format attempt.
 * v2 = metadata object + sibling `.data.json` holding frames/matches/descriptors.
 * Legacy (v1, undefined) = single combined object with everything inline.
 */
export const ATTEMPT_SCHEMA_VERSION = 2;

/** Keys whose values are "heavy" and live in the sibling `.data.json` object. */
const HEAVY_KEYS = ["frames", "matchesPerFrame", "frameCaptures", "orbFeatures"] as const;

/**
 * Maximum length for user-supplied route metadata text fields (state, area,
 * route, rating, notes). Aligned with the server-side `PROFILE_TEXT_LIMIT`
 * (`app/api/s3/shared.ts`); kept local so this client-safe util never imports
 * the server-only S3 module.
 */
export const ROUTE_TEXT_LIMIT = 500;

/** Route metadata fields that carry user-supplied free text and must be clamped. */
const ROUTE_TEXT_KEYS = ["state", "area", "route", "rating", "notes"] as const;

/** Trim and clamp a free-text field to {@link ROUTE_TEXT_LIMIT}; pass through non-strings. */
function clampRouteText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.trim().slice(0, ROUTE_TEXT_LIMIT);
}

/**
 * Return a JSON-safe copy of a RouteAttempt as a single combined object
 * (legacy v1 format). Converts `orbFeatures.descriptors` from `Uint8Array` to a
 * plain `number[]`. Retained for local file import/export round-trips; the S3
 * save path uses the split serialisers below.
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
 * Serialise the small, queryable metadata of an attempt (everything the route
 * picker / climb list / detail views read). Heavy fields are excluded — they go
 * in the sibling object produced by {@link serializeAttemptData}.
 */
export function serializeAttemptMetadata(
  attempt: RouteAttempt,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { schemaVersion: ATTEMPT_SCHEMA_VERSION };
  for (const [k, v] of Object.entries(attempt)) {
    if (HEAVY_KEYS.includes(k as (typeof HEAVY_KEYS)[number])) continue;
    meta[k] = ROUTE_TEXT_KEYS.includes(k as (typeof ROUTE_TEXT_KEYS)[number])
      ? clampRouteText(v)
      : v;
  }
  return meta;
}

/**
 * Serialise the heavy fields of an attempt (dense frames, per-frame matches,
 * frame captures, ORB features). `descriptors` is base64-encoded.
 */
export function serializeAttemptData(
  attempt: RouteAttempt,
): Record<string, unknown> {
  return {
    frames: attempt.frames,
    matchesPerFrame: attempt.matchesPerFrame,
    frameCaptures: attempt.frameCaptures,
    orbFeatures: attempt.orbFeatures
      ? { ...attempt.orbFeatures, descriptors: uint8ToBase64(attempt.orbFeatures.descriptors) }
      : null,
  };
}

/**
 * Deserialise a raw JSON value into a RouteAttempt.
 *
 * Accepts both formats:
 *  - legacy combined object (everything inline, `descriptors` as `number[]`)
 *  - a v2 metadata + data object already merged (`descriptors` as base64 string)
 *
 * Re-hydrates `orbFeatures.descriptors` back to a `Uint8Array` from whichever
 * encoding is present.
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
    } else if (typeof orb.descriptors === "string") {
      orb.descriptors = base64ToUint8(orb.descriptors);
    }
  }
  return { state: "", area: "", route: "", runType: "attempt", ...obj } as unknown as RouteAttempt;
}
