"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";
import CropBoxOverlay, { DEFAULT_CROP, type CropFraction } from "@/components/shared/CropBoxOverlay";
import type { MediaPipeVariant } from "@/hooks/usePoseModel";
import { mediaContainerStyle, fsMediaContainerStyle } from "@/utils/mediaContainerStyle";

// ---------------------------------------------------------------------------
// Frame-condition options
// ---------------------------------------------------------------------------
interface FrameCondition {
  id: string;
  label: string;
  description: string;
}

const FRAME_CONDITIONS: FrameCondition[] = [
  { id: "washed_out",  label: "Washed out",       description: "Bright sun or strong artificial light overexposes the frame." },
  { id: "backlit",     label: "Backlit",            description: "Light source is behind the climber, darkening the subject." },
  { id: "shadows",     label: "Deep shadows",       description: "Sections of the wall are heavily shadowed." },
  { id: "blends",      label: "Low contrast",       description: "Climber's clothing or skin blends with the wall colour." },
  { id: "indoor_gym",  label: "Gym lighting",       description: "Indoor gym with uneven or fluorescent overhead lighting." },
  { id: "dusty",       label: "Dusty / hazy lens",  description: "Lens fog, chalk dust, or condensation reduces sharpness." },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isCropDefault(crop: CropFraction): boolean {
  return (
    Math.abs(crop.x - DEFAULT_CROP.x) < 0.001 &&
    Math.abs(crop.y - DEFAULT_CROP.y) < 0.001 &&
    Math.abs(crop.w - DEFAULT_CROP.w) < 0.001 &&
    Math.abs(crop.h - DEFAULT_CROP.h) < 0.001
  );
}

function formatVideoTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Returns class string for a crop button based on its state. */
function cropBtnClass(isActive: boolean, isCropped: boolean): string {
  if (isActive)   return "border-accent/60 bg-accent/10 text-accent";
  if (isCropped)  return "border-send/30 bg-send-surface text-send";
  return "border-caution-border bg-caution-surface text-caution";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface StepSetDetectionProps {
  videoPreviewUrl: string;
  climberCrop: CropFraction;
  onClimberCropChange: (c: CropFraction) => void;
  orbCrop: CropFraction;
  onOrbCropChange: (c: CropFraction) => void;
  conditions: Set<string>;
  onConditionToggle: (id: string) => void;
  modelVariant: MediaPipeVariant;
  onModelVariantChange: (v: MediaPipeVariant) => void;
  frameStep: number;
  onFrameStepChange: (n: number) => void;
  /** True when model and cv are both ready to scan. */
  canScan: boolean;
  /** Called with the video start time when the user confirms. */
  onScan: (startTime: number) => void;
  /** Navigates back to StepPickVideo (exit button in fullscreen). */
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function StepSetDetection({
  videoPreviewUrl,
  climberCrop,
  onClimberCropChange,
  orbCrop,
  onOrbCropChange,
  conditions,
  onConditionToggle,
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

  const [activeCropMode,     setActiveCropMode]     = useState<"climber" | "route">("climber");
  const [hasCropFrame,       setHasCropFrame]       = useState(false);
  const [isPlaying,          setIsPlaying]          = useState(false);
  const [videoCurrentTime,   setVideoCurrentTime]   = useState(0);
  const [videoDuration,      setVideoDuration]      = useState(0);
  const [videoNaturalSize,   setVideoNaturalSize]   = useState<{ w: number; h: number }>({ w: 16, h: 9 });
  // Fullscreen is the default/primary view.
  const [videoFullscreen,    setVideoFullscreen]    = useState(true);
  const [fsVideoCurrentTime, setFsVideoCurrentTime] = useState(0);
  const [fsIsPlaying,        setFsIsPlaying]        = useState(false);

  // Merged settings dropdown
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [settingsTab,          setSettingsTab]          = useState<"detection" | "conditions">("detection");

  const bothCropsDone = !isCropDefault(climberCrop) && !isCropDefault(orbCrop);

  // ── Handlers ──────────────────────────────────────────────────────────
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

  function handleScanClick() {
    const t = (videoFullscreen ? fullscreenVideoRef.current?.currentTime : cropVideoRef.current?.currentTime) ?? 0;
    onScan(t > 0 ? t : 0);
  }

  // ESC key closes fullscreen → navigates back (per exit-button intent)
  useEffect(() => {
    if (!videoFullscreen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onBack(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoFullscreen, onBack]);

  // ── Shared crop toolbar (used in both inline and fullscreen) ──────────
  function CropToolbar({ fullscreen = false }: { fullscreen?: boolean }) {
    return (
      <>
        {/* Climber crop button */}
        <button
          onClick={() => setActiveCropMode("climber")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
            cropBtnClass(activeCropMode === "climber", !isCropDefault(climberCrop)),
          )}
          title={isCropDefault(climberCrop) ? "Crop around the climber" : "Climber crop set ✓"}
        >
          Climber
        </button>

        {/* Wall texture crop button */}
        <button
          onClick={() => setActiveCropMode("route")}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
            cropBtnClass(activeCropMode === "route", !isCropDefault(orbCrop)),
          )}
          title={isCropDefault(orbCrop) ? "Crop a wall texture region" : "Wall texture crop set ✓"}
        >
          Wall texture
        </button>

        {/* Merged settings dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSettingsDropdown(p => !p)}
            className={cn(
              "flex items-center gap-1 rounded-lg border p-1.5 transition",
              showSettingsDropdown
                ? "border-accent/60 bg-accent/10 text-accent"
                : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg",
            )}
            title="Detection & conditions settings"
            aria-label="Settings"
          >
            {/* Cog / settings icon */}
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {conditions.size > 0 && (
              <span className="rounded-full bg-caution/20 px-1 text-[9px] font-bold text-caution leading-none">
                {conditions.size}
              </span>
            )}
          </button>

          {showSettingsDropdown && (
            <div className={cn(
              "absolute z-30 mt-1.5 w-72 rounded-xl border border-edge/50 bg-card/95 p-3 shadow-2xl backdrop-blur-xl animate-fade-in",
              fullscreen ? "left-0 top-full" : "left-0 top-full",
            )}>
              {/* Tab bar */}
              <div className="flex gap-1 mb-3 pb-2 border-b border-edge/30">
                <button
                  onClick={() => setSettingsTab("detection")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium transition",
                    settingsTab === "detection" ? "bg-accent/10 text-accent" : "text-fg-secondary hover:text-fg",
                  )}
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                  </svg>
                  Detection
                </button>
                <button
                  onClick={() => setSettingsTab("conditions")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium transition",
                    settingsTab === "conditions" ? "bg-accent/10 text-accent" : "text-fg-secondary hover:text-fg",
                  )}
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                  </svg>
                  Conditions
                  {conditions.size > 0 && (
                    <span className="rounded-full bg-caution/20 px-1 text-[9px] font-bold text-caution leading-none">
                      {conditions.size}
                    </span>
                  )}
                </button>
              </div>

              {/* Detection tab */}
              {settingsTab === "detection" && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-medium text-fg-secondary">Pose model</label>
                    <select
                      value={modelVariant}
                      onChange={e => onModelVariantChange(e.target.value as MediaPipeVariant)}
                      className="rounded-lg border border-edge bg-inset px-2 py-1 text-xs text-fg outline-none transition focus:border-accent/60"
                    >
                      <option value="lite">Lite (fast)</option>
                      <option value="full">Full (balanced)</option>
                      <option value="heavy">Heavy (accurate)</option>
                    </select>
                  </div>
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
              )}

              {/* Conditions tab */}
              {settingsTab === "conditions" && (
                <div className="flex flex-col gap-2">
                  <p className="mb-1 text-xs font-semibold text-fg">Shooting conditions</p>
                  {FRAME_CONDITIONS.map(c => (
                    <label key={c.id} className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={conditions.has(c.id)}
                        onChange={() => onConditionToggle(c.id)}
                        className="mt-0.5 h-3.5 w-3.5 accent-accent cursor-pointer"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium text-fg group-hover:text-accent transition">{c.label}</span>
                        <span className="text-xs text-fg-muted">{c.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scan button — only once both crops are set */}
        {bothCropsDone && (
          <button
            onClick={handleScanClick}
            disabled={!canScan}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              canScan
                ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
                : "border-edge bg-card text-fg-muted opacity-60 cursor-not-allowed",
            )}
            title={canScan ? "Start pose detection" : "Loading model…"}
          >
            {canScan ? (
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            Scan video
          </button>
        )}
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-y-auto">
      {/* Inline fallback view — normally hidden behind the fullscreen portal */}
      <div className="mx-auto w-full max-w-2xl px-4 py-4 flex flex-col gap-4 sm:px-6 pb-8">

        {/* Inline toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <CropToolbar />
          {/* Expand to fullscreen */}
          <button
            onClick={() => setVideoFullscreen(true)}
            className="ml-auto rounded-lg border border-edge/50 bg-card/60 p-1.5 text-fg-muted hover:border-edge-hover hover:text-fg transition"
            aria-label="Expand video preview"
            title="Expand preview"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6L14 10M9 21H3m0 0v-6m0 6L10 14" />
            </svg>
          </button>
        </div>

        {/* Viewport-fit video container */}
        <div
          className="relative overflow-hidden rounded-2xl border border-edge/50 bg-surface shadow-lg shadow-black/10 mx-auto"
          style={mediaContainerStyle(videoNaturalSize.w, videoNaturalSize.h, "8rem")}
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
          {hasCropFrame && (
            <CropBoxOverlay
              box={activeCropMode === "climber" ? climberCrop : orbCrop}
              onChange={activeCropMode === "climber" ? onClimberCropChange : onOrbCropChange}
              borderRadius="1rem"
            />
          )}
          <canvas ref={cropCanvasRef} className="hidden" />
        </div>

        {/* Inline video controls */}
        {hasCropFrame && (
          <div className="flex items-center gap-3 rounded-xl border border-edge/40 bg-card/70 px-3 py-2">
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

      {/* ── Fullscreen portal (default/primary view) ── */}
      {videoFullscreen && createPortal(
        <div
          className="fixed inset-0 z-fullscreen flex flex-col bg-surface"
          role="dialog"
          aria-modal="true"
          aria-label="Set detection — fullscreen"
        >
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-edge/40 bg-surface-alt/80 backdrop-blur">
            <CropToolbar fullscreen />

            {/* Hint text */}
            <p className="hidden sm:block text-xs text-fg-muted ml-1">
              {activeCropMode === "climber"
                ? "Drag handles to fit around the climber"
                : "Drag to select a region of wall texture"}
            </p>

            {/* Exit — back to StepPickVideo */}
            <button
              onClick={onBack}
              className="ml-auto rounded-lg border border-edge/50 bg-card/60 p-1.5 text-fg-muted hover:border-edge-hover hover:text-fg transition"
              aria-label="Exit (back to video selection)"
              title="Exit (back to video selection)"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
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
              {hasCropFrame && (
                <CropBoxOverlay
                  box={activeCropMode === "climber" ? climberCrop : orbCrop}
                  onChange={activeCropMode === "climber" ? onClimberCropChange : onOrbCropChange}
                  borderRadius="0.75rem"
                />
              )}
            </div>
          </div>

          {/* Fullscreen video controls */}
          {hasCropFrame && (
            <div className="flex items-center gap-3 px-4 py-3 border-t border-edge/40 bg-surface-alt/80 backdrop-blur">
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
        </div>,
        document.body,
      )}
    </div>
  );
}
