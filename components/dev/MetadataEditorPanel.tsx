"use client";

/**
 * Dev-only editable video metadata panel.
 *
 * Renders a Test Video's `analysis_inputs` labels for correction in the
 * calibration flow: scale fields (`shadows` with the structural
 * `none/solid/patchy/climber` vocabulary; `climber_contrast`, `wall_contrast`,
 * `motion_blur`, `occlusion` as `unknown/none/low/medium/high`) as selects;
 * `camera_stability`, `route_orientation`, `camera_angle` as free-text combos;
 * `notes` as a textarea. Harness suggestions (video-stats handoff) prefill
 * unlabelled fields with a visible "suggested" affordance the user verifies
 * rather than authors; each save records per-label provenance
 * (auto-accepted / human-overridden / human-authored). Saving persists into
 * `setup.json.analysisInputs` (+ `analysisInputsProvenance`) through the
 * merging setup write (/api/dev/corpus/setup), which never re-hashes the Scan
 * Setup. Rendered only in development. See the calibration-flag-review PRD and
 * `.scratch/video-stats-prefill`.
 */

import { useMemo, useState } from "react";
import ComboInput from "@/components/ui/ComboInput";
import {
  SCALE_FIELDS,
  SELECT_FIELDS,
  SELECT_FIELD_VOCAB,
  computeProvenance,
  scaleOptions,
  normalizeAnalysisInputs,
  type AnalysisInputsValues,
  type EditableField,
} from "@/utils/harnessMetadata";
import { applySuggestions, type SuggestedLabels } from "@/utils/harnessVideoStats";
import { saveSetupLabels } from "@/utils/harnessSetup";

/** Human labels for the editable fields. */
const FIELD_LABELS: Record<EditableField, string> = {
  shadows: "Shadows",
  climber_contrast: "Climber contrast",
  wall_contrast: "Wall contrast",
  motion_blur: "Motion blur",
  occlusion: "Occlusion",
  camera_stability: "Camera stability",
  route_orientation: "Route orientation",
  camera_angle: "Camera angle",
  notes: "Notes",
};

export interface MetadataEditorPanelProps {
  /** `<routeFolder>/<videoKey>` bundle key. */
  bundleKey: string;
  /** The bundle's raw `analysis_inputs` block (from the corpus passthrough). */
  initial: unknown;
  /** Harness-suggested labels to prefill unlabelled fields with, or null. */
  suggestions?: SuggestedLabels | null;
  /** Visible degraded-state note when suggestions are unavailable, or null. */
  degradedNote?: string | null;
  /** Async ViTPose camera-angle estimate — display-only hint, or null. */
  cameraAngleHint?: string | null;
  /** Close the panel. */
  onClose: () => void;
  /** Called with the merged `analysis_inputs` after a successful save. */
  onSaved?: (analysisInputs: unknown) => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function MetadataEditorPanel({
  bundleKey,
  initial,
  suggestions,
  degradedNote,
  cameraAngleHint,
  onClose,
  onSaved,
}: MetadataEditorPanelProps) {
  const seeded = useMemo(() => normalizeAnalysisInputs(initial), [initial]);
  // Prefill unlabelled fields from the harness suggestions; `applied` is the
  // subset actually shown, which the affordance and provenance key off.
  const prefilled = useMemo(
    () => applySuggestions(seeded, suggestions ?? {}),
    [seeded, suggestions],
  );
  const [values, setValues] = useState<AnalysisInputsValues>(prefilled.values);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () => (Object.keys(values) as EditableField[]).some((f) => values[f] !== seeded[f]),
    [values, seeded],
  );

  function set(field: EditableField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setState("idle");
  }

  /** The suggested affordance: shown while a prefill stands unconfirmed. */
  function isSuggested(field: EditableField): boolean {
    return state !== "saved" && prefilled.applied[field] === values[field];
  }

  function fieldLabel(field: EditableField) {
    return (
      <span className="text-xs font-medium text-fg-secondary">
        {FIELD_LABELS[field]}
        {isSuggested(field) && (
          <span
            className="ml-1.5 rounded bg-caution-surface px-1 py-px text-[10px] font-normal text-caution"
            title="Prefilled from the harness video stats — confirm or override, then save"
          >
            suggested
          </span>
        )}
      </span>
    );
  }

  async function handleSave() {
    setState("saving");
    setError(null);
    try {
      const provenance = computeProvenance(values, seeded, prefilled.applied);
      const merged = await saveSetupLabels(bundleKey, values, provenance);
      setValues(normalizeAnalysisInputs(merged));
      setState("saved");
      onSaved?.(merged);
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex max-h-[85dvh] w-[min(92vw,32rem)] flex-col rounded-lg border border-edge/40 bg-surface shadow-xl">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/30 px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">Video metadata</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-fg-muted hover:text-fg"
        >
          Close
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {degradedNote && (
          <p
            role="status"
            className="rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution"
          >
            {degradedNote}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SCALE_FIELDS.map((field) => (
            <label key={field} className="flex flex-col gap-1.5">
              {fieldLabel(field)}
              <select
                value={values[field]}
                onChange={(e) => set(field, e.target.value)}
                className="ui-input px-3 py-2 text-sm"
              >
                {scaleOptions(field, values[field]).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SELECT_FIELDS.map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <ComboInput
                label={FIELD_LABELS[field]}
                value={values[field]}
                onChange={(v) => set(field, v)}
                suggestions={Array.from(
                  new Set([
                    ...(prefilled.applied[field] ? [prefilled.applied[field] as string] : []),
                    ...(seeded[field] ? [seeded[field]] : []),
                    ...SELECT_FIELD_VOCAB[field],
                  ]),
                )}
                placeholder="unset"
                maxLength={200}
              />
              {field === "camera_stability" && isSuggested(field) && (
                <span className="text-[10px] text-caution">suggested by the harness</span>
              )}
              {field === "camera_angle" && cameraAngleHint && (
                <span
                  className="text-[10px] text-fg-muted"
                  title="Written asynchronously by the harness ViTPose job — the hand label stays authoritative"
                >
                  ViTPose estimate: {cameraAngleHint}
                </span>
              )}
            </div>
          ))}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-secondary">{FIELD_LABELS.notes}</span>
          <textarea
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            maxLength={2000}
            className="ui-input resize-y px-3 py-2 text-sm"
          />
        </label>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-edge/30 px-4 py-3">
        <span
          className={`min-w-0 truncate text-xs ${state === "error" ? "text-danger" : "text-fg-muted"}`}
        >
          {state === "saving" && "Saving…"}
          {state === "saved" && "Saved to setup.json"}
          {state === "error" && error}
        </span>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={state === "saving" || !dirty}
          className="shrink-0 rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse disabled:opacity-50"
        >
          Save metadata
        </button>
      </footer>
    </div>
  );
}
