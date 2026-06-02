"use client";

import { createPortal } from "react-dom";
import ComboInput from "@/components/shared/ComboInput";
import { cn } from "@/utils/cn";
import { ROUTE_TEXT_LIMIT } from "@/utils/fsHelpers";
import type { RunType } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Grouped prop types — reduces prop-list noise on the parent component.
// ---------------------------------------------------------------------------

/** Location field values and their autocomplete suggestions. */
export interface MetadataSheetLocation {
  state: string;
  area: string;
  route: string;
  stateSuggestions: string[];
  areaSuggestions: string[];
  routeSuggestions: string[];
  coordinates: { lat: number; lng: number } | null;
}

/** Run-detail field values. */
export interface MetadataSheetRunDetails {
  runType: RunType;
  rating: string;
  notes: string;
}

/** All callbacks that mutate the form. */
export interface MetadataSheetActions {
  onStateChange: (v: string) => void;
  onAreaChange: (v: string) => void;
  onRouteChange: (v: string) => void;
  onClearCoordinates: () => void;
  onUseGPS: () => void;
  onOpenMapPicker: () => void;
  onRunTypeChange: (t: RunType) => void;
  onRatingChange: (v: string) => void;
  onNotesChange: (v: string) => void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface MetadataBottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Which action the confirm button triggers. */
  action: "save" | "upload";
  location: MetadataSheetLocation;
  geoLoading: boolean;
  runDetails: MetadataSheetRunDetails;
  actions: MetadataSheetActions;
  showLocationWarning: boolean;
  saveError: string | null;
  s3Loading: boolean;
  /** Called when the confirm button is pressed. */
  onConfirm: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function MetadataBottomSheet({
  open,
  onClose,
  action,
  location,
  geoLoading,
  runDetails,
  actions,
  showLocationWarning,
  saveError,
  s3Loading,
  onConfirm,
}: MetadataBottomSheetProps) {
  if (!open) return null;

  // Upload requires a full location (it forms the S3 key). Gate the confirm
  // button so the user can't trigger an after-the-fact warning — prevent,
  // don't scold. Device save keeps its unknown_* fallback, so it stays enabled.
  const requiredMissing =
    !location.state.trim() || !location.area.trim() || !location.route.trim();
  const confirmDisabled =
    action === "upload" ? s3Loading || requiredMissing : false;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-surface/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="animate-slide-up relative w-full max-w-lg rounded-t-md border border-b-0 border-edge/50 bg-surface px-5 pb-7 pt-5 shadow-xl max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">
            {action === "save" ? "Save to Device" : "Upload"}
          </h2>
          <button
            onClick={onClose}
            className="ui-control flex h-11 w-11 items-center justify-center rounded-md text-fg-muted"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Location */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-fg-secondary">
              Location{" "}
              {action === "upload" && (
                <span className="font-normal text-fg-muted">(required)</span>
              )}
            </p>
            <ComboInput
              label="State / Region"
              value={location.state}
              onChange={actions.onStateChange}
              suggestions={location.stateSuggestions}
              placeholder="e.g. Colorado"
              maxLength={ROUTE_TEXT_LIMIT}
            />
            <ComboInput
              label="Area"
              value={location.area}
              onChange={actions.onAreaChange}
              suggestions={location.areaSuggestions}
              placeholder="e.g. Red Rocks"
              maxLength={ROUTE_TEXT_LIMIT}
            />
            <ComboInput
              label="Route"
              value={location.route}
              onChange={actions.onRouteChange}
              suggestions={location.routeSuggestions}
              placeholder="e.g. The Classic"
              maxLength={ROUTE_TEXT_LIMIT}
            />

            {/* GPS */}
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-xs font-medium text-fg-secondary">GPS Coordinates</p>
              {location.coordinates ? (
                <div className="flex items-center justify-between rounded-md border border-send/40 bg-send-surface px-3 py-2">
                  <span className="text-xs text-send font-mono">
                    {location.coordinates.lat.toFixed(5)}, {location.coordinates.lng.toFixed(5)}
                  </span>
                  <button
                    type="button"
                    onClick={actions.onClearCoordinates}
                    className="ui-control-text ml-2 text-xs text-fg-muted hover:text-danger"
                    aria-label="Clear coordinates"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <p className="text-xs text-fg-muted">No coordinates tagged.</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={actions.onUseGPS}
                  disabled={geoLoading}
                  className="ui-control flex-1 rounded-md px-2 py-1.5 text-xs disabled:opacity-50"
                >
                  {geoLoading ? (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-edge border-t-accent" />
                  ) : (
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path strokeLinecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                    </svg>
                  )}
                  Use GPS
                </button>
                <button
                  type="button"
                  onClick={actions.onOpenMapPicker}
                  className="ui-control flex-1 rounded-md px-2 py-1.5 text-xs"
                >
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                    />
                  </svg>
                  Pick on map
                </button>
              </div>
            </div>
          </div>

          {/* Climb type */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-fg-secondary">Climb type</p>
            <div className="flex gap-2">
              {(["attempt", "send"] as RunType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => actions.onRunTypeChange(t)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium capitalize transition",
                    runDetails.runType === t
                      ? t === "send"
                        ? "border-send/60 bg-send-surface text-send"
                        : "border-attempt/60 bg-attempt-surface text-attempt"
                      : "border-edge bg-inset text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Details */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-fg-secondary">
              Details{" "}
              <span className="text-fg-muted font-normal">(optional)</span>
            </p>
            <input
              type="text"
              value={runDetails.rating}
              onChange={(e) => actions.onRatingChange(e.target.value)}
              placeholder="Grade / Rating (e.g. V3, 5.10a)"
              maxLength={ROUTE_TEXT_LIMIT}
              className="ui-input rounded-md px-3 py-2 text-sm"
            />
            <textarea
              value={runDetails.notes}
              onChange={(e) => actions.onNotesChange(e.target.value)}
              placeholder="Notes…"
              rows={2}
              maxLength={ROUTE_TEXT_LIMIT}
              className="ui-input resize-none rounded-md px-3 py-2 text-sm"
            />
          </div>

          {showLocationWarning && (
            <p className="rounded-md border border-caution-border bg-caution-surface px-4 py-2.5 text-xs text-caution">
              Enter State/Region, Area, and Route before uploading.
            </p>
          )}
          {saveError && <p className="text-xs text-danger">{saveError}</p>}

          {/* Action button */}
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            title={
              action === "upload" && requiredMissing
                ? "Enter State/Region, Area, and Route to upload"
                : undefined
            }
            className="ui-control-primary flex items-center justify-center gap-2 rounded-md px-6 py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action === "save" ? (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
                Save to device
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                  />
                </svg>
                {s3Loading ? "Uploading…" : "Upload"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
