"use client";

/**
 * Dev-only Seed tap editor — the Calibrate act's single-tap affordance.
 *
 * Shows the Test Video with a scrub/play transport and a bare tap surface: one
 * click records the off-hash Seed tap `{ x, y, t }` (video-normalized position +
 * the tapped frame's time) that seeds the downloader's ViTPose job. Unlike Setup
 * there are no crop boxes — the author scrubs to whatever later, unambiguous
 * frame the climber is clearest in and taps them there; the acquisition region is
 * derived from the tap downstream (issue 02), so the Climber Crop no longer gates
 * the seed. Tapping again just moves the point. The media uses `object-fill` in a
 * measured, aspect-bounded stage so the tap fraction maps 1:1 to the frame.
 */

import { useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { fitMediaStyle, fitMediaWidth } from "@/utils/mediaContainerStyle";

type SeedTap = { x: number; y: number; t?: number };

function formatVideoTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export interface SeedTapEditorProps {
  videoSrc: string;
  seedTap: SeedTap | null;
  onSeedTapChange: (p: SeedTap) => void;
  /** Disables tapping while a seed job is being kicked off. */
  disabled?: boolean;
}

export default function SeedTapEditor({
  videoSrc,
  seedTap,
  onSeedTapChange,
  disabled = false,
}: SeedTapEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stageRef, stageHeight] = useMeasuredHeight();

  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Default to portrait (9:16) — ascents are recorded vertically.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 9, h: 16 });

  function handleTap(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    const video = videoRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const t = video?.currentTime;
    onSeedTapChange(
      typeof t === "number" && Number.isFinite(t) && t >= 0 ? { x, y, t } : { x, y },
    );
  }

  function handleLoaded() {
    const video = videoRef.current;
    if (!video) return;
    setReady(true);
    setDuration(video.duration || 0);
    setSize({ w: video.videoWidth || 16, h: video.videoHeight || 9 });
  }

  function handlePlayPause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Number(e.target.value);
  }

  const marker = seedTap ? (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left: `${seedTap.x * 100}%`,
        top: `${seedTap.y * 100}%`,
        transform: "translate(-50%, -50%)",
      }}
      aria-hidden="true"
    >
      <div className="h-4 w-4 rounded-full border-2 border-send bg-send/40" />
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        <div
          className={cn("relative overflow-hidden", disabled ? "cursor-default" : "cursor-crosshair")}
          style={fitMediaStyle(size.w, size.h, stageHeight)}
          onClick={handleTap}
        >
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            playsInline
            onLoadedData={handleLoaded}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
            onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
            className="absolute inset-0 h-full w-full object-fill"
          />
          {ready && marker}
          {ready && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
              <span
                role="status"
                className={cn(
                  "flex max-w-full items-center rounded-full border border-edge/60 bg-surface/90 px-3 py-1.5 text-center text-xs font-medium text-fg-secondary shadow-lg backdrop-blur-sm",
                  seedTap == null && "animate-pulse",
                )}
              >
                {seedTap == null
                  ? "Scrub to a clear frame, then tap the climber."
                  : "Tap again to move the seed, or re-seed."}
              </span>
            </div>
          )}
        </div>
      </div>

      {ready && (
        <div
          className="mx-auto w-full shrink-0"
          style={{ maxWidth: fitMediaWidth(size.w, size.h, stageHeight) }}
        >
          <div className="flex w-full items-center gap-2.5 px-1 py-1">
            <button
              type="button"
              onClick={handlePlayPause}
              className="ui-icon-btn shrink-0 p-0.5"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.01}
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 accent-accent"
              aria-label="Video progress"
            />
            <span className="shrink-0 font-mono text-[11px] text-fg-muted">
              {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
