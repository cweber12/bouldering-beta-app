"use client";

/**
 * Dev-only editable video metadata panel.
 *
 * Renders a Test Video's `analysis_inputs` labels for correction in the
 * calibration flow: amount fields (`shadows`, `climber_contrast`,
 * `wall_contrast`, `motion_blur`, `occlusion`) as `unknown/none/low/medium/high`
 * selects; `camera_stability`, `route_orientation`, `camera_angle` as free-text
 * combos seeded with the current value; `notes` as a textarea. Saving persists
 * the labels into `setup.json.analysisInputs` through the merging setup write
 * (/api/dev/corpus/setup), which never re-hashes the Scan Setup. Rendered only
 * in development. See the calibration-flag-review PRD.
 */

import { useMemo, useState } from "react";
import ComboInput from "@/components/ui/ComboInput";
import {
  AMOUNT_FIELDS,
  SELECT_FIELDS,
  amountOptions,
  normalizeAnalysisInputs,
  type AnalysisInputsValues,
  type EditableField,
} from "@/utils/harnessMetadata";
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
  /** Close the panel. */
  onClose: () => void;
  /** Called with the merged `analysis_inputs` after a successful save. */
  onSaved?: (analysisInputs: unknown) => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function MetadataEditorPanel({
  bundleKey,
  initial,
  onClose,
  onSaved,
}: MetadataEditorPanelProps) {
  const seeded = useMemo(() => normalizeAnalysisInputs(initial), [initial]);
  const [values, setValues] = useState<AnalysisInputsValues>(seeded);
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

  async function handleSave() {
    setState("saving");
    setError(null);
    try {
      const merged = await saveSetupLabels(bundleKey, values);
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {AMOUNT_FIELDS.map((field) => (
            <label key={field} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">{FIELD_LABELS[field]}</span>
              <select
                value={values[field]}
                onChange={(e) => set(field, e.target.value)}
                className="ui-input px-3 py-2 text-sm"
              >
                {amountOptions(values[field]).map((opt) => (
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
            <ComboInput
              key={field}
              label={FIELD_LABELS[field]}
              value={values[field]}
              onChange={(v) => set(field, v)}
              suggestions={seeded[field] ? [seeded[field]] : []}
              placeholder="unset"
              maxLength={200}
            />
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
