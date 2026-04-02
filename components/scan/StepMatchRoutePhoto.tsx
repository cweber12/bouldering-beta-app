"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import FramePlayer from "@/components/shared/FramePlayer";
import SkeletonStylePanel from "@/components/shared/SkeletonStylePanel";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";
import type { SkeletonFrameData } from "@/pipeline/skeletonRenderer";
import type { ImageMatchResult, MatchStatus } from "@/hooks/useImageMatcher";
import type { SkeletonFrameStatus } from "@/hooks/useSkeletonFrames";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mediaContainerStyle(w: number, h: number): React.CSSProperties {
  const ratio = (w / h).toFixed(6);
  const maxH = "calc(100dvh - var(--nav-h) - 8rem)";
  return { width: `min(100%, calc(${maxH} * ${ratio}))`, maxHeight: maxH, aspectRatio: `${w} / ${h}` };
}

function fsMediaContainerStyle(w: number, h: number): React.CSSProperties {
  const ratio = (w / h).toFixed(6);
  const maxH = "calc(100dvh - 8rem)";
  return { width: `min(100%, calc(${maxH} * ${ratio}))`, maxHeight: maxH, aspectRatio: `${w} / ${h}` };
}

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
  const [showSaveDropdown,      setShowSaveDropdown]      = useState(false);

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

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 flex flex-col gap-4 sm:px-6 pb-8">

        {/* ── Toolbar ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Back */}
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-edge/50 bg-card/60 px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-accent/40 hover:bg-card hover:text-fg"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back
          </button>

          {/* View Climb */}
          {!routeMatchTriggered && (
            <button
              onClick={onApplyMatch}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-surface shadow-md shadow-accent/20 transition hover:bg-accent-hover"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              View Climb
            </button>
          )}

          {/* Export video */}
          {isFrameReady && exportStatus !== "rendering" && (
            <button
              onClick={onExportVideo}
              className="flex items-center gap-1.5 rounded-lg border border-edge/50 bg-card/60 px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
            >
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {exportStatus === "done" ? "Re-export video" : "Export video"}
            </button>
          )}

          {/* Skeleton style — shown once a match is in progress or done */}
          {routeMatchTriggered && (
            <SkeletonStylePanel onChange={onSkeletonStyleChange} />
          )}

          {/* Save dropdown */}
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setShowSaveDropdown(p => !p)}
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
              <div className="absolute right-0 top-full z-20 mt-1.5 w-52 rounded-xl border border-edge/50 bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl animate-fade-in">
                <button
                  onClick={() => { setShowSaveDropdown(false); onUpload(); }}
                  disabled={s3Loading}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-card hover:text-fg disabled:opacity-50"
                >
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                  </svg>
                  Upload
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
        </div>

        {/* Export progress */}
        {exportStatus === "rendering" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-fg-secondary">
              <span>Encoding video for download&#8230;</span>
              <span>{exportProgress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-inset">
              <div
                className="h-full rounded-full bg-accent transition-all duration-150"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Before match: crop region setup ── */}
        {!routeMatchTriggered && !isMatching && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-fg-secondary">
                Adjust the crop region for wall texture matching then click &ldquo;View Climb&rdquo;.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRoutePhotoFullscreen(true)}
                  className="rounded-lg border border-edge/50 bg-card/60 p-1.5 text-fg-muted hover:border-edge-hover hover:text-fg transition"
                  aria-label="Expand route photo to fullscreen"
                  title="Expand preview"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6L14 10M9 21H3m0 0v-6m0 6L10 14" />
                  </svg>
                </button>
                <label className="shrink-0 cursor-pointer text-xs text-fg-muted hover:text-fg transition">
                  Change photo
                  <input type="file" accept="image/*" className="hidden" onChange={handleChangePhotoInput} />
                </label>
              </div>
            </div>

            {/* Viewport-fit image with crop overlay */}
            <div
              className="relative overflow-hidden rounded-xl border border-edge/50 bg-card/70 shadow-lg shadow-black/10 mx-auto"
              style={mediaContainerStyle(routePhotoNaturalSize.w, routePhotoNaturalSize.h)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={routePhotoPreviewUrl}
                alt="Route photo preview"
                className="absolute inset-0 w-full h-full"
                style={{ objectFit: "fill" }}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setRoutePhotoNaturalSize({ w: img.naturalWidth || 4, h: img.naturalHeight || 3 });
                }}
              />
              <CropBoxOverlay box={routePhotoCrop} onChange={onRoutePhotoCropChange} borderRadius="0.75rem" />
            </div>
          </div>
        )}

        {/* Static preview while matching */}
        {routeMatchTriggered && (isMatching || !isFrameReady) && (
          <div className="flex flex-col gap-2">
            <div
              className="relative overflow-hidden rounded-xl border border-edge/50 bg-card/70 mx-auto"
              style={mediaContainerStyle(routePhotoNaturalSize.w, routePhotoNaturalSize.h)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={routePhotoPreviewUrl}
                alt="Route photo preview"
                className="absolute inset-0 w-full h-full"
                style={{ objectFit: "fill" }}
              />
            </div>
            {isMatching && (
              <p className="text-center text-sm text-fg-secondary">Matching features&#8230;</p>
            )}
          </div>
        )}

        {/* Match statistics */}
        {matchStatus === "done" && matchResult && (
          <div className="rounded-xl border border-edge/40 bg-card/60 px-5 py-4 flex flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-muted">Match statistics</p>
            <div className="mt-2 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xl font-bold text-fg">{matchResult.matches.length}</p>
                <p className="text-xs text-fg-muted">good matches</p>
              </div>
              <div>
                <p className="text-xl font-bold text-fg">{matchResult.queryKeypoints}</p>
                <p className="text-xs text-fg-muted">query keypoints</p>
              </div>
              <div>
                <p className="text-xl font-bold text-fg">{matchResult.referenceKeypoints}</p>
                <p className="text-xs text-fg-muted">reference keypoints</p>
              </div>
            </div>
            {matchResult.matches.length < 10 && (
              <p className="mt-3 text-xs text-caution">
                Fewer than 10 matches \u2014 the homography may be unstable. Try a closer or better-lit photo of the same wall section.
              </p>
            )}
          </div>
        )}

        {/* Pose overlay */}
        {isFrameReady && skeletonData && (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-muted">Pose overlay</p>
            <FramePlayer
              imageFile={routePhotoFile}
              layers={[{ frames: skeletonData.frames, style: topoStyle }]}
              duration={skeletonData.duration}
              autoPlay
            />
            {/* Change route photo */}
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-edge/50 bg-card/60 px-6 py-3 text-sm text-fg-secondary transition-all duration-200 hover:border-edge-hover hover:bg-card hover:text-fg">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18" />
              </svg>
              Change route photo
              <input type="file" accept="image/*" className="hidden" onChange={handleChangePhotoInput} />
            </label>
          </div>
        )}

        {saveError && <p className="text-xs text-danger">{saveError}</p>}

        {(matchStatus === "error" || frameStatus === "error") && (
          <p className="rounded-lg border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">
            {matchError ?? frameError}
          </p>
        )}
      </div>

      {/* ── Route photo fullscreen portal ── */}
      {routePhotoFullscreen && createPortal(
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-surface"
          role="dialog"
          aria-modal="true"
          aria-label="Route photo crop \u2014 fullscreen"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-edge/40 bg-surface-alt/80 backdrop-blur">
            <p className="text-sm font-medium text-fg">Route photo \u2014 adjust ORB crop region</p>
            <button
              onClick={() => setRoutePhotoFullscreen(false)}
              className="rounded-lg border border-edge/50 bg-card/60 p-1.5 text-fg-muted hover:border-edge-hover hover:text-fg transition"
              aria-label="Close fullscreen (Escape)"
              title="Close fullscreen (Esc)"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L3 3m0 0h6m-6 0V9M15 9l6-6m0 0v6m0-6h-6M9 15l-6 6m0 0h6m-6 0v-6M15 15l6 6m0 0v-6m0 6h-6" />
              </svg>
            </button>
          </div>

          <div className="flex-1 relative overflow-hidden flex items-center justify-center px-4 py-4 min-h-0">
            <div
              className="relative overflow-hidden rounded-xl border border-edge/40"
              style={fsMediaContainerStyle(routePhotoNaturalSize.w, routePhotoNaturalSize.h)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={routePhotoPreviewUrl}
                alt="Route photo preview"
                className="absolute inset-0 w-full h-full"
                style={{ objectFit: "fill" }}
              />
              <CropBoxOverlay box={routePhotoCrop} onChange={onRoutePhotoCropChange} borderRadius="0.75rem" />
            </div>
          </div>

          {!routeMatchTriggered && (
            <div className="flex justify-center gap-3 px-4 py-3 border-t border-edge/40 bg-surface-alt/80 backdrop-blur">
              <button
                onClick={() => { setRoutePhotoFullscreen(false); onApplyMatch(); }}
                className="flex items-center justify-center gap-2 rounded-xl bg-accent px-8 py-3 text-sm font-semibold text-surface shadow-lg shadow-accent/20 transition-all duration-200 hover:bg-accent-hover active:scale-[0.98]"
              >
                View Climb
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
