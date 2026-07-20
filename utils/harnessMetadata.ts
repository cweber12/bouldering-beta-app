/**
 * Manual condition labels — the video-level `analysis_inputs` the harness reads
 * from `setup.json.analysisInputs` (see the scanner data contract and PRD
 * `.scratch/calibration-flag-review`). Calibration corrects these labels through
 * the merging Scan Setup write; the old label-write path into the
 * downloader-owned `metadata.json` has been retired.
 *
 * The video-stats handoff (`.scratch/video-stats-prefill`) adds two things here:
 * a structural shadows vocabulary (`none/solid/patchy/climber` — what the shadow
 * looks like, replacing the intensity grades) and per-label provenance
 * (`analysisInputsProvenance`) recording whether a saved value was auto-accepted
 * from a harness suggestion, human-overridden, or human-authored.
 *
 * This module owns only the label vocabulary and pure normalise/parse/merge
 * helpers. Framework-agnostic — no React imports. The parse + merge helpers run
 * in the setup route (server) and are unit-tested in isolation; the client save
 * seam lives in `utils/harnessSetup` alongside the rest of the setup write.
 */

/** Amount labels — the ordinal `unknown/none/low/medium/high` scale fields. */
export const AMOUNT_FIELDS = [
  "climber_contrast",
  "wall_contrast",
  "motion_blur",
  "occlusion",
] as const;

/** The ordinal scale used by every amount field. `unknown` = unlabelled. */
export const AMOUNT_SCALE = ["unknown", "none", "low", "medium", "high"] as const;

/**
 * Shadows uses a structural vocabulary — what the shadow looks like, not how
 * strong it is. `climber` (the climber casts the significant shadow) is
 * human-only: the harness automation never suggests it, but it stays selectable.
 * Legacy intensity values (`low/medium/high`) on old bundles are retained
 * off-scale, never migrated.
 */
export const SHADOWS_SCALE = ["unknown", "none", "solid", "patchy", "climber"] as const;

/** Occlusion uses the data contract's own scale (`none|some|heavy`), not the
 * ordinal amount scale; legacy `low/medium/high` values are retained off-scale. */
export const OCCLUSION_SCALE = ["unknown", "none", "some", "heavy"] as const;

/** Every select-scale field, in display order: shadows first, then the amounts. */
export const SCALE_FIELDS = ["shadows", ...AMOUNT_FIELDS] as const;

/** Free-text-with-select fields: seeded with the current value, any string allowed. */
export const SELECT_FIELDS = ["camera_stability", "route_orientation", "camera_angle"] as const;

/** The data contract's vocabulary per select field — combo suggestions, not an
 * enforced enum (any string is storable, `unknown`/empty means unlabelled). */
export const SELECT_FIELD_VOCAB: Record<(typeof SELECT_FIELDS)[number], readonly string[]> = {
  camera_stability: ["steady", "some-shake", "moving"],
  route_orientation: ["left", "right", "head-on"],
  camera_angle: ["low", "level", "high"],
};

/** Every editable `analysis_inputs` field, in display order. */
export const EDITABLE_FIELDS = [...SCALE_FIELDS, ...SELECT_FIELDS, "notes"] as const;

export type AmountField = (typeof AMOUNT_FIELDS)[number];
export type ScaleField = (typeof SCALE_FIELDS)[number];
export type SelectField = (typeof SELECT_FIELDS)[number];
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** A partial edit — only the fields the client sends are merged. */
export type AnalysisInputsEdit = Partial<Record<EditableField, string>>;

/** A fully-seeded editor state: every editable field resolved to a string. */
export type AnalysisInputsValues = Record<EditableField, string>;

const EDITABLE_FIELD_SET = new Set<string>(EDITABLE_FIELDS);

/** Length caps: notes is a paragraph, the rest are short labels. */
const NOTES_MAX = 2000;
const FIELD_MAX = 200;

/** The select scale for a scale field: structural for shadows, the contract's
 * own scale for occlusion, the ordinal amount scale otherwise. */
export function scaleFor(field: ScaleField): readonly string[] {
  if (field === "shadows") return SHADOWS_SCALE;
  if (field === "occlusion") return OCCLUSION_SCALE;
  return AMOUNT_SCALE;
}

/**
 * The select options for a scale field: its scale, plus the current value
 * appended when it is off-scale so an existing label — including a legacy
 * intensity-graded shadows value — is never dropped.
 */
export function scaleOptions(field: ScaleField, value: string): string[] {
  const scale = scaleFor(field);
  if (!value || scale.includes(value)) return [...scale];
  return [...scale, value];
}

/**
 * Seed a full editor state from a raw `analysis_inputs` block (or anything).
 * Scale fields default to `unknown`; select fields and notes default to empty.
 * Non-empty existing strings — including off-scale values — are kept verbatim.
 */
export function normalizeAnalysisInputs(raw: unknown): AnalysisInputsValues {
  const src =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = {} as AnalysisInputsValues;
  for (const f of SCALE_FIELDS) {
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
 * Field-level strict merge of an edit into an existing `analysisInputs` block:
 * overwrite only the edited `<field>` values, carrying every un-edited label
 * (including off-scale amounts the harness may have written) forward verbatim.
 * Non-string existing values and the structural `route_folder` key are dropped —
 * `analysisInputs` holds only the harness-owned condition labels.
 */
export function mergeAnalysisInputs(
  existing: unknown,
  edit: AnalysisInputsEdit,
): Record<string, string> {
  const prev =
    typeof existing === "object" && existing !== null
      ? (existing as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(prev)) {
    if (key !== "route_folder" && typeof val === "string") out[key] = val;
  }
  return { ...out, ...edit };
}

// ---------------------------------------------------------------------------
// Per-label provenance — `setup.json.analysisInputsProvenance`, the additive
// sibling of `analysisInputs` the harness weighs by (auto-accepted vs
// human-verified labels). Never part of `setupHash`.
// ---------------------------------------------------------------------------

/** How a saved label value came to be. */
export const PROVENANCE_VALUES = ["auto-accepted", "human-overridden", "human-authored"] as const;

export type ProvenanceValue = (typeof PROVENANCE_VALUES)[number];

/** Per-label provenance entries; fields never touched simply have no entry. */
export type AnalysisInputsProvenance = Partial<Record<EditableField, ProvenanceValue>>;

const PROVENANCE_VALUE_SET = new Set<string>(PROVENANCE_VALUES);

/**
 * Compute the provenance entries for one label save. `applied` holds only the
 * suggestions actually shown prefilled in the form — so a label saved in a later
 * session, when no suggestion was on screen, is never mis-marked as accepted or
 * overridden. Untouched fields get no entry (the merge carries prior provenance
 * forward), and `notes` is free text, never tracked.
 */
export function computeProvenance(
  saved: AnalysisInputsValues,
  seeded: AnalysisInputsValues,
  applied: Partial<Record<EditableField, string>>,
): AnalysisInputsProvenance {
  const out: AnalysisInputsProvenance = {};
  for (const f of EDITABLE_FIELDS) {
    if (f === "notes") continue;
    const suggestion = applied[f];
    if (typeof suggestion === "string" && suggestion.length > 0) {
      out[f] = saved[f] === suggestion ? "auto-accepted" : "human-overridden";
    } else if (saved[f] !== seeded[f] && saved[f] && saved[f] !== "unknown") {
      out[f] = "human-authored";
    }
  }
  return out;
}

/**
 * Validate an untrusted PUT body's `analysisInputsProvenance` block, or null
 * when malformed. An absent block parses as an empty edit (valid — provenance
 * is optional on every save). Strict on both keys (editable fields, never
 * notes) and values (the three-word vocabulary).
 */
export function parseProvenanceEdit(body: unknown): AnalysisInputsProvenance | null {
  if (typeof body !== "object" || body === null) return null;
  const block = (body as Record<string, unknown>).analysisInputsProvenance;
  if (block === undefined) return {};
  if (typeof block !== "object" || block === null) return null;

  const src = block as Record<string, unknown>;
  const out: AnalysisInputsProvenance = {};
  for (const key of Object.keys(src)) {
    if (!EDITABLE_FIELD_SET.has(key) || key === "notes") return null;
    const val = src[key];
    if (typeof val !== "string" || !PROVENANCE_VALUE_SET.has(val)) return null;
    out[key as EditableField] = val as ProvenanceValue;
  }
  return out;
}

/**
 * Field-level merge of a provenance edit onto the saved block, mirroring
 * {@link mergeAnalysisInputs}: edited entries overwrite, prior entries carry
 * forward verbatim, malformed existing entries are dropped.
 */
export function mergeProvenance(
  existing: unknown,
  edit: AnalysisInputsProvenance,
): Record<string, string> {
  const prev =
    typeof existing === "object" && existing !== null
      ? (existing as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(prev)) {
    if (EDITABLE_FIELD_SET.has(key) && typeof val === "string" && PROVENANCE_VALUE_SET.has(val)) {
      out[key] = val;
    }
  }
  return { ...out, ...edit };
}
