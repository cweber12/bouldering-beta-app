"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CropBoxOverlay, { DEFAULT_CROP, type CropFraction } from "@/components/shared/CropBoxOverlay";
import type { MediaPipeVariant } from "@/hooks/usePoseModel";

// ---------------------------------------------------------------------------
// Frame-condition options (same set as the legacy page)
// ---------------------------------------------------------------------------
interface FrameCondition {
  id: string;
  label: string;
  description: string;
}

const FRAME_CONDITIONS: FrameCondition[] = [
  { id: "washed_out",  label: "Washed out",      description: "Bright sun or strong artificial light overexposes the frame." },
  { id: "backlit",     label: "Backlit",           description: "Light source is behind the climber, darkening the subject." },
  { id: "shadows",     label: "Deep shadows",      description: "Sections of the wall are heavily shadowed." },
  { id: "blends",      label: "Low contrast",      description: "Climber's clothing or skin blends with the wall colour." },
  { id: "indoor_gym",  label: "Gym lighting",      description: "Indoor gym with uneven or fluorescent overhead lighting." },
  { id: "dusty",       label: "Dusty / hazy lens", description: "Lens fog, chalk dust, or condensation reduces sharpness." },
];

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
  /** When true, shows a "Back to results" banner above the toolbar. */
  editMode: boolean;
  onBackToResults: () => void;
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
  editMode,
  onBackToResults,
}: StepSetDetectionProps) {
  // ── Local video state ──────────────────────────────────────────────────
  const cropVideoRef        = useRef<HTMLVideoElement>(null);
  const cropCanvasRef       = useRef<HTMLCanvasElement>(null);
  const fullscreenVideoRef  = useRef<HTMLVideoElement>(null);

  const [activeCropMode,       setActiveCropMode]       = useState<"climber" | "route">("climber");
  const [hasCropFrame,         setHasCropFrame]         = useState(false);
  const [isPlaying,            setIsPlaying]            = useState(false);
  const [videoCurrentTime,     setVideoCurrentTime]     = useState(0);
  const [videoDuration,        setVideoDuration]        = useState(0);
  const [videoNaturalSize,     setVideoNaturalSize]     = useState<{ w: number; h: number }>({ w: 16, h: 9 });
  const [videoFullscreen,      setVideoFullscreen]      = useState(false);
  const [fsVideoCurrentTime,   setFsVideoCurrentTime]   = useState(0);
  const [fsIsPlaying,          setFsIsPlaying]          = useState(false);
  const [showConditionsDropdown, setShowConditionsDropdown] = useState(false);
  const [showDetectionDropdown,  setShowDetectionDropdown]  = useState(false);
  const [showCropWarning,      setShowCropWarning]      = useState(false);

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

  function openVideoFullscreen() {
    setFsVideoCurrentTime(cropVideoRef.current?.currentTime ?? 0);
    setFsIsPlaying(false);
    setVideoFullscreen(true);
  }

  function closeVideoFullscreen() {
    if (fullscreenVideoRef.current) fullscreenVideoRef.current.pause();
    if (fullscreenVideoRef.current && cropVideoRef.current) {
      cropVideoRef.current.currentTime = fullscreenVideoRef.current.currentTime;
      setVideoCurrentTime(fullscreenVideoRef.current.currentTime);
    }
    setFsIsPlaying(false);
    setVideoFullscreen(false);
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
    if (isCropDefault(climberCrop) || isCropDefault(orbCrop)) {
      setShowCropWarning(true);
      return;
    }
    onScan(videoCurrentTime > 0 ? videoCurrentTime : 0);
  }

  function handleProceedAnyway() {
    setShowCropWarning(false);
    onScan(videoCurrentTime > 0 ? videoCurrentTime : 0);
  }

  // ESC key closes fullscreen
  useEffect(() => {
    if (!videoFullscreen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeVideoFullscreen(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoFullscreen]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 flex flex-col gap-4 sm:px-6 pb-8">

        {/* Edit-mode return banner */}
        {editMode && (
          <button
            onClick={onBackToResults}
            className="self-start flex items-center gap-1.5 rounded-xl border border-edge bg-card px-4 py-2 text-xs font-medium text-fg-secondary transition hover:border-accent/60 hover:text-fg"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back to results
          </button>
        )}

        {/* ── Crop toolbar ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveCropMode("climber")}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              activeCropMode === "climber"
                ? "border-accent/60 bg-accent/10 text-accent"
                : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
              isCropDefault(climberCrop) ? "animate-pulse" : "",
            ].join(" ")}
          >
            Climber crop
          </button>
          <button
            onClick={() => setActiveCropMode("route")}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              activeCropMode === "route"
                ? "border-success/60 bg-success/10 text-success"
                : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
              isCropDefault(orbCrop) ? "animate-pulse" : "",
            ].join(" ")}
          >
            Wall texture crop
          </button>

          {/* Conditions dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowConditionsDropdown(p => !p); setShowDetectionDropdown(false); }}
              className={[
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                showConditionsDropdown
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
              ].join(" ")}
            >
              Conditions
              {conditions.size > 0 && (
                <span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-bold text-accent">
                  {conditions.size}
                </span>
              )}
              <svg
                className={["h-3 w-3 transition-transform", showConditionsDropdown ? "rotate-180" : ""].join(" ")}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showConditionsDropdown && (
              <div className="absolute left-0 top-full z-20 mt-1.5 w-72 rounded-xl border border-edge/50 bg-card/95 p-3 shadow-2xl backdrop-blur-xl animate-fade-in">
                <p className="mb-2 text-xs font-semibold text-fg">Shooting conditions</p>
                <div className="flex flex-col gap-2">
                  {FRAME_CONDITIONS.map(c => (
                    <label key={c.id} className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={conditions.has(c.id)}
                        onChange={() => onConditionToggle(c.id)}
                        className="mt-0.5 h-3.5 w-3.5 accent-accent cursor-pointer"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium text-fg group-hover:text-success transition">{c.label}</span>
                        <span className="text-xs text-fg-muted">{c.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Detection settings dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowDetectionDropdown(p => !p); setShowConditionsDropdown(false); }}
              className={[
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                showDetectionDropdown
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
              ].join(" ")}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
              </svg>
              Detection
              <svg
                className={["h-3 w-3 transition-transform", showDetectionDropdown ? "rotate-180" : ""].join(" ")}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showDetectionDropdown && (
              <div className="absolute left-0 top-full z-20 mt-1.5 w-72 rounded-xl border border-edge/50 bg-card/95 p-3 shadow-2xl backdrop-blur-xl animate-fade-in">
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
                    1 = every frame (slowest, most accurate) &mdash; 30 = every 30th frame (fastest, more interpolation)
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Expand to fullscreen */}
          <button
            onClick={openVideoFullscreen}
            className="ml-auto rounded-lg border border-edge/50 bg-card/60 p-1.5 text-fg-muted hover:border-edge-hover hover:text-fg transition"
            aria-label="Expand video preview to fullscreen"
            title="Expand preview"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6L14 10M9 21H3m0 0v-6m0 6L10 14" />
            </svg>
          </button>
        </div>

        {/* Crop mode hint */}
        <p className="text-xs text-fg-muted">
          {activeCropMode === "climber"
            ? "Climber crop \u2014 drag handles to resize, drag interior to move. Follows the climber through each frame."
            : "Wall texture crop \u2014 drag to focus on wall texture used to match this video\u2019s wall to your route photo."}
        </p>

        {/* Viewport-fit video container */}
        <div
          className="relative overflow-hidden rounded-2xl border border-edge/50 bg-surface shadow-lg shadow-black/10 mx-auto"
          style={mediaContainerStyle(videoNaturalSize.w, videoNaturalSize.h)}
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
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: "fill" }}
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

        {/* Video controls */}
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

        {/* Scan button */}
        <button
          onClick={handleScanClick}
          disabled={!canScan}
          className="flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-surface shadow-lg shadow-accent/20 transition-all duration-200 hover:bg-accent-hover hover:shadow-accent/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none active:scale-[0.98]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
          </svg>
          Scan video
          {videoCurrentTime > 0 && (
            <span className="text-xs font-normal opacity-75">from {formatVideoTime(videoCurrentTime)}</span>
          )}
        </button>

        {/* Crop-default warning */}
        {showCropWarning && (
          <div className="rounded-lg border border-caution-border bg-caution-surface px-5 py-4 flex flex-col gap-3">
            <p className="text-sm font-medium text-caution">Crop regions not adjusted</p>
            <p className="text-xs text-caution/80">
              {isCropDefault(climberCrop) && isCropDefault(orbCrop)
                ? "Neither the climber crop nor the background (ORB) crop has been adjusted from the default."
                : isCropDefault(climberCrop)
                ? "The climber crop has not been adjusted from the default."
                : "The background (ORB) crop has not been adjusted from the default."}
              {" "}Adjusting these crops improves pose detection accuracy and feature matching quality.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCropWarning(false)}
                className="rounded-xl border border-edge px-4 py-2 text-xs font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
              >
                Go back
              </button>
              <button
                onClick={handleProceedAnyway}
                className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-medium text-accent transition hover:bg-accent/20"
              >
                Proceed anyway
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Video fullscreen portal ── */}
      {videoFullscreen && createPortal(
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-surface"
          role="dialog"
          aria-modal="true"
          aria-label="Video crop \u2014 fullscreen"
        >
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-edge/40 bg-surface-alt/80 backdrop-blur">
            <button
              onClick={() => setActiveCropMode("climber")}
              className={[
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                activeCropMode === "climber"
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
              ].join(" ")}
            >
              Climber crop
            </button>
            <button
              onClick={() => setActiveCropMode("route")}
              className={[
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                activeCropMode === "route"
                  ? "border-success/60 bg-success/10 text-success"
                  : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
              ].join(" ")}
            >
              Wall texture crop
            </button>
            <p className="text-xs text-fg-muted hidden sm:block">
              {activeCropMode === "climber"
                ? "Climber crop \u2014 drag handles or interior"
                : "Wall texture crop \u2014 drag to select wall region"}
            </p>
            <button
              onClick={closeVideoFullscreen}
              className="ml-auto rounded-lg border border-edge/50 bg-card/60 p-1.5 text-fg-muted hover:border-edge-hover hover:text-fg transition"
              aria-label="Close fullscreen (Escape)"
              title="Close fullscreen (Esc)"
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
                className="absolute inset-0 w-full h-full"
                style={{ objectFit: "fill" }}
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

          {/* Controls */}
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
