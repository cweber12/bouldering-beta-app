"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ProcessFlowShell from "@/components/scan/process-flow/ProcessFlowShell";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import FramePlayer from "@/components/shared/FramePlayer";
import SkeletonStylePanel from "@/components/shared/SkeletonStylePanel";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import SaveDropdown from "@/components/scan/controls/SaveDropdown";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";
import type { SkeletonFrameData } from "@/pipeline/skeletonRenderer";
import type { ImageMatchResult, MatchStatus } from "@/hooks/useImageMatcher";
import type { SkeletonFrameStatus } from "@/hooks/useSkeletonFrames";
import { mediaContainerStyle, fsMediaContainerStyle } from "@/utils/mediaContainerStyle";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface StepMatchRoutePhotoProps {
  routePhotoFile: File;
  routePhotoPreviewUrl: string;
  routePhotoCrop: CropFraction;
  onRoutePhotoCropChange: (c: CropFraction) => void;
  routeMatchTriggered: boolean;
  // Matching
  matchResult: ImageMatchResult | null;
  matchStatus: MatchStatus;
  matchError: string | null;
  // Skeleton overlay
  skeletonData: SkeletonFrameData | null;
  frameStatus: SkeletonFrameStatus;
  frameError: string | null;
  topoStyle: SkeletonStyle;
  isFrameReady: boolean;
  isMatching: boolean;
  // Skeleton style
  onSkeletonStyleChange: (s: SkeletonStyle) => void;
  // Export
  exportStatus: "idle" | "rendering" | "done";
  exportProgress: number;
  // Callbacks
  onApplyMatch: () => void;
  onExportVideo: () => void;
  onChangePhoto: (file: File) => void;
  onBack: () => void;
  // Save — open parent bottom sheet
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
export default function StepMatchRoutePhoto({
  routePhotoFile,
  routePhotoPreviewUrl,
  routePhotoCrop,
  onRoutePhotoCropChange,
  routeMatchTriggered,
  matchResult,
  matchStatus,
  matchError,
  skeletonData,
  frameStatus,
  frameError,
  topoStyle,
  isFrameReady,
  isMatching,
  onSkeletonStyleChange,
  exportStatus,
  exportProgress,
  onApplyMatch,
  onExportVideo,
  onChangePhoto,
  onBack,
  onSaveToDevice,
  onUpload,
  s3Saved,
  s3Loading,
  savedRouteDirHandle,
  onDeleteFromDevice,
  saveError,
}: StepMatchRoutePhotoProps) {
  const [routePhotoNaturalSize, setRoutePhotoNaturalSize] = useState<{ w: number; h: number }>({ w: 4, h: 3 });
  const [routePhotoFullscreen,  setRoutePhotoFullscreen]  = useState(false);
  const [showMatchStats,        setShowMatchStats]        = useState(false);
  const matchStatsRef = useRef<HTMLDivElement>(null);

  // Close match stats when clicking outside.
  useEffect(() => {
    if (!showMatchStats) return;
    function handler(e: MouseEvent) {
      if (matchStatsRef.current && !matchStatsRef.current.contains(e.target as Node)) {
        setShowMatchStats(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMatchStats]);

  // ESC closes fullscreen
  useEffect(() => {
    if (!routePhotoFullscreen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setRoutePhotoFullscreen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [routePhotoFullscreen]);

  function handleChangePhotoInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { onChangePhoto(file); e.target.value = ""; }
  }

  const playerRatio = (routePhotoNaturalSize.w / routePhotoNaturalSize.h).toFixed(4);
  const playerMaxWidth = `min(100%, calc((100dvh - var(--nav-h) - 11rem) * ${playerRatio}))`;

  const instruction = isMatching
    ? "matching features…"
    : !routeMatchTriggered
      ? "frame the wall texture, then project"
      : !isFrameReady
        ? "building overlay…"
        : "review, then save";

  // ── Footer actions ──────────────────────────────────────────────────────
  const projectButton = (
    <button
      type="button"
      onClick={onApplyMatch}
      className="motion-cta ui-control-primary flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold"
    >
      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      Project skeleton
    </button>
  );

  const saveDropdown = (
    <SaveDropdown
      s3Saved={s3Saved}
      s3Loading={s3Loading}
      savedRouteDirHandle={savedRouteDirHandle}
      onUpload={onUpload}
      onSaveToDevice={onSaveToDevice}
      onDeleteFromDevice={onDeleteFromDevice}
      dropdownAlign="right"
      openUpward
    />
  );

  // ── Plateless toolbar controls ────────────────────────────────────────────
  const changePhotoBtn = (
    <label
      className="ui-icon-btn flex h-8 w-8 cursor-pointer items-center justify-center"
      title="Change photo"
      aria-label="Change route photo"
    >
      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
      </svg>
      <input type="file" accept="image/*" className="hidden" onChange={handleChangePhotoInput} />
    </label>
  );

  const expandBtn = (
    <button
      type="button"
      onClick={() => setRoutePhotoFullscreen(true)}
      className="ui-icon-btn flex h-8 w-8 items-center justify-center"
      aria-label="Expand route photo to fullscreen"
      title="Expand preview"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6L14 10M9 21H3m0 0v-6m0 6L10 14" />
      </svg>
    </button>
  );

  const exportBtn = exportStatus !== "rendering" ? (
    <button
      type="button"
      onClick={onExportVideo}
      className="ui-icon-btn flex h-8 w-8 items-center justify-center"
      aria-label={exportStatus === "done" ? "Re-export video" : "Export video"}
      title={exportStatus === "done" ? "Re-export" : "Export"}
    >
      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    </button>
  ) : null;

  // ── Match stats popover (floating, after match) ──
  const matchStatsControl = matchStatus === "done" && matchResult ? (
    <div ref={matchStatsRef} className="relative">
      <button
        type="button"
        onClick={() => setShowMatchStats(p => !p)}
        className="ui-icon-btn flex h-8 w-8 items-center justify-center"
        aria-label="Match statistics"
        aria-expanded={showMatchStats}
        title="Match statistics"
      >
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      </button>
      {showMatchStats && (
        <div className="ui-popover absolute right-0 top-full z-30 mt-1.5 w-56 px-4 py-3">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-fg">{matchResult.matches.length}</p>
              <p className="text-xs text-fg-muted">matches</p>
            </div>
            <div>
              <p className="text-xl font-bold text-fg">{matchResult.queryKeypoints}</p>
              <p className="text-xs text-fg-muted">query pts</p>
            </div>
            <div>
              <p className="text-xl font-bold text-fg">{matchResult.referenceKeypoints}</p>
              <p className="text-xs text-fg-muted">ref pts</p>
            </div>
          </div>
          {matchResult.matches.length < 10 && (
            <p className="mt-2 text-xs text-caution">
              Fewer than 10 matches &mdash; the homography may be unstable.
            </p>
          )}
        </div>
      )}
    </div>
  ) : null;

  const errorText = saveError ?? (matchStatus === "error" || frameStatus === "error" ? (matchError ?? frameError) : null);

  // ── Toolbar — plateless utility cluster, contextual to match state ──
  const toolbarNode =
    !routeMatchTriggered && !isMatching ? (
      <div className="ml-auto flex items-center gap-1">
        {changePhotoBtn}
        {expandBtn}
      </div>
    ) : isFrameReady && skeletonData ? (
      <div className="ml-auto flex items-center gap-1">
        <SkeletonStylePanel onChange={onSkeletonStyleChange} size="sm" label="" variant="icon" />
        {matchStatsControl}
        {exportBtn}
      </div>
    ) : undefined;

  return (
    <>
      <ProcessFlowShell
        step={3}
        totalSteps={3}
        stepName="Overlay on photo"
        instruction={instruction}
        onBack={onBack}
        toolbar={toolbarNode}
        primaryAction={routeMatchTriggered ? saveDropdown : projectButton}
      >
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-3 sm:p-4">

          {errorText && (
            <p className="feedback-banner feedback-banner-danger max-w-md text-center">{errorText}</p>
          )}

          {/* Before match: route photo with crop overlay */}
          {!routeMatchTriggered && !isMatching && (
            <div
              className="relative overflow-hidden rounded-(--radius-panel) border border-edge/50 bg-surface-alt/55 shadow-lg shadow-black/10"
              style={mediaContainerStyle(routePhotoNaturalSize.w, routePhotoNaturalSize.h, "11rem")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={routePhotoPreviewUrl}
                alt="Route photo preview"
                className="absolute inset-0 w-full h-full object-fill"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setRoutePhotoNaturalSize({ w: img.naturalWidth || 4, h: img.naturalHeight || 3 });
                }}
              />
              <CropBoxOverlay box={routePhotoCrop} onChange={onRoutePhotoCropChange} borderRadius="2px" />
            </div>
          )}

          {/* Matching / building overlay */}
          {routeMatchTriggered && (isMatching || !isFrameReady) && (
            <div className="flex flex-col items-center gap-4">
              <LoadingSpinner className="h-10 w-10" />
              <p className="text-sm text-fg-secondary animate-pulse">
                {isMatching ? "Matching features…" : "Building overlay…"}
              </p>
            </div>
          )}

          {/* After: pose overlay player */}
          {isFrameReady && skeletonData && (
            <div className="mx-auto w-full" style={{ maxWidth: playerMaxWidth }}>
              <FramePlayer
                imageFile={routePhotoFile}
                layers={[{ frames: skeletonData.frames, style: topoStyle }]}
                duration={skeletonData.duration}
                autoPlay
              />

              {/* Export progress — plateless strip below the player */}
              {exportStatus === "rendering" && (
                <div className="mt-1.5 flex flex-col gap-1 px-1">
                  <div className="flex items-center justify-between text-[11px] text-fg-muted">
                    <span>Encoding video&#8230;</span>
                    <span>{exportProgress}%</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-inset">
                    <div className="h-full rounded-full bg-accent transition-all duration-150" style={{ width: `${exportProgress}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ProcessFlowShell>

      {/* ── Route photo fullscreen portal (crop adjustment) ── */}
      {routePhotoFullscreen && createPortal(
        <div
          className="fixed inset-0 z-fullscreen flex flex-col bg-surface"
          role="dialog"
          aria-modal="true"
          aria-label="Route photo crop — fullscreen"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
            <p className="text-sm font-medium text-fg">Route photo &mdash; adjust ORB crop region</p>
            <button
              onClick={() => setRoutePhotoFullscreen(false)}
              className="ui-icon-btn flex h-8 w-8 items-center justify-center"
              aria-label="Close fullscreen (Escape)"
              title="Close fullscreen (Esc)"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L3 3m0 0h6m-6 0V9M15 9l6-6m0 0v6m0-6h-6M9 15l-6 6m0 0h6m-6 0v-6M15 15l6 6m0 0v-6m0 6h-6" />
              </svg>
            </button>
          </header>

          <div className="flex-1 relative overflow-hidden flex items-center justify-center px-4 py-4 min-h-0">
            <div
              className="relative overflow-hidden rounded-(--radius-panel) border border-edge/40"
              style={fsMediaContainerStyle(routePhotoNaturalSize.w, routePhotoNaturalSize.h)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={routePhotoPreviewUrl}
                alt="Route photo preview"
                className="absolute inset-0 w-full h-full object-fill"
              />
              <CropBoxOverlay box={routePhotoCrop} onChange={onRoutePhotoCropChange} borderRadius="2px" />
            </div>
          </div>

          {!routeMatchTriggered && (
            <footer className="flex justify-center gap-3 border-t border-edge/40 bg-surface px-4 py-3">
              <button
                onClick={() => { setRoutePhotoFullscreen(false); onApplyMatch(); }}
                className="ui-control-primary flex items-center justify-center gap-2 rounded-md px-8 py-3 text-sm font-semibold"
              >
                Project skeleton
              </button>
            </footer>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
