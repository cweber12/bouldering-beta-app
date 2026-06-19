"use client";

import { useRef, useState } from "react";
import { cn } from "@/utils/cn";
import ProcessFlowShell from "@/components/scan/process-flow/ProcessFlowShell";
import FramePlayer, { type FramePlayerHandle } from "@/components/skeleton/FramePlayer";
import SkeletonStylePanel from "@/components/skeleton/SkeletonStylePanel";
import HoldsEditor from "@/components/scan/controls/HoldsEditor";
import { useScanHolds } from "@/hooks/useScanHolds";
import DeveloperViewToggle from "@/components/scan/controls/DeveloperViewToggle";
import RoutePhotoChooser from "@/components/scan/controls/RoutePhotoChooser";
import DiagnosticsPanel from "@/components/dev/DiagnosticsPanel";
import { useAdvancedView } from "@/hooks/useAdvancedView";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";
import type { SkeletonFrameData } from "@/pipeline/skeletonRenderer";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ScanDiagnostics } from "@/pipeline/diagnostics";

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
  // Route photo overlay (the "Place on route" hero action)
  orbReady: boolean;
  onViewOnRoutePhoto: (file: File) => void;
  // Save / upload
  onUpload: () => void;
  s3Saved: boolean;
  s3Loading: boolean;
  saveError: string | null;
  /** Navigate to the user's saved scans after a successful upload. */
  onViewScans: () => void;
  /** Dev-only detection diagnostics for the completed scan (panel is dev-gated). */
  scanDiagnostics?: ScanDiagnostics | null;
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
  scanDiagnostics,
}: StepViewLandmarksProps) {
  const { advanced } = useAdvancedView();
  const [showPhotoChooser, setShowPhotoChooser] = useState(false);
  const previewPlayerRef = useRef<FramePlayerHandle>(null);

  // Scan-stage Holds editing — Fixed Capture only (a Panning Capture Run, which
  // carries keyframes, has no single whole-Route frame to author on; its Holds
  // stay on the on-the-fly path). ADR 0009.
  const holdsEditable = !!activeAttempt && !(activeAttempt.keyframes?.length);
  const scanHolds = useScanHolds(activeAttempt, holdsEditable);

  function handleAddHold(kind: "hand" | "foot", side: "left" | "right") {
    scanHolds.addLimb(kind, side, previewPlayerRef.current?.getCurrentTime() ?? 0);
  }

  const showResults = !isProcessing && !!activeAttempt &&
    (orbStatus === "ready" || orbStatus === "failed");

  // No pose frame carried any keypoints → the Climber was never detected. The
  // Detection Preview has nothing to show, and Save/Test would be meaningless.
  const hasSkeleton = !!firstFrameSkeletonData;

  // ── Footer actions — only once results exist (with a skeleton) and before upload ──
  const showFooterActions = showResults && !s3Saved && hasSkeleton;

  // Purpose line — only while reviewing the traced climb (not during processing
  // or empty/error states, which carry their own messaging).
  const purpose = showResults && hasSkeleton && !s3Saved
    ? "Here's your climb traced frame by frame. Looks right? Place it on the route."
    : undefined;

  // "Save scan" stores the raw scan. It is the secondary action once a route
  // photo overlay is possible (orbReady); when it is not, it becomes the only —
  // and therefore primary — action.
  const saveIsPrimary = !orbReady;
  const saveScanButton = (
    <button
      type="button"
      onClick={onUpload}
      disabled={s3Loading}
      className={cn(
        "motion-cta flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold",
        s3Loading
          ? "ui-control border-edge bg-surface-alt/45 text-fg-muted opacity-60 cursor-not-allowed"
          : saveIsPrimary
            ? "ui-control-primary"
            : "ui-control",
      )}
      title="Save this scan without a route photo"
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
      Save scan
    </button>
  );

  // Skeleton style lives in the top toolbar (plateless icon) whenever a preview
  // is shown.
  const toolbarActions = showResults && hasSkeleton ? (
    <div className="ml-auto flex items-center gap-1">
      {holdsEditable && (
        <HoldsEditor
          entries={scanHolds.entries}
          onAdd={handleAddHold}
          onRemove={(entry) => scanHolds.removeHold(entry.hold)}
        />
      )}
      <SkeletonStylePanel
        onChange={onSkeletonStyleChange}
        size="sm"
        label="Overlay"
        variant="icon"
        footer={<DeveloperViewToggle />}
      />
    </div>
  ) : undefined;

  // Footer primary — the hero forward action: place the climb on a route photo.
  // Only available once reference features are ready (orbReady).
  const placeOnRouteButton = orbReady ? (
    <button
      type="button"
      onClick={() => setShowPhotoChooser(true)}
      className="motion-cta ui-control-primary flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold"
      title="Place your climb on a photo of the route"
    >
      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
      Place on route
    </button>
  ) : undefined;

  return (
    <>
    <ProcessFlowShell
      step={3}
      totalSteps={4}
      stepName={isProcessing ? "Scanning video" : "Review climb"}
      instruction={isProcessing ? "detecting pose frame by frame" : undefined}
      purpose={purpose}
      onBack={showFooterActions ? onEditClimb : undefined}
      toolbar={toolbarActions}
      primaryAction={showFooterActions ? (placeOnRouteButton ?? saveScanButton) : undefined}
      secondaryAction={showFooterActions && placeOnRouteButton ? saveScanButton : undefined}
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
            <p className="text-sm text-fg-secondary">Reading the wall texture&#8230;</p>
          </div>
        )}

        {/* ── Results — preview fills the stage, banners pinned above ── */}
        {(showResults || (!isProcessing && orbStatus === "failed") || processingError) && (
          <div className="flex h-full w-full flex-col gap-3 px-4 py-4 sm:px-6">

            {/* Banners — constrained + centered, never stretched to the stage width */}
            <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col gap-3 empty:hidden">
            {!isProcessing && orbStatus === "failed" && (
              <p className="text-center text-sm text-caution">
                We couldn&rsquo;t read the wall texture, so placing your climb on a route photo isn&rsquo;t available. You can still save the scan.
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

            {processingError && (
              <p className="w-full rounded-(--radius-panel) border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">
                {processingError}
              </p>
            )}
            </div>

            {/* No climber detected → explicit empty state instead of a dead spinner */}
            {showResults && !hasSkeleton && (
              <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 text-center">
                <svg className="h-10 w-10 text-fg-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 16.318A4.486 4.486 0 0012.016 15a4.486 4.486 0 00-3.198 1.318M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-fg">No climber detected in this scan</p>
                  <p className="mt-1 text-xs text-fg-secondary">
                    Try re-framing the climber or tapping them to seed tracking, then scan again.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onEditClimb}
                    className="ui-control-primary rounded-md px-4 py-2 text-sm font-medium"
                  >
                    Adjust detection
                  </button>
                  <button
                    type="button"
                    onClick={onScanAnother}
                    className="ui-control rounded-md px-4 py-2 text-sm font-medium"
                  >
                    Scan another
                  </button>
                </div>
              </div>
            )}

            {/* Animated preview — fills the stage, fitting the full width and height */}
            {showResults && hasSkeleton && (
              firstFrameFile && firstFrameSkeletonData ? (
                <FramePlayer
                  ref={previewPlayerRef}
                  imageFile={firstFrameFile}
                  layers={[{ frames: firstFrameSkeletonData.frames, style: topoStyle }]}
                  duration={firstFrameSkeletonData.duration}
                  autoPlay
                  holds={scanHolds.previewHolds}
                  orbKeypoints={advanced ? activeAttempt?.orbFeatures?.keypoints.map(kp => kp.pt) : undefined}
                  fit="contain"
                  bare
                  className="min-h-0 flex-1 rounded-none"
                />
              ) : (
                <p className="flex-1 text-xs text-fg-muted text-center">Loading preview&#8230;</p>
              )
            )}
          </div>
        )}
      </div>
    </ProcessFlowShell>
    <RoutePhotoChooser
      open={showPhotoChooser}
      onClose={() => setShowPhotoChooser(false)}
      onPhoto={(file) => { setShowPhotoChooser(false); onViewOnRoutePhoto(file); }}
    />
    <DiagnosticsPanel record={scanDiagnostics ?? null} />
    </>
  );
}
