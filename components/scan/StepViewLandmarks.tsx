"use client";

import { useRef, useState } from "react";
import FramePlayer from "@/components/shared/FramePlayer";
import SkeletonStylePanel from "@/components/shared/SkeletonStylePanel";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";
import type { RenderedSkeletonFrame } from "@/pipeline/skeletonRenderer";
import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface SkeletonFrameData {
  frames: RenderedSkeletonFrame[];
  duration: number;
}

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
  // Skeleton style
  onSkeletonStyleChange: (s: SkeletonStyle) => void;
  // Toolbar actions
  orbReady: boolean;
  onViewOnRoutePhoto: (file: File) => void;
  onEditClimb: () => void;
  // Save actions — open parent bottom sheet
  onSaveToDevice: () => void;
  onUpload: () => void;
  s3Saved: boolean;
  s3Loading: boolean;
  savedRouteDirHandle: FileSystemDirectoryHandle | null;
  onDeleteFromDevice: () => void;
  saveError: string | null;
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
  orbReady,
  onViewOnRoutePhoto,
  onEditClimb,
  onSaveToDevice,
  onUpload,
  s3Saved,
  s3Loading,
  savedRouteDirHandle,
  onDeleteFromDevice,
  saveError,
}: StepViewLandmarksProps) {
  const routePhotoInputRef = useRef<HTMLInputElement>(null);
  const [showOptionsDropdown, setShowOptionsDropdown] = useState(false);
  const [showSaveDropdown,    setShowSaveDropdown]    = useState(false);

  function handleRoutePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      onViewOnRoutePhoto(file);
      e.target.value = "";
    }
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
              <span className="ml-1.5 text-fg-muted">\u2014 pose every {frameStep} frames</span>
            </p>
          </div>
        )}

        {!isProcessing && orbStatus === "extracting" && (
          <p className="text-center text-sm text-fg-secondary">Extracting reference features&#8230;</p>
        )}
        {!isProcessing && orbStatus === "failed" && (
          <p className="text-center text-sm text-caution">
            Feature extraction failed \u2014 image matching will be unavailable.
          </p>
        )}

        {/* ── Toolbar (shown once results are ready) ── */}
        {showResults && (
          <div className="flex items-center gap-2 flex-wrap">

            {/* Options dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => { setShowOptionsDropdown(p => !p); setShowSaveDropdown(false); }}
                className={[
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                  showOptionsDropdown
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
                ].join(" ")}
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="19" cy="12" r="1.5" fill="currentColor" />
                </svg>
                Options
                <svg
                  className={["h-3 w-3 transition-transform", showOptionsDropdown ? "rotate-180" : ""].join(" ")}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showOptionsDropdown && (
                <div className="absolute left-0 top-full z-20 mt-1.5 w-52 rounded-xl border border-edge/50 bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl animate-fade-in">
                  {orbReady && (
                    <label className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-accent/10 hover:text-fg">
                      <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18" />
                      </svg>
                      View on Route Photo
                      <input
                        ref={routePhotoInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleRoutePhotoFile}
                      />
                    </label>
                  )}
                  <button
                    onClick={() => { setShowOptionsDropdown(false); onEditClimb(); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-card hover:text-fg"
                  >
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                    </svg>
                    Edit Climb
                  </button>
                </div>
              )}
            </div>

            {/* Save dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => { setShowSaveDropdown(p => !p); setShowOptionsDropdown(false); }}
                className={[
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                  showSaveDropdown
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : s3Saved
                    ? "border-send/30 bg-send-surface text-send"
                    : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
                ].join(" ")}
              >
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                {s3Saved ? "Saved" : "Save"}
                <svg
                  className={["h-3 w-3 transition-transform", showSaveDropdown ? "rotate-180" : ""].join(" ")}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showSaveDropdown && (
                <div className="absolute left-0 top-full z-20 mt-1.5 w-52 rounded-xl border border-edge/50 bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl animate-fade-in">
                  <button
                    onClick={() => { setShowSaveDropdown(false); onUpload(); }}
                    disabled={s3Loading}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-card hover:text-fg disabled:opacity-50"
                  >
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                    </svg>
                    {s3Saved ? "Uploaded" : "Upload"}
                  </button>
                  <button
                    onClick={() => { setShowSaveDropdown(false); onSaveToDevice(); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-card hover:text-fg"
                  >
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Download to Device
                  </button>
                  {savedRouteDirHandle && (
                    <button
                      onClick={() => { setShowSaveDropdown(false); onDeleteFromDevice(); }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger-surface"
                    >
                      <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                      Delete from device
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Skeleton style — always visible in toolbar */}
            <SkeletonStylePanel onChange={onSkeletonStyleChange} />

            {saveError && (
              <p className="w-full text-xs text-danger">{saveError}</p>
            )}
          </div>
        )}

        {/* ── Analysis summary ── */}
        {showResults && activeAttempt && (
          <div className="rounded-2xl border border-success/20 bg-success/5 px-5 py-4 shadow-sm shadow-success/5">
            <p className="text-sm font-semibold text-success">Analysis complete</p>
            <p className="mt-1 text-xs text-success/70 leading-relaxed">
              {activeAttempt.frames.length} pose frames &middot;{" "}
              {activeAttempt.orbFeatures?.keypoints.length ?? 0} reference points extracted
              {activeAttempt.state && ` \u2014 ${activeAttempt.state}`}
              {activeAttempt.area  && ` \u203a ${activeAttempt.area}`}
              {activeAttempt.route && ` \u203a ${activeAttempt.route}`}
            </p>
          </div>
        )}

        {/* ── Animated first-frame landmark preview ── */}
        {showResults && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-muted">Recorded pose landmarks</p>
            {firstFrameFile && firstFrameSkeletonData ? (
              <FramePlayer
                imageFile={firstFrameFile}
                layers={[{ frames: firstFrameSkeletonData.frames, style: topoStyle }]}
                duration={firstFrameSkeletonData.duration}
                autoPlay
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
