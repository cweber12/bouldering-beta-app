"use client";

import { useState } from "react";
import { cn } from "@/utils/cn";
import FramePlayer from "@/components/shared/FramePlayer";
import SkeletonStylePanel from "@/components/shared/SkeletonStylePanel";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";
import type { SkeletonFrameData } from "@/pipeline/skeletonRenderer";
import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface StepViewLandmarksProps {
  // Processing status
  isProcessing: boolean;
  currentFrame: number;
  totalFrames: number;
  progressPct: number;
  orbStatus: "idle" | "extracting" | "ready" | "failed";
  frameStep: number;
  processingError: string | null;
  // Results
  activeAttempt: RouteAttempt | null;
  firstFrameFile: File | null;
  firstFrameSkeletonData: SkeletonFrameData | null;
  topoStyle: SkeletonStyle;
  onSkeletonStyleChange: (s: SkeletonStyle) => void;
  // Toolbar actions
  onEditClimb: () => void;
  /** Navigate back to video selection and start a fresh scan. */
  onScanAnother: () => void;
  // Save / upload
  onUpload: () => void;
  s3Saved: boolean;
  s3Loading: boolean;
  saveError: string | null;
  /** Navigate to the user's saved scans after a successful upload. */
  onViewScans: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function StepViewLandmarks({
  isProcessing,
  currentFrame,
  totalFrames,
  progressPct,
  orbStatus,
  frameStep,
  processingError,
  activeAttempt,
  firstFrameFile,
  firstFrameSkeletonData,
  topoStyle,
  onSkeletonStyleChange,
  onEditClimb,
  onScanAnother,
  onUpload,
  s3Saved,
  s3Loading,
  saveError,
  onViewScans,
}: StepViewLandmarksProps) {
  const [showActionsDropdown, setShowActionsDropdown] = useState(false);
  const [showInfoDropdown,    setShowInfoDropdown]    = useState(false);

  function closeAllDropdowns() {
    setShowActionsDropdown(false);
    setShowInfoDropdown(false);
  }

  const showResults = !isProcessing && !!activeAttempt &&
    (orbStatus === "ready" || orbStatus === "failed");

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 flex flex-col gap-4 sm:px-6 pb-8">

        {/* ── Processing progress ── */}
        {isProcessing && (
          <div className="flex flex-col gap-2">
            <div className="h-2 overflow-hidden rounded-full bg-inset">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-center text-xs text-fg-secondary">
              Analysing frame {currentFrame} of {totalFrames} ({progressPct}%)
              <span className="ml-1.5 text-fg-muted">&mdash; pose every {frameStep} frames</span>
            </p>
          </div>
        )}

        {!isProcessing && orbStatus === "extracting" && (
          <p className="text-center text-sm text-fg-secondary">Extracting reference features&#8230;</p>
        )}
        {!isProcessing && orbStatus === "failed" && (
          <p className="text-center text-sm text-caution">
            Feature extraction failed &mdash; image matching will be unavailable.
          </p>
        )}

        {/* ── Upload success banner ── */}
        {showResults && s3Saved && (
          <div className="rounded-xl border border-send/30 bg-send-surface px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1">
              <svg className="h-4 w-4 shrink-0 text-send" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-send">Scan saved successfully</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={onScanAnother}
                className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
              >
                Scan another
              </button>
              <button
                onClick={onViewScans}
                className="rounded-lg border border-send/40 bg-send/10 px-3 py-1.5 text-xs font-medium text-send transition hover:bg-send/20"
              >
                View my scans
              </button>
            </div>
          </div>
        )}

        {/* ── Icon toolbar (shown once results are ready, hidden after upload) ── */}
        {showResults && !s3Saved && (
          <div className="flex items-center gap-1.5">

            {/* Actions — three-dots options icon */}
            <div className="relative">
              <button
                type="button"
                onClick={() => { setShowActionsDropdown(p => !p); setShowInfoDropdown(false); }}
                className={cn(
                  "rounded-lg border p-1.5 transition",
                  showActionsDropdown
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg",
                )}
                title="Actions"
                aria-label="Actions"
              >
                {/* Horizontal three-dots */}
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5"  cy="12" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="19" cy="12" r="1.5" />
                </svg>
              </button>

              {showActionsDropdown && (
                <div className="absolute left-0 top-full z-20 mt-1.5 w-48 rounded-xl border border-edge/50 bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl animate-fade-in">
                  <button
                    onClick={() => { closeAllDropdowns(); onEditClimb(); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-card hover:text-fg"
                  >
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                    </svg>
                    Edit climb
                  </button>
                  <button
                    onClick={() => { closeAllDropdowns(); onScanAnother(); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-card hover:text-fg"
                  >
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    Scan another beta
                  </button>
                </div>
              )}
            </div>

            {/* Info / metrics icon */}
            {activeAttempt && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setShowInfoDropdown(p => !p); setShowActionsDropdown(false); }}
                  className={cn(
                    "rounded-lg border p-1.5 transition",
                    showInfoDropdown
                      ? "border-send/50 bg-send-surface text-send"
                      : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg",
                  )}
                  title="Scan metrics"
                  aria-label="Scan metrics"
                >
                  {/* Chart bar icon */}
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                </button>

                {showInfoDropdown && (
                  <div className="absolute left-0 top-full z-20 mt-1.5 w-64 rounded-xl border border-send/20 bg-card/95 px-4 py-3 shadow-2xl backdrop-blur-xl animate-fade-in">
                    <p className="text-xs font-semibold text-send mb-1.5">Analysis complete</p>
                    <p className="text-xs text-fg-secondary leading-relaxed">
                      {activeAttempt.frames.length} pose frames &middot;{" "}
                      {activeAttempt.orbFeatures?.keypoints.length ?? 0} reference points
                      {activeAttempt.state && ` — ${activeAttempt.state}`}
                      {activeAttempt.area  && ` › ${activeAttempt.area}`}
                      {activeAttempt.route && ` › ${activeAttempt.route}`}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Save / upload icon */}
            <button
              type="button"
              onClick={() => { closeAllDropdowns(); onUpload(); }}
              disabled={s3Loading}
              className={cn(
                "rounded-lg border p-1.5 transition",
                s3Loading
                  ? "border-edge bg-card text-fg-muted cursor-not-allowed opacity-60"
                  : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg",
              )}
              title="Save scan to cloud"
              aria-label="Save scan to cloud"
            >
              {s3Loading ? (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                /* Cloud upload icon */
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                </svg>
              )}
            </button>

            {/* Skeleton style — icon only */}
            <SkeletonStylePanel onChange={onSkeletonStyleChange} size="sm" label="" />

            {saveError && (
              <p className="w-full text-xs text-danger">{saveError}</p>
            )}
          </div>
        )}

        {/* ── Animated first-frame landmark preview ── */}
        {showResults && (
          <div className="flex flex-col gap-2">
            {firstFrameFile && firstFrameSkeletonData ? (
              <FramePlayer
                imageFile={firstFrameFile}
                layers={[{ frames: firstFrameSkeletonData.frames, style: topoStyle }]}
                duration={firstFrameSkeletonData.duration}
                autoPlay
                orbKeypoints={activeAttempt?.orbFeatures?.keypoints.map(kp => kp.pt)}
                className="w-full rounded-xl border border-edge/50"
              />
            ) : (
              <p className="text-xs text-fg-muted text-center">Loading preview&#8230;</p>
            )}
          </div>
        )}

        {/* Processing error */}
        {processingError && (
          <p className="rounded-2xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">
            {processingError}
          </p>
        )}
      </div>
    </div>
  );
}
