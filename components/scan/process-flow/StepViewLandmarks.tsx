"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  // Route photo overlay
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
  const [showInfoDropdown, setShowInfoDropdown] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
  const routePhotoInputRef = useRef<HTMLInputElement>(null);

  // Close info dropdown on outside click
  useEffect(() => {
    if (!showInfoDropdown) return;
    function handler(e: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setShowInfoDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showInfoDropdown]);

  // Track scan start time for ETA calculation
  const scanStartTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (isProcessing) {
      if (scanStartTimeRef.current === null) scanStartTimeRef.current = Date.now();
    } else {
      scanStartTimeRef.current = null;
    }
  }, [isProcessing]);

  const etaText = useMemo(() => {
    if (!isProcessing || progressPct < 3 || scanStartTimeRef.current === null) return null;
    const elapsed = (Date.now() - scanStartTimeRef.current) / 1000;
    const totalEst = elapsed / (progressPct / 100);
    const remaining = Math.max(0, totalEst - elapsed);
    if (remaining < 5) return "almost done";
    if (remaining < 60) return `~${Math.ceil(remaining)}s remaining`;
    return `~${Math.ceil(remaining / 60)}m remaining`;
  }, [isProcessing, progressPct]);

  const showResults = !isProcessing && !!activeAttempt &&
    (orbStatus === "ready" || orbStatus === "failed");

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-y-auto">

      {/* ── Processing: vertically centered scan animation ── */}
      {isProcessing && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 gap-6">
          {/* Scan frame */}
          <div className="relative w-52 h-32 rounded-xl overflow-hidden border border-accent/30 bg-inset">
            {/* Grid pattern */}
            <div
              className="absolute inset-0 opacity-[0.08] pointer-events-none"
              style={{
                backgroundImage: "linear-gradient(var(--color-accent) 1px, transparent 1px), linear-gradient(90deg, var(--color-accent) 1px, transparent 1px)",
                backgroundSize: "18px 18px",
              }}
            />
            {/* Scanned area fill */}
            <div
              className="absolute inset-x-0 top-0 bg-accent/15 transition-all duration-300"
              style={{ height: `${progressPct}%` }}
            />
            {/* Glow centered on scan line */}
            <div
              className="absolute inset-x-0 h-10 pointer-events-none transition-all duration-300"
              style={{ top: `calc(${progressPct}% - 1.25rem)` }}
            >
              <div className="w-full h-full bg-linear-to-b from-transparent via-accent/30 to-transparent" />
            </div>
            {/* Scan line */}
            <div
              className="absolute inset-x-0 h-px bg-accent transition-all duration-300"
              style={{ top: `${progressPct}%` }}
            />
          </div>

          {/* Percentage */}
          <div className="text-center leading-none">
            <span className="text-5xl font-bold tabular-nums text-fg tracking-tight">{progressPct}</span>
            <span className="text-xl font-medium text-fg-secondary ml-1">%</span>
          </div>

          {/* Frame details + ETA */}
          <div className="flex flex-col items-center gap-1.5 text-center">
            <p className="text-sm text-fg-secondary">
              Frame {currentFrame} of {totalFrames}
              <span className="ml-1.5 text-fg-muted">· every {frameStep} frames</span>
            </p>
            {etaText && (
              <p className="text-xs text-fg-muted">{etaText}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Post-processing states ── */}
      {!isProcessing && orbStatus === "extracting" && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-fg-secondary">Extracting reference features&#8230;</p>
        </div>
      )}

      {/* ── Results area ── */}
      {(showResults || (!isProcessing && orbStatus === "failed") || processingError) && (
        <div className="mx-auto w-full max-w-2xl px-4 py-4 flex flex-col gap-4 sm:px-6 pb-8">

          {!isProcessing && orbStatus === "failed" && (
            <p className="text-center text-sm text-caution">
              Feature extraction failed &mdash; image matching will be unavailable.
            </p>
          )}

          {/* Upload success banner */}
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

          {/* Action toolbar — shown once results are ready, hidden after upload */}
          {showResults && !s3Saved && (
            <div className="flex items-center gap-2 flex-wrap">

              {/* Edit climb */}
              <button
                type="button"
                onClick={onEditClimb}
                className="flex items-center gap-1.5 rounded-lg border border-edge bg-card px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
              >
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                </svg>
                Edit
              </button>

              {/* Re-scan */}
              <button
                type="button"
                onClick={onScanAnother}
                className="flex items-center gap-1.5 rounded-lg border border-edge bg-card px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
              >
                <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                Scan another
              </button>

              {/* Scan metrics */}
              {activeAttempt && (
                <div ref={infoRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setShowInfoDropdown(p => !p)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                      showInfoDropdown
                        ? "border-send/50 bg-send-surface text-send"
                        : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg",
                    )}
                    aria-label="Scan metrics"
                    aria-expanded={showInfoDropdown}
                  >
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                    </svg>
                    Metrics
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

              {/* Skeleton style */}
              <SkeletonStylePanel onChange={onSkeletonStyleChange} size="sm" label="" />

              {/* Save to cloud — accented as primary action */}
              <button
                type="button"
                onClick={onUpload}
                disabled={s3Loading}
                className={cn(
                  "ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                  s3Loading
                    ? "border-edge bg-card text-fg-muted cursor-not-allowed opacity-60"
                    : "border-accent/40 bg-accent text-fg-inverse shadow-sm shadow-accent/20 hover:bg-accent/90",
                )}
                title="Save scan to cloud"
              >
                {s3Loading ? (
                  <svg className="h-3.5 w-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                  </svg>
                )}
                Save
              </button>

              {saveError && (
                <p className="w-full text-xs text-danger">{saveError}</p>
              )}
            </div>
          )}

          {/* Animated first-frame landmark preview */}
          {showResults && (
            <div className="flex flex-col gap-3">
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

              {/* Optional overlay action — secondary style since saving is the primary CTA */}
              {orbReady && (
                <>
                  <p className="text-xs text-fg-muted text-center">
                    Optional: upload a route photo to overlay your beta on the wall
                  </p>
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
                    className="flex items-center justify-center gap-2 w-full rounded-xl border border-edge bg-card px-4 py-2.5 text-sm font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
                  >
                    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                    Overlay on Route Photo
                  </button>
                </>
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
      )}
    </div>
  );
}
