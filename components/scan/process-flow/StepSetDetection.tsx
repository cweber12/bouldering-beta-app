"use client";

import { useRef, useState } from "react";
import { cn } from "@/utils/cn";
import ProcessFlowShell from "@/components/scan/process-flow/ProcessFlowShell";
import CropBoxOverlay, { type CropFraction } from "@/components/capture/CropBoxOverlay";
import DeveloperViewToggle from "@/components/scan/controls/DeveloperViewToggle";
import type { MediaPipeVariant } from "@/hooks/usePoseModel";
import {
  QUALITY_TIERS,
  TIER_LABELS,
  TIER_DESCRIPTIONS,
  type QualityTier,
} from "@/utils/poseTiers";
import { fitMediaStyle, fitMediaWidth, fsMediaContainerStyle } from "@/utils/mediaContainerStyle";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { useClickOutside } from "@/hooks/useClickOutside";
import FullscreenModal from "@/components/ui/FullscreenModal";

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
// DetectionSettings — plateless gear icon + popover (quality tier · pose model
// · sampling frequency). Module-level so it never remounts on parent re-render.
// ---------------------------------------------------------------------------
interface DetectionSettingsProps {
  showSettings: boolean;
  tier: QualityTier;
  modelVariant: MediaPipeVariant;
  frameStep: number;
  /** Panning Capture (long route) mode — align per keyframe instead of frame 0. */
  panning: boolean;
  onToggle: () => void;
  onClose: () => void;
  onTierChange: (t: QualityTier) => void;
  onModelVariantChange: (v: MediaPipeVariant) => void;
  onFrameStepChange: (n: number) => void;
  onPanningChange: (b: boolean) => void;
}

function DetectionSettings({
  showSettings,
  tier,
  modelVariant,
  frameStep,
  panning,
  onToggle,
  onClose,
  onTierChange,
  onModelVariantChange,
  onFrameStepChange,
  onPanningChange,
}: DetectionSettingsProps) {
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, onClose, showSettings);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="ui-icon-btn flex h-8 w-8 items-center justify-center"
        title="Detection settings"
        aria-label="Detection settings"
        aria-expanded={showSettings}
      >
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {showSettings && (
        <div className="ui-popover animate-fade-in absolute right-0 top-full z-30 mt-1.5 w-72 p-3 text-left">
          <div className="flex flex-col gap-3">
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

            <div className="border-t border-edge/60 pt-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex flex-col">
                  <span className="text-xs font-medium text-fg-secondary">Long route (panning)</span>
                  <span className="text-xs text-fg-muted">Camera pans up the wall</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={panning}
                  onClick={() => onPanningChange(!panning)}
                  className={cn(
                    "ui-chip-toggle rounded-md px-2.5 py-1 text-xs font-medium",
                    panning ? "border-accent/50 bg-accent/15 text-fg" : "",
                  )}
                >
                  {panning ? "On" : "Off"}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-fg-muted">
                Aligns each pan section to the route photo by keyframe. Leave off for a fixed
                (tripod) shot.
              </p>
            </div>

            <div className="border-t border-edge/60 pt-3">
              <DeveloperViewToggle />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TransportBar — plateless play/scrub strip sitting directly below the video.
// ---------------------------------------------------------------------------
function TransportBar({
  playing,
  currentTime,
  duration,
  onPlayPause,
  onSeek,
}: {
  playing: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex w-full items-center gap-2.5 px-1 py-1">
      <button
        type="button"
        onClick={onPlayPause}
        className="ui-icon-btn shrink-0 p-0.5"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
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
        type="range" min={0} max={duration || 1} step={0.01} value={currentTime}
        onChange={onSeek}
        className="flex-1 accent-accent" aria-label="Video progress"
      />
      <span className="shrink-0 font-mono text-[11px] text-fg-muted">
        {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
      </span>
    </div>
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
  /** Panning Capture (long route) mode toggle state. */
  panning: boolean;
  onPanningChange: (b: boolean) => void;
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
  panning,
  onPanningChange,
  canScan,
  onScan,
  onBack,
}: StepSetDetectionProps) {
  // ── Video refs / state ─────────────────────────────────────────────────
  const cropVideoRef       = useRef<HTMLVideoElement>(null);
  const cropCanvasRef      = useRef<HTMLCanvasElement>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);

  // Measures the video stage so the media is square-bounded to the exact
  // available vertical space (drives both height and the landscape width cap).
  const [stageRef, stageHeight] = useMeasuredHeight();

  const [hasCropFrame,       setHasCropFrame]       = useState(false);
  const [isPlaying,          setIsPlaying]          = useState(false);
  const [videoCurrentTime,   setVideoCurrentTime]   = useState(0);
  const [videoDuration,      setVideoDuration]      = useState(0);
  // Default to portrait (9:16) — ascents are recorded vertically, so this
  // minimises the layout snap when the real metadata loads.
  const [videoNaturalSize,   setVideoNaturalSize]   = useState<{ w: number; h: number }>({ w: 9, h: 16 });
  const [videoFullscreen,    setVideoFullscreen]    = useState(false);
  const [fsVideoCurrentTime, setFsVideoCurrentTime] = useState(0);
  const [fsIsPlaying,        setFsIsPlaying]        = useState(false);

  // Guided crop stage: "climber" first, "wall" after switching the toggle.
  const [cropMode, setCropMode] = useState<CropMode>("climber");
  // Detection settings popover.
  const [showSettings, setShowSettings] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────
  function handleClimberCropChange(c: CropFraction) {
    onClimberCropChange(c);
  }

  function handleWallCropChange(c: CropFraction) {
    onWallCropChange?.(c);
  }

  // Tap the climber to lock detection. Seeds a default portrait box around the
  // tap; processing refines it adaptively from the climber's landmarks.
  function handleClimberTap(p: { x: number; y: number }) {
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

  function handleSelectClimber() { setCropMode("climber"); }
  function handleSelectWall()    { setCropMode("wall"); }
  function handleReTap()         { onClimberPointChange?.(null); }

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

  // Scan is always available; no warning if the climber was never tapped — the
  // strongest detected pose is used. The footer instruction is the guidance.
  function doScan() {
    const t = (videoFullscreen ? fullscreenVideoRef.current?.currentTime : cropVideoRef.current?.currentTime) ?? 0;
    onScan(t > 0 ? t : 0);
  }

  // ── Shared settings props ──────────────────────────────────────────────
  const settingsProps: DetectionSettingsProps = {
    showSettings,
    tier,
    modelVariant,
    frameStep,
    panning,
    onToggle: () => setShowSettings(p => !p),
    onClose: () => setShowSettings(false),
    onTierChange,
    onModelVariantChange,
    onFrameStepChange,
    onPanningChange,
  };

  // Marker showing which climber the user tapped.
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

  // Crop overlay. In climber mode, before a tap the overlay is a bare tap surface
  // so the box never blocks tapping the climber; after a tap the derived box is
  // shown for fine-tuning. Wall mode shows the wall crop box.
  const cropOverlayNode = !hasCropFrame ? null : cropMode === "wall" ? (
    <CropBoxOverlay
      box={wallCrop ?? climberCrop}
      onChange={handleWallCropChange}
      borderRadius="0"
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
      borderRadius="0"
      color={CLIMBER_COLOR}
    />
  );

  // ── Toolbar — Climber|Wall toggle (left) + plateless utility icons (right).
  //    `variant` switches the trailing button between Expand and Exit. ──
  function toolbarNode(variant: "inline" | "fullscreen") {
    return (
      <>
        <div className="ui-segmented text-xs" role="group" aria-label="Crop target">
          <button
            type="button"
            onClick={handleSelectClimber}
            className="ui-segmented-button px-3 py-1 font-medium"
            aria-pressed={cropMode === "climber"}
          >
            Climber
          </button>
          <button
            type="button"
            onClick={handleSelectWall}
            disabled={climberPoint == null}
            className="ui-segmented-button px-3 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-40"
            aria-pressed={cropMode === "wall"}
            title={climberPoint == null ? "Tap the climber first" : "Frame the wall texture"}
          >
            Wall
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <DetectionSettings {...settingsProps} />
          {cropMode === "climber" && climberPoint != null && (
            <button
              type="button"
              onClick={handleReTap}
              className="ui-icon-btn flex h-8 w-8 items-center justify-center"
              aria-label="Re-tap a different climber"
              title="Re-tap a different climber"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => setVideoFullscreen(variant === "inline")}
            className="ui-icon-btn flex h-8 w-8 items-center justify-center"
            aria-label={variant === "inline" ? "Expand video preview" : "Exit fullscreen"}
            title={variant === "inline" ? "Expand preview" : "Exit fullscreen"}
          >
            {variant === "inline" ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6L14 10M9 21H3m0 0v-6m0 6L10 14" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L3 3m0 0h6m-6 0V9M15 9l6-6m0 0v6m0-6h-6M9 15l-6 6m0 0h6m-6 0v-6M15 15l6 6m0 0v-6m0 6h-6" />
              </svg>
            )}
          </button>
        </div>
      </>
    );
  }

  // ── Scan CTA — lives in the sticky shell footer (inline) and the fullscreen
  //    footer, so it is always visible regardless of media aspect ratio.
  //    Clickable whenever the model is ready; only accented once a climber is
  //    tapped so the crop step reads as the prerequisite. ──
  function scanButton(size: "footer" | "fullscreen") {
    const accented = canScan && climberPoint != null;
    return (
      <button
        type="button"
        onClick={doScan}
        disabled={!canScan}
        className={cn(
          "motion-cta flex items-center justify-center gap-2 rounded-md text-sm font-semibold",
          size === "fullscreen" ? "px-10 py-3" : "px-6 py-2.5",
          !canScan
            ? "ui-control border-edge bg-surface-alt/45 text-fg-muted opacity-60 cursor-not-allowed"
            : accented
              ? "ui-control-primary"
              : "ui-control",
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

  const detectionInstruction =
    cropMode === "wall"
      ? "frame the wall texture"
      : climberPoint == null
        ? "tap the climber to lock tracking"
        : "fine-tune the box, or scan";

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      <ProcessFlowShell
        step={2}
        totalSteps={3}
        stepName="Set detection"
        instruction={detectionInstruction}
        onBack={onBack}
        toolbar={hasCropFrame ? toolbarNode("inline") : undefined}
        primaryAction={scanButton("footer")}
      >
        <div className="flex h-full min-h-0 flex-col bg-surface">
          {/* Measured video stage — the media is square-bounded to this height,
              flush (no border/radius/padding) and centered on a flat surface. */}
          <div
            ref={stageRef}
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          >
            <div
              className="relative overflow-hidden"
              style={fitMediaStyle(videoNaturalSize.w, videoNaturalSize.h, stageHeight)}
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
          </div>

          {/* Transport bar — aligned to the media width, flush beneath the video. */}
          {hasCropFrame && (
            <div
              className="mx-auto w-full shrink-0"
              style={{ maxWidth: fitMediaWidth(videoNaturalSize.w, videoNaturalSize.h, stageHeight) }}
            >
              <TransportBar
                playing={isPlaying}
                currentTime={videoCurrentTime}
                duration={videoDuration}
                onPlayPause={handleVideoPlayPause}
                onSeek={handleVideoSeek}
              />
            </div>
          )}
        </div>
      </ProcessFlowShell>

      {/* ── Fullscreen portal ── */}
      <FullscreenModal
        open={videoFullscreen}
        onClose={() => setVideoFullscreen(false)}
        ariaLabel="Set detection — fullscreen"
        header={
          <header className="shrink-0 border-b border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
            <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
              {toolbarNode("fullscreen")}
            </div>
          </header>
        }
        footer={
          <footer className="flex shrink-0 items-center justify-center border-t border-edge/40 bg-surface px-4 py-3">
            {scanButton("fullscreen")}
          </footer>
        }
      >
        <div className="flex max-h-full flex-col gap-1.5">
          <div
            className="relative overflow-hidden rounded-(--radius-panel) border border-edge/40"
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

          {hasCropFrame && (
            <TransportBar
              playing={fsIsPlaying}
              currentTime={fsVideoCurrentTime}
              duration={videoDuration}
              onPlayPause={handleFsPlayPause}
              onSeek={handleFsSeek}
            />
          )}
        </div>
      </FullscreenModal>
    </>
  );
}
