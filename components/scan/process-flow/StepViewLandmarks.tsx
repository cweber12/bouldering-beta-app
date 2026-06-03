"use client";

import { useRef } from "react";
import { cn } from "@/utils/cn";
import ProcessFlowShell from "@/components/scan/process-flow/ProcessFlowShell";
import FramePlayer from "@/components/shared/FramePlayer";
import SkeletonStylePanel from "@/components/shared/SkeletonStylePanel";
import { squareMediaMaxWidth } from "@/utils/mediaContainerStyle";
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
  // Navigation
  /** Back to the detection step (Step 2). */
  onEditClimb: () => void;
  /** Navigate back to video selection and start a fresh scan. */
  onScanAnother: () => void;
  // Route photo overlay (the "Test" action)
  orbReady: boolean;
  onViewOnRoutePhoto: (file: File) => void;
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
  orbReady,
  onViewOnRoutePhoto,
  onUpload,
  s3Saved,
  s3Loading,
  saveError,
  onViewScans,
}: StepViewLandmarksProps) {
  const routePhotoInputRef = useRef<HTMLInputElement>(null);

  const showResults = !isProcessing && !!activeAttempt &&
    (orbStatus === "ready" || orbStatus === "failed");

  // Square-bound the overlay preview to the available vertical space so it fits
  // between the nav and footer without scrolling: portrait fills the height,
  // landscape is capped so it never sprawls. Defaults to portrait (9:16).
  const vm = activeAttempt?.videoMeta;
  const previewW = vm && vm.height ? vm.width : 9;
  const previewH = vm && vm.height ? vm.height : 16;
  const previewMaxWidth = squareMediaMaxWidth(previewW, previewH, "10rem");

  // ── Footer actions — only once results exist and before upload ──
  const showFooterActions = showResults && !s3Saved;

  const saveButton = (
    <button
      type="button"
      onClick={onUpload}
      disabled={s3Loading}
      className={cn(
        "motion-cta flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold",
        s3Loading
          ? "ui-control border-edge bg-surface-alt/45 text-fg-muted opacity-60 cursor-not-allowed"
          : "ui-control-primary",
      )}
      title="Save scan to cloud"
    >
      {s3Loading ? (
        <svg className="h-4 w-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
        </svg>
      )}
      Save
    </button>
  );

  // Skeleton style lives in the top toolbar (plateless icon) whenever a preview
  // is shown.
  const toolbarActions = showResults ? (
    <div className="ml-auto flex items-center gap-1">
      <SkeletonStylePanel onChange={onSkeletonStyleChange} size="sm" label="" variant="icon" />
    </div>
  ) : undefined;

  // Footer secondary — "Test on a route photo" forward action.
  const secondaryActions = orbReady ? (
    <>
      <input
        ref={routePhotoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onViewOnRoutePhoto(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => routePhotoInputRef.current?.click()}
        className="ui-control flex items-center gap-1.5 px-3 py-2 text-sm font-medium"
        title="Test the scan on a route photo"
      >
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
        Test
      </button>
    </>
  ) : undefined;

  return (
    <ProcessFlowShell
      step={3}
      totalSteps={3}
      stepName={isProcessing ? "Scanning video" : "Review your scan"}
      instruction={isProcessing ? "detecting pose frame by frame" : undefined}
      onBack={showFooterActions ? onEditClimb : undefined}
      toolbar={toolbarActions}
      primaryAction={showFooterActions ? saveButton : undefined}
      secondaryAction={showFooterActions ? secondaryActions : undefined}
    >
      <div className="h-full overflow-hidden">

        {/* ── Processing: vertically centered scan animation ── */}
        {isProcessing && (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-6 py-8">
            <div className="relative h-32 w-52 overflow-hidden rounded-(--radius-panel) border border-accent/30 bg-inset">
              <div
                className="absolute inset-0 opacity-[0.08] pointer-events-none"
                style={{
                  backgroundImage: "linear-gradient(var(--color-accent) 1px, transparent 1px), linear-gradient(90deg, var(--color-accent) 1px, transparent 1px)",
                  backgroundSize: "18px 18px",
                }}
              />
              <div
                className="absolute inset-x-0 top-0 bg-accent/15 transition-all duration-300"
                style={{ height: `${progressPct}%` }}
              />
              <div
                className="absolute inset-x-0 h-10 pointer-events-none transition-all duration-300"
                style={{ top: `calc(${progressPct}% - 1.25rem)` }}
              >
                <div className="w-full h-full bg-linear-to-b from-transparent via-accent/30 to-transparent" />
              </div>
              <div
                className="absolute inset-x-0 h-px bg-accent transition-all duration-300"
                style={{ top: `${progressPct}%` }}
              />
            </div>

            <div className="text-center leading-none">
              <span className="text-5xl font-bold tabular-nums text-fg tracking-tight">{progressPct}</span>
              <span className="text-xl font-medium text-fg-secondary ml-1">%</span>
            </div>

            <p className="text-sm text-fg-secondary">
              Frame {currentFrame} of {totalFrames}
              <span className="ml-1.5 text-fg-muted">· every {frameStep} frames</span>
            </p>
          </div>
        )}

        {/* ── Post-processing state ── */}
        {!isProcessing && orbStatus === "extracting" && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-fg-secondary">Extracting reference features&#8230;</p>
          </div>
        )}

        {/* ── Results — preview only, fit to viewport, no scroll ── */}
        {(showResults || (!isProcessing && orbStatus === "failed") || processingError) && (
          <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center gap-3 px-4 py-4 sm:px-6">

            {!isProcessing && orbStatus === "failed" && (
              <p className="text-center text-sm text-caution">
                Feature extraction failed &mdash; image matching will be unavailable.
              </p>
            )}

            {/* Upload success banner */}
            {showResults && s3Saved && (
              <div className="w-full rounded-(--radius-panel) border border-send/30 bg-send-surface px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <svg className="h-4 w-4 shrink-0 text-send" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm font-medium text-send">Scan saved successfully</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={onScanAnother}
                    className="ui-control rounded-md px-3 py-1.5 text-xs font-medium"
                  >
                    Scan another
                  </button>
                  <button
                    onClick={onViewScans}
                    className="rounded-md border border-send/40 bg-send/10 px-3 py-1.5 text-xs font-medium text-send transition hover:bg-send/20"
                  >
                    View my scans
                  </button>
                </div>
              </div>
            )}

            {saveError && <p className="w-full text-center text-xs text-danger">{saveError}</p>}

            {/* Animated preview */}
            {showResults && (
              firstFrameFile && firstFrameSkeletonData ? (
                <div className="mx-auto w-full" style={{ maxWidth: previewMaxWidth }}>
                  <FramePlayer
                    imageFile={firstFrameFile}
                    layers={[{ frames: firstFrameSkeletonData.frames, style: topoStyle }]}
                    duration={firstFrameSkeletonData.duration}
                    autoPlay
                    orbKeypoints={activeAttempt?.orbFeatures?.keypoints.map(kp => kp.pt)}
                    bare
                    className="w-full rounded-none"
                  />
                </div>
              ) : (
                <p className="text-xs text-fg-muted text-center">Loading preview&#8230;</p>
              )
            )}

            {/* Processing error */}
            {processingError && (
              <p className="w-full rounded-(--radius-panel) border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">
                {processingError}
              </p>
            )}
          </div>
        )}
      </div>
    </ProcessFlowShell>
  );
}
