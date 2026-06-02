"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";
import ProcessFlowShell from "@/components/scan/process-flow/ProcessFlowShell";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import type { MediaPipeVariant } from "@/hooks/usePoseModel";
import {
  QUALITY_TIERS,
  TIER_LABELS,
  TIER_DESCRIPTIONS,
  type QualityTier,
} from "@/utils/poseTiers";
import { mediaContainerStyle, fsMediaContainerStyle } from "@/utils/mediaContainerStyle";

const CLIMBER_COLOR = "rgba(255,255,255,0.90)";
const WALL_COLOR = "rgba(251,191,36,0.90)";
type CropMode = "climber" | "wall";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatVideoTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// CropToolbar — module-level so React never remounts it on parent re-render.
// Calm by default: just the Climber/Wall mode toggle and a single "Settings"
// popover holding the quality tier, pose model, and sampling frequency. These
// are set-once preferences, not per-scan decisions, so they stay pocketed.
// ---------------------------------------------------------------------------
interface CropToolbarProps {
  cropMode: CropMode;
  showSettings: boolean;
  tier: QualityTier;
  modelVariant: MediaPipeVariant;
  frameStep: number;
  onCropModeChange: (mode: CropMode) => void;
  onToggleSettings: () => void;
  onCloseSettings: () => void;
  onTierChange: (t: QualityTier) => void;
  onModelVariantChange: (v: MediaPipeVariant) => void;
  onFrameStepChange: (n: number) => void;
}

function CropToolbar({
  cropMode,
  showSettings,
  tier,
  modelVariant,
  frameStep,
  onCropModeChange,
  onToggleSettings,
  onCloseSettings,
  onTierChange,
  onModelVariantChange,
  onFrameStepChange,
}: CropToolbarProps) {
  const settingsRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showSettings) return;
    function handler(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        onCloseSettings();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSettings, onCloseSettings]);

  return (
    <>
      {/* Crop-mode toggle */}
      <div className="flex items-center gap-1 rounded-lg border border-edge/70 bg-surface-alt/55 p-1 text-xs">
        <button
          type="button"
          onClick={() => onCropModeChange("climber")}
          className={cn(
            "ui-chip-toggle rounded-md px-2.5 py-1 font-medium",
            cropMode === "climber" ? "border-accent/50 bg-accent/15 text-fg" : "",
          )}
          aria-pressed={cropMode === "climber"}
        >
          Climber
        </button>
        <button
          type="button"
          onClick={() => onCropModeChange("wall")}
          className={cn(
            "ui-chip-toggle rounded-md px-2.5 py-1 font-medium",
            cropMode === "wall" ? "border-caution-border bg-caution-surface text-fg" : "",
          )}
          aria-pressed={cropMode === "wall"}
        >
          Wall texture
        </button>
      </div>

      {/* Detection settings dropdown — quality tier + model + sampling */}
      <div ref={settingsRef} className="relative">
        <button
          type="button"
          onClick={onToggleSettings}
          className={cn(
            "ui-control motion-cta flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium",
            showSettings ? "border-accent/60 bg-accent/10 text-accent" : "",
          )}
          title="Detection settings"
          aria-label="Detection settings"
          aria-expanded={showSettings}
        >
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>

        {showSettings && (
          <div className="ui-popover animate-fade-in absolute left-0 top-full z-30 mt-1.5 w-72 p-3">
            <div className="flex flex-col gap-3">
              {/* Quality tier */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-fg-secondary">Detection quality</label>
                <div
                  className="flex items-center gap-1 rounded-lg border border-edge/70 bg-surface-alt/55 p-1 text-xs"
                  role="group"
                  aria-label="Detection quality"
                >
                  {QUALITY_TIERS.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onTierChange(t)}
                      className={cn(
                        "ui-chip-toggle flex-1 rounded-md px-2 py-1 font-medium",
                        tier === t ? "border-accent/50 bg-accent/15 text-fg" : "",
                      )}
                      aria-pressed={tier === t}
                      title={TIER_DESCRIPTIONS[t]}
                    >
                      {TIER_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pose model override */}
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-fg-secondary">Pose model</label>
                <select
                  value={modelVariant}
                  onChange={e => onModelVariantChange(e.target.value as MediaPipeVariant)}
                  className="ui-input w-auto px-2 py-1 text-xs"
                >
                  <option value="lite">Lite (fast)</option>
                  <option value="full">Full (balanced)</option>
                  <option value="heavy">Heavy (accurate)</option>
                </select>
              </div>

              {/* Sampling frequency */}
              <label className="flex items-center justify-between text-xs">
                <span className="font-medium text-fg-secondary">Detection frequency</span>
                <span className="font-mono text-fg">every {frameStep} frames</span>
              </label>
              <input
                type="range" min={1} max={30} value={frameStep}
                onChange={e => onFrameStepChange(Number(e.target.value))}
                className="w-full accent-accent" aria-label="Frame step"
              />
              <p className="text-xs text-fg-muted">
                1 = every frame (slowest) &mdash; 30 = every 30th frame (fastest, more interpolation)
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface StepSetDetectionProps {
  videoPreviewUrl: string;
  climberCrop: CropFraction;
  wallCrop?: CropFraction;
  onClimberCropChange: (c: CropFraction) => void;
  onWallCropChange?: (c: CropFraction) => void;
  /** Normalised point [0,1] the user tapped to identify the climber, if any. */
  climberPoint?: { x: number; y: number } | null;
  onClimberPointChange?: (p: { x: number; y: number } | null) => void;
  tier: QualityTier;
  onTierChange: (t: QualityTier) => void;
  modelVariant: MediaPipeVariant;
  onModelVariantChange: (v: MediaPipeVariant) => void;
  frameStep: number;
  onFrameStepChange: (n: number) => void;
  /** True when model and cv are both ready to scan. */
  canScan: boolean;
  /** Called with the video start time when the user confirms. */
  onScan: (startTime: number) => void;
  /** Navigates back to StepPickVideo. */
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function StepSetDetection({
  videoPreviewUrl,
  climberCrop,
  wallCrop,
  onClimberCropChange,
  onWallCropChange,
  climberPoint,
  onClimberPointChange,
  tier,
  onTierChange,
  modelVariant,
  onModelVariantChange,
  frameStep,
  onFrameStepChange,
  canScan,
  onScan,
  onBack,
}: StepSetDetectionProps) {
  // ── Video refs / state ─────────────────────────────────────────────────
  const cropVideoRef       = useRef<HTMLVideoElement>(null);
  const cropCanvasRef      = useRef<HTMLCanvasElement>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);

  const [hasCropFrame,       setHasCropFrame]       = useState(false);
  const [isPlaying,          setIsPlaying]          = useState(false);
  const [videoCurrentTime,   setVideoCurrentTime]   = useState(0);
  const [videoDuration,      setVideoDuration]      = useState(0);
  const [videoNaturalSize,   setVideoNaturalSize]   = useState<{ w: number; h: number }>({ w: 16, h: 9 });
  const [videoFullscreen,    setVideoFullscreen]    = useState(false);
  const [fsVideoCurrentTime, setFsVideoCurrentTime] = useState(0);
  const [fsIsPlaying,        setFsIsPlaying]        = useState(false);

  // Crop move tracking — unchecked until user drags the box
  const [climberCropMoved, setClimberCropMoved] = useState(false);
  const [showCropWarning,  setShowCropWarning]  = useState(false);
  const [cropMode, setCropMode] = useState<CropMode>("climber");

  // Detection settings popover (quality / model / sampling) — hidden by default.
  const [showSettings, setShowSettings] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────
  function handleClimberCropChange(c: CropFraction) {
    setClimberCropMoved(true);
    setShowCropWarning(false);
    onClimberCropChange(c);
  }

  function handleWallCropChange(c: CropFraction) {
    onWallCropChange?.(c);
  }

  // Tap the climber to lock detection onto them. Seeds a default portrait box
  // around the tap (for the visual crop + wall-region derivation); processing
  // refines the box adaptively from the climber's landmarks.
  function handleClimberTap(p: { x: number; y: number }) {
    setClimberCropMoved(true);
    setShowCropWarning(false);
    onClimberPointChange?.(p);
    const w = 0.34;
    const h = 0.6;
    onClimberCropChange({
      x: Math.max(0, Math.min(1 - w, p.x - w / 2)),
      y: Math.max(0, Math.min(1 - h, p.y - h / 2)),
      w,
      h,
    });
  }

  function handleCropVideoLoaded() {
    const video  = cropVideoRef.current;
    const canvas = cropCanvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setHasCropFrame(true);
    setVideoDuration(video.duration || 0);
    setVideoNaturalSize({ w: video.videoWidth || 16, h: video.videoHeight || 9 });
  }

  function handleFsPlayPause() {
    const v = fullscreenVideoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
  }

  function handleFsSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = fullscreenVideoRef.current;
    if (!v) return;
    v.currentTime = Number(e.target.value);
    setFsVideoCurrentTime(Number(e.target.value));
  }

  function handleVideoPlayPause() {
    const video = cropVideoRef.current;
    if (!video) return;
    if (video.paused) { video.play().catch(() => {}); } else { video.pause(); }
  }

  function handleVideoSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const video = cropVideoRef.current;
    if (!video) return;
    video.currentTime = Number(e.target.value);
  }

  function doScan() {
    setShowCropWarning(false);
    const t = (videoFullscreen ? fullscreenVideoRef.current?.currentTime : cropVideoRef.current?.currentTime) ?? 0;
    onScan(t > 0 ? t : 0);
  }

  function handleScanClick() {
    if (!climberCropMoved) {
      setShowCropWarning(true);
      return;
    }
    doScan();
  }

  // ESC key closes fullscreen
  useEffect(() => {
    if (!videoFullscreen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setVideoFullscreen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoFullscreen]);

  // ── Shared crop toolbar props ──────────────────────────────────────────
  const cropToolbarProps: CropToolbarProps = {
    cropMode,
    showSettings,
    tier,
    modelVariant,
    frameStep,
    onCropModeChange: setCropMode,
    onToggleSettings: () => setShowSettings(p => !p),
    onCloseSettings:  () => setShowSettings(false),
    onTierChange,
    onModelVariantChange,
    onFrameStepChange,
  };

  // Marker showing which climber the user tapped (shared inline + fullscreen).
  const climberMarker = cropMode === "climber" && climberPoint ? (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left: `${climberPoint.x * 100}%`,
        top: `${climberPoint.y * 100}%`,
        transform: "translate(-50%, -50%)",
      }}
      aria-hidden="true"
    >
      <div className="h-4 w-4 rounded-full border-2 border-send bg-send/40" />
    </div>
  ) : null;

  // Re-tap button — clears the selection so the whole frame is tappable again.
  const reselectClimberBtn = cropMode === "climber" && climberPoint != null ? (
    <button
      type="button"
      onClick={() => onClimberPointChange?.(null)}
      className="ui-control shrink-0 px-2.5 py-1 text-xs font-medium text-fg-secondary"
    >
      Re-tap climber
    </button>
  ) : null;

  // Status / guidance line — replaces the old read-only status chips. Surfaces
  // the "tap the climber" requirement *before* a failed scan (prevent, don't
  // scold) and confirms the lock once set.
  const statusLine = !hasCropFrame ? null : (
    <div className="flex items-center gap-2 flex-wrap">
      {cropMode === "wall" ? (
        <p className="text-xs text-fg-muted">
          Wall crop: frame stable wall texture and avoid the climber body when possible.
        </p>
      ) : climberPoint == null ? (
        <div className="flex items-center gap-2 rounded-md border border-caution-border bg-caution-surface px-3 py-1.5 text-xs font-medium text-caution">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
          Tap the climber — on their torso or hips — to lock detection onto them.
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-send/30 bg-send-surface px-3 py-1.5 text-xs font-medium text-send">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Tracking this climber. Drag the box to fine-tune, or re-tap to switch.
        </div>
      )}
      {reselectClimberBtn}
    </div>
  );

  // Crop overlay (shared inline + fullscreen). In climber mode, before a tap the
  // overlay is a bare tap surface so the box never blocks tapping the climber;
  // after a tap the derived box is shown for manual fine-tuning.
  const cropOverlayNode = !hasCropFrame ? null : cropMode === "wall" ? (
    <CropBoxOverlay
      box={wallCrop ?? climberCrop}
      onChange={handleWallCropChange}
      borderRadius="4px"
      color={WALL_COLOR}
    />
  ) : climberPoint == null ? (
    <CropBoxOverlay
      tapOnly
      box={climberCrop}
      onChange={() => {}}
      onTap={handleClimberTap}
      color={CLIMBER_COLOR}
    />
  ) : (
    <CropBoxOverlay
      box={climberCrop}
      onChange={handleClimberCropChange}
      onTap={handleClimberTap}
      borderRadius="4px"
      color={CLIMBER_COLOR}
    />
  );

  // ── Crop warning (fallback when scan is pressed with no climber tapped) ──
  const cropWarningBanner = showCropWarning ? (
    <div className="flex items-start gap-2.5 rounded-xl border border-caution-border bg-caution-surface px-3 py-2.5">
      <svg className="h-4 w-4 shrink-0 text-caution mt-0.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        <p className="text-xs font-medium text-caution">
          No climber selected — tap the climber so detection locks onto them. Otherwise the strongest pose is used, which may pick the wrong person.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCropWarning(false)}
            className="ui-control flex-1 border-caution-border px-2.5 py-1.5 text-xs font-medium text-caution hover:bg-caution/10"
          >
            Tap climber
          </button>
          <button
            type="button"
            onClick={doScan}
            className="ui-control flex-1 border-caution/40 bg-caution/10 px-2.5 py-1.5 text-xs font-medium text-caution hover:bg-caution/20"
          >
            Scan anyway
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // ── Scan CTA — lives in the sticky shell footer (inline) and the fullscreen
  //    footer, so it is always visible regardless of media aspect ratio. ──
  function scanButton(size: "footer" | "fullscreen") {
    return (
      <button
        type="button"
        onClick={handleScanClick}
        disabled={!canScan}
        className={cn(
          "motion-cta flex items-center justify-center gap-2 rounded-md text-sm font-semibold",
          size === "fullscreen" ? "px-10 py-3" : "px-6 py-2.5",
          canScan
            ? "ui-control-primary"
            : "ui-control border-edge bg-surface-alt/45 text-fg-muted opacity-60 cursor-not-allowed",
        )}
        title={canScan ? "Start pose detection" : "Loading model…"}
      >
        {canScan ? (
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
          </svg>
        ) : (
          <svg className="h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {canScan ? "Scan video" : "Loading model…"}
      </button>
    );
  }

  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="ui-control flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium"
    >
      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
      </svg>
      Back
    </button>
  );

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      <ProcessFlowShell
        step={2}
        totalSteps={3}
        title="Set detection"
        subtitle="Tap the climber to lock tracking, then scan to detect their pose."
        secondaryAction={backButton}
        primaryAction={scanButton("footer")}
      >
        <div className="h-full overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 pb-8 sm:px-6">

            {/* Inline toolbar — relative z-10 keeps the settings popover above the
                video container below, even when backdrop-filter is present. */}
            <div className="relative z-10 flex items-center gap-2 flex-wrap">
              <CropToolbar {...cropToolbarProps} />
              {/* Expand to fullscreen */}
              <button
                type="button"
                onClick={() => setVideoFullscreen(true)}
                className="ui-control ml-auto p-1.5 text-fg-muted"
                aria-label="Expand video preview"
                title="Expand preview"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6L14 10M9 21H3m0 0v-6m0 6L10 14" />
                </svg>
              </button>
            </div>

            {/* Status / guidance */}
            {statusLine}

            {/* Crop warning (fallback) */}
            {cropWarningBanner}

            {/* Viewport-fit video container */}
            <div
              className="relative overflow-hidden rounded-2xl border border-edge/50 bg-surface shadow-lg shadow-black/10 mx-auto"
              style={mediaContainerStyle(videoNaturalSize.w, videoNaturalSize.h, "14rem")}
            >
              <video
                ref={cropVideoRef}
                src={videoPreviewUrl}
                muted
                playsInline
                onLoadedData={handleCropVideoLoaded}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={() => setVideoCurrentTime(cropVideoRef.current?.currentTime ?? 0)}
                onDurationChange={() => setVideoDuration(cropVideoRef.current?.duration ?? 0)}
                className="absolute inset-0 w-full h-full object-fill"
              />
              {cropOverlayNode}
              {hasCropFrame && climberMarker}
              <canvas ref={cropCanvasRef} className="hidden" />
            </div>

            {/* Inline video controls */}
            {hasCropFrame && (
              <div className="flex items-center gap-3 rounded-xl border border-edge/40 bg-surface-alt/55 px-3 py-2">
                <button
                  onClick={handleVideoPlayPause}
                  className="shrink-0 rounded p-1 text-fg-secondary transition hover:text-fg"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <input
                  type="range" min={0} max={videoDuration || 1} step={0.01} value={videoCurrentTime}
                  onChange={handleVideoSeek}
                  className="flex-1 accent-accent" aria-label="Video progress"
                />
                <span className="shrink-0 font-mono text-xs text-fg-secondary">
                  {formatVideoTime(videoCurrentTime)} / {formatVideoTime(videoDuration)}
                </span>
              </div>
            )}
          </div>
        </div>
      </ProcessFlowShell>

      {/* ── Fullscreen portal ── */}
      {videoFullscreen && createPortal(
        <div
          className="fixed inset-0 z-fullscreen flex flex-col bg-surface"
          role="dialog"
          aria-modal="true"
          aria-label="Set detection — fullscreen"
        >
          {/* Toolbar — relative z-10 lifts this stacking context above the video
              area below. backdrop-blur creates its own stacking context; without an
              explicit z-index the toolbar's context would paint behind the video div. */}
          <div className="relative z-10 flex items-center gap-2 flex-wrap px-4 py-3 border-b border-edge/40 bg-surface-alt/80 backdrop-blur">
            <CropToolbar {...cropToolbarProps} />
            {reselectClimberBtn}

            {/* Exit fullscreen */}
            <button
              type="button"
              onClick={() => setVideoFullscreen(false)}
              className="ui-control ml-auto p-1.5 text-fg-muted"
              aria-label="Exit fullscreen"
              title="Exit fullscreen"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L3 3m0 0h6m-6 0V9M15 9l6-6m0 0v6m0-6h-6M9 15l-6 6m0 0h6m-6 0v-6M15 15l6 6m0 0v-6m0 6h-6" />
              </svg>
            </button>
          </div>

          {/* Video area */}
          <div className="flex-1 relative overflow-hidden flex items-center justify-center px-4 py-4 min-h-0">
            <div
              className="relative overflow-hidden rounded-xl border border-edge/40"
              style={fsMediaContainerStyle(videoNaturalSize.w, videoNaturalSize.h)}
            >
              <video
                ref={fullscreenVideoRef}
                src={videoPreviewUrl}
                muted
                playsInline
                onPlay={() => setFsIsPlaying(true)}
                onPause={() => setFsIsPlaying(false)}
                onTimeUpdate={() => setFsVideoCurrentTime(fullscreenVideoRef.current?.currentTime ?? 0)}
                className="absolute inset-0 w-full h-full object-fill"
              />
              {cropOverlayNode}
              {hasCropFrame && climberMarker}
            </div>
          </div>

          {/* Fullscreen footer */}
          <div className="flex flex-col gap-3 px-4 py-3 border-t border-edge/40 bg-surface-alt/80 backdrop-blur">
            {/* Status / guidance */}
            {statusLine}
            {/* Crop warning (fallback) */}
            {cropWarningBanner}
            {/* Video controls */}
            {hasCropFrame && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleFsPlayPause}
                  className="shrink-0 rounded p-1 text-fg-secondary transition hover:text-fg"
                  aria-label={fsIsPlaying ? "Pause" : "Play"}
                >
                  {fsIsPlaying ? (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <input
                  type="range" min={0} max={videoDuration || 1} step={0.01} value={fsVideoCurrentTime}
                  onChange={handleFsSeek}
                  className="flex-1 accent-accent" aria-label="Video progress"
                />
                <span className="shrink-0 font-mono text-xs text-fg-secondary">
                  {formatVideoTime(fsVideoCurrentTime)} / {formatVideoTime(videoDuration)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-center">
              {scanButton("fullscreen")}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
