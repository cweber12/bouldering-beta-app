/**
 * Editable video metadata — the `analysis_inputs` block of the downloader-owned
 * `metadata.json` (see docs/adr/0018 §4). Calibration corrects these video-level
 * condition labels and writes them back with a **field-level strict merge**: only
 * the edited `analysis_inputs.<field>` values are overwritten; every other key of
 * `metadata.json` (including `route_folder` / `imported_from`, which the
 * downloader owns) and every un-edited `analysis_inputs` field is preserved
 * verbatim.
 *
 * Framework-agnostic — no React imports. The parse + merge helpers run in the dev
 * proxy (server) and are unit-tested in isolation; the load/save helpers are the
 * client seam over that proxy.
 */

/** Amount labels — the ordinal `unknown/none/low/medium/high` scale fields. */
export const AMOUNT_FIELDS = [
  "shadows",
  "climber_contrast",
  "wall_contrast",
  "motion_blur",
  "occlusion",
] as const;

/** The ordinal scale used by every amount field. `unknown` = unlabelled. */
export const AMOUNT_SCALE = ["unknown", "none", "low", "medium", "high"] as const;

/** Free-text-with-select fields: seeded with the current value, any string allowed. */
export const SELECT_FIELDS = ["camera_stability", "route_orientation", "camera_angle"] as const;

/** Every editable `analysis_inputs` field, in display order. */
export const EDITABLE_FIELDS = [...AMOUNT_FIELDS, ...SELECT_FIELDS, "notes"] as const;

export type AmountField = (typeof AMOUNT_FIELDS)[number];
export type SelectField = (typeof SELECT_FIELDS)[number];
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** A partial edit — only the fields the client sends are merged. */
export type AnalysisInputsEdit = Partial<Record<EditableField, string>>;

/** A fully-seeded editor state: every editable field resolved to a string. */
export type AnalysisInputsValues = Record<EditableField, string>;

const EDITABLE_FIELD_SET = new Set<string>(EDITABLE_FIELDS);
const AMOUNT_SCALE_SET = new Set<string>(AMOUNT_SCALE);

/** Length caps: notes is a paragraph, the rest are short labels. */
const NOTES_MAX = 2000;
const FIELD_MAX = 200;

/** True when `v` is one of the ordinal scale values (not an off-scale label). */
export function isAmountScaleValue(v: string): boolean {
  return AMOUNT_SCALE_SET.has(v);
}

/**
 * The select options for an amount field: the ordinal scale, plus the current
 * value appended when it is off-scale so an existing label is never dropped.
 */
export function amountOptions(value: string): string[] {
  if (!value || isAmountScaleValue(value)) return [...AMOUNT_SCALE];
  return [...AMOUNT_SCALE, value];
}

/**
 * Seed a full editor state from a raw `analysis_inputs` block (or anything).
 * Amount fields default to `unknown`; select fields and notes default to empty.
 * Non-empty existing strings — including off-scale amounts — are kept verbatim.
 */
export function normalizeAnalysisInputs(raw: unknown): AnalysisInputsValues {
  const src =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = {} as AnalysisInputsValues;
  for (const f of AMOUNT_FIELDS) {
    out[f] = typeof src[f] === "string" && src[f] ? (src[f] as string) : "unknown";
  }
  for (const f of SELECT_FIELDS) {
    out[f] = typeof src[f] === "string" ? (src[f] as string) : "";
  }
  out.notes = typeof src.notes === "string" ? (src.notes as string) : "";
  return out;
}

/**
 * Validate an untrusted PUT body into an {@link AnalysisInputsEdit}, or null when
 * malformed. Strict: every key must be an editable field and every value a string
 * within its length cap. Off-scale amount strings are accepted (they are retained
 * existing labels, not garbage) — the scale is enforced by the UI, not here.
 */
export function parseAnalysisInputsEdit(body: unknown): AnalysisInputsEdit | null {
  if (typeof body !== "object" || body === null) return null;
  const inputs = (body as Record<string, unknown>).analysisInputs;
  if (typeof inputs !== "object" || inputs === null) return null;

  const src = inputs as Record<string, unknown>;
  const out: AnalysisInputsEdit = {};
  for (const key of Object.keys(src)) {
    if (!EDITABLE_FIELD_SET.has(key)) return null; // reject unknown fields
    const val = src[key];
    if (typeof val !== "string") return null;
    if (val.length > (key === "notes" ? NOTES_MAX : FIELD_MAX)) return null;
    out[key as EditableField] = val;
  }
  return out;
}

/**
 * Field-level strict merge of an edit into an existing `metadata.json` object:
 * overwrite only the edited `analysis_inputs.<field>` values, preserving every
 * other top-level key and every un-edited `analysis_inputs` field verbatim.
 */
export function mergeMetadataAnalysisInputs(
  existing: Record<string, unknown>,
  edit: AnalysisInputsEdit,
): Record<string, unknown> {
  const prev =
    typeof existing.analysis_inputs === "object" && existing.analysis_inputs !== null
      ? (existing.analysis_inputs as Record<string, unknown>)
      : {};
  return {
    ...existing,
    analysis_inputs: { ...prev, ...edit },
  };
}

// ---------------------------------------------------------------------------
// Client seam over the dev proxy (mirrors utils/harnessGroundTruth).
// ---------------------------------------------------------------------------

/** Load a bundle's `analysis_inputs` block (raw, or null when absent). */
export async function loadAnalysisInputs(bundleKey: string): Promise<unknown> {
  const res = await fetch(`/api/dev/corpus/metadata?key=${encodeURIComponent(bundleKey)}`);
  if (!res.ok) throw new Error("Failed to load metadata.");
  const body = await res.json();
  return body.analysisInputs ?? null;
}

/** Persist a metadata edit; returns the merged `analysis_inputs` block. */
export async function saveAnalysisInputs(
  bundleKey: string,
  edit: AnalysisInputsEdit,
): Promise<unknown> {
  const res = await fetch(`/api/dev/corpus/metadata?key=${encodeURIComponent(bundleKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analysisInputs: edit }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Failed to save metadata.");
  return body.analysisInputs ?? null;
}
