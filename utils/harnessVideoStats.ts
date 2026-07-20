/**
 * Video Stats prefill — the scanner side of `POST {HARNESS_API_BASE}/api/video-stats`
 * (relayed via /api/dev/corpus/video-stats). After every Scan Setup save the
 * scanner re-POSTs so the harness recomputes region stats from the current crops
 * and re-stamps `video-stats.json` with the new `setupHash`; the synchronous
 * response carries suggested condition labels that prefill the `analysisInputs`
 * form for the user to verify instead of author from memory. See the video-stats
 * handoff (`.scratch/video-stats-prefill`) and `utils/harnessContract` for the
 * feature gate.
 *
 * Framework-agnostic — no React imports. Parse/apply helpers are pure and
 * unit-tested; the fetch seams mirror `utils/harnessSetup.saveSetupLabels`.
 */

import type { AnalysisInputsValues, EditableField } from "@/utils/harnessMetadata";

/**
 * The label keys the harness may suggest (snake_case `analysisInputs` keys).
 * Anything else in the response is ignored — a missing key means "no
 * suggestion" and that field stays manual.
 */
export const SUGGESTABLE_FIELDS = [
  "shadows",
  "climber_contrast",
  "wall_contrast",
  "motion_blur",
  "camera_stability",
] as const;

export type SuggestableField = (typeof SUGGESTABLE_FIELDS)[number];

/** Suggested label values, keyed by `analysisInputs` field. */
export type SuggestedLabels = Partial<Record<SuggestableField, string>>;

const SUGGESTABLE_FIELD_SET = new Set<string>(SUGGESTABLE_FIELDS);

/** Keep only known suggestion keys with non-empty string values. */
export function parseSuggestions(raw: unknown): SuggestedLabels {
  if (typeof raw !== "object" || raw === null) return {};
  const out: SuggestedLabels = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (SUGGESTABLE_FIELD_SET.has(key) && typeof val === "string" && val.length > 0) {
      out[key as SuggestableField] = val;
    }
  }
  return out;
}

/**
 * Prefill a seeded editor state with suggestions. Only unlabelled fields
 * (`unknown` / empty) take a suggestion — an existing human label always wins.
 * Returns the prefilled values plus the subset of suggestions actually applied,
 * which is what the "suggested" affordance shows and what provenance is
 * computed against on save.
 */
export function applySuggestions(
  seeded: AnalysisInputsValues,
  suggestions: SuggestedLabels,
): { values: AnalysisInputsValues; applied: Partial<Record<EditableField, string>> } {
  const values = { ...seeded };
  const applied: Partial<Record<EditableField, string>> = {};
  for (const [key, suggestion] of Object.entries(suggestions)) {
    const f = key as EditableField;
    if (!suggestion) continue;
    const current = seeded[f];
    if (current === "unknown" || current === "") {
      values[f] = suggestion;
      applied[f] = suggestion;
    }
  }
  return { values, applied };
}

// ---------------------------------------------------------------------------
// Client seams over the dev proxy.
// ---------------------------------------------------------------------------

/** What the scanner keeps from a video-stats POST response. */
export interface VideoStatsResult {
  suggestions: SuggestedLabels;
  /** The `setupHash` the artifact was stamped under (echoed provenance anchor). */
  setupHash: string | null;
}

/**
 * Ask the harness to (re)compute region stats for a bundle from its just-saved
 * `setup.json`. Synchronous on the harness (decodes ~30 frames, a few seconds).
 * Throws on any failure — callers degrade to the manual label flow, never
 * block calibration on this.
 */
export async function requestVideoStats(
  bundleKey: string,
  setupHash?: string,
): Promise<VideoStatsResult> {
  const res = await fetch(
    `/api/dev/corpus/video-stats?key=${encodeURIComponent(bundleKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupHash ? { setupHash } : {}),
    },
  );
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : "Video stats request failed.",
    );
  }
  return {
    suggestions: parseSuggestions(body.suggestions),
    setupHash: typeof body.setupHash === "string" ? body.setupHash : null,
  };
}

/**
 * Read the bundle's `video-stats.json` camera-angle estimate (written
 * asynchronously by the harness ViTPose job — not part of the POST response).
 * Display-only hint; the `camera_angle` hand label stays authoritative. Null
 * when the artifact or block is absent.
 */
export async function loadCameraAngleHint(bundleKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/dev/corpus/video-stats?key=${encodeURIComponent(bundleKey)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { videoStats?: unknown };
    if (typeof body.videoStats !== "object" || body.videoStats === null) return null;
    const angle = (body.videoStats as Record<string, unknown>).cameraAngle;
    if (typeof angle !== "object" || angle === null) return null;
    const estimate = (angle as Record<string, unknown>).estimate;
    return typeof estimate === "string" && estimate.length > 0 ? estimate : null;
  } catch {
    return null;
  }
}
