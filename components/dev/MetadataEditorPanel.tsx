"use client";

/**
 * Dev-only editable video metadata panel — a controlled presentational form.
 *
 * Renders a Test Video's `analysis_inputs` labels for correction in the Setup
 * act: scale fields (`shadows` with the structural `none/solid/patchy/climber`
 * vocabulary; `climber_contrast`, `wall_contrast`, `motion_blur`, `occlusion` as
 * `unknown/none/low/medium/high`) as selects; `camera_stability`,
 * `route_orientation`, `camera_angle` as free-text combos; `notes` as a textarea.
 *
 * Owns no state and no save affordance: SetupEditor holds the form `values`,
 * feeds the applied harness suggestions (video-stats handoff) that drive the
 * "suggested" affordance, and persists everything through the single Save setup.
 * The panel is always visible alongside the video, so late-arriving suggestions
 * simply prefill still-unlabelled fields in place. Rendered only in development.
 * See the calibration-flag-review PRD and `.scratch/video-stats-prefill`.
 */

import ComboInput from "@/components/ui/ComboInput";
import {
  SCALE_FIELDS,
  SELECT_FIELDS,
  SELECT_FIELD_VOCAB,
  scaleOptions,
  type AnalysisInputsValues,
  type EditableField,
} from "@/utils/harnessMetadata";

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
  /** The current label form values (owned by SetupEditor). */
  values: AnalysisInputsValues;
  /** Edit one field. */
  onChange: (field: EditableField, value: string) => void;
  /** The harness suggestions actually prefilled — drives the "suggested" affordance. */
  applied: Partial<Record<EditableField, string>>;
  /** True while the background video-stats request is in flight. */
  suggestionsLoading?: boolean;
  /** Visible degraded-state note when suggestions are unavailable, or null. */
  degradedNote?: string | null;
  /** Async ViTPose camera-angle estimate — display-only hint, or null. */
  cameraAngleHint?: string | null;
}

export default function MetadataEditorPanel({
  values,
  onChange,
  applied,
  suggestionsLoading,
  degradedNote,
  cameraAngleHint,
}: MetadataEditorPanelProps) {
  /** The suggested affordance: shown while a prefill still stands unconfirmed. */
  function isSuggested(field: EditableField): boolean {
    const suggestion = applied[field];
    return typeof suggestion === "string" && suggestion.length > 0 && suggestion === values[field];
  }

  function fieldLabel(field: EditableField) {
    return (
      <span className="text-xs font-medium text-fg-secondary">
        {FIELD_LABELS[field]}
        {isSuggested(field) && (
          <span
            className="ml-1.5 rounded bg-caution-surface px-1 py-px text-[10px] font-normal text-caution"
            title="Prefilled from the harness video stats — confirm or override, then Save setup"
          >
            suggested
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">Video metadata</h2>
        {suggestionsLoading && (
          <span className="text-[11px] text-fg-muted" role="status" aria-live="polite">
            Loading suggestions…
          </span>
        )}
      </header>

      {degradedNote && (
        <p
          role="status"
          className="rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution"
        >
          {degradedNote}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3">
        {SCALE_FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1.5">
            {fieldLabel(field)}
            <select
              value={values[field]}
              onChange={(e) => onChange(field, e.target.value)}
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

      <div className="grid grid-cols-1 gap-3">
        {SELECT_FIELDS.map((field) => (
          <div key={field} className="flex flex-col gap-1">
            <ComboInput
              label={FIELD_LABELS[field]}
              value={values[field]}
              onChange={(v) => onChange(field, v)}
              suggestions={Array.from(
                new Set(
                  [
                    applied[field] as string | undefined,
                    values[field],
                    ...SELECT_FIELD_VOCAB[field],
                  ].filter((s): s is string => typeof s === "string" && s.length > 0),
                ),
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
          onChange={(e) => onChange("notes", e.target.value)}
          rows={3}
          maxLength={2000}
          className="ui-input resize-y px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}
