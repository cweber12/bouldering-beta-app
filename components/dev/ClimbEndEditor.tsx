"use client";

/**
 * Dev-only end-of-climb marker editor — the capture gesture for `climbEnd`
 * (harness ADR 0007 §4; `harness-contract-adr0007-adoption` issue 02).
 *
 * There is no gesture to infer the end of a climb from, so the human already
 * doing calibration captures it: scrub the Test Video to the topout — or to the
 * point the attempt is over — and set the marker there. The paused frame is the
 * primary confirmation; a ±2 s strip of Detection Frame thumbnails underneath
 * gives frame-accurate context without thumbnailing the whole video, which at
 * ninety Bundles is the difference between a sitting and an afternoon.
 *
 * The marker snaps to the nearest Detection Frame, because scoring is per
 * Detection Frame. A candidate at or before the climb start (the **setup** tap's
 * `t`, never the seed tap's) is refused here with a reason rather than clamped;
 * the setup route re-checks and 422s regardless, so this is a courtesy, not the
 * guard.
 *
 * Presentational: it owns scrub position and nothing else. Persisting the marker
 * — and the "unset means the window is open" semantics of committing `null` — is
 * the caller's, so the same editor drives both the per-Bundle Calibrator modal
 * and the corpus-wide Mark-ends sweep.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/utils/cn";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { useDetectionThumbnails } from "@/hooks/useDetectionThumbnails";
import { fitMediaStyle, fitMediaWidth } from "@/utils/mediaContainerStyle";
import {
  CLIMB_END_STRIP_RADIUS_SEC,
  checkClimbEnd,
  detectionFrameWindow,
  formatClipTime,
  snapToDetectionFrame,
} from "@/utils/harnessClimbWindow";

/**
 * How long the scrub must settle before the strip re-centres. Re-windowing
 * restarts the thumbnail seeks, so following a drag frame-by-frame would thrash;
 * the video itself is already showing the live frame.
 */
const STRIP_SETTLE_MS = 200;

/** Displayed strip cell height (px) — deliberately shorter than the review
 *  stepper's, so the video keeps the stage. */
const CELL_HEIGHT = 56;

export interface ClimbEndEditorProps {
  videoSrc: string;
  /** The climb start — the setup tap's `t` — when the Scan Setup carries one. */
  climbStart?: number;
  /** The saved marker, or undefined when this Bundle is unmarked. */
  climbEnd?: number;
  /** Persist the marker. `null` clears it, reopening the window on that side. */
  onCommit: (climbEnd: number | null) => void;
  /** A write is in flight — controls lock rather than queueing a second write. */
  busy?: boolean;
  /** A failed write (e.g. the route's 422), surfaced verbatim. */
  error?: string | null;
  /** Extra controls beside Set/Clear — the sweep's Skip and queue navigation. */
  actions?: ReactNode;
}

export default function ClimbEndEditor({
  videoSrc,
  climbStart,
  climbEnd,
  onCommit,
  busy = false,
  error = null,
  actions,
}: ClimbEndEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stageRef, stageHeight] = useMeasuredHeight();

  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Default to portrait (9:16) — ascents are recorded vertically.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 9, h: 16 });

  // The strip's centre trails the scrub so a drag does not restart the seeks.
  const [stripCenter, setStripCenter] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setStripCenter(currentTime), STRIP_SETTLE_MS);
    return () => clearTimeout(id);
  }, [currentTime]);

  // Opening position: the saved marker when there is one, else the last frame.
  // A topout is near the end of the clip, so starting there turns the search into
  // a short drag backwards instead of a scrub across the whole video. Applied
  // once per mount — callers key this component on `videoSrc`, so a new Bundle
  // is a fresh mount rather than an effect resetting six pieces of state.
  const openedRef = useRef(false);

  function handleLoaded() {
    const video = videoRef.current;
    if (!video) return;
    const videoDuration = video.duration || 0;
    setReady(true);
    setDuration(videoDuration);
    setSize({ w: video.videoWidth || 16, h: video.videoHeight || 9 });
    if (!openedRef.current) {
      openedRef.current = true;
      const opening = climbEnd ?? snapToDetectionFrame(videoDuration, videoDuration);
      video.currentTime = opening;
      setCurrentTime(opening);
      setStripCenter(opening);
    }
  }

  function handlePlayPause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = seconds;
    setCurrentTime(seconds);
  }

  /** Step by whole Detection Frames — the resolution the marker is stored at. */
  function stepFrame(delta: number) {
    seekTo(snapToDetectionFrame(currentTime + delta * 0.1, duration));
  }

  const strip = useMemo(
    () => detectionFrameWindow(stripCenter, duration, CLIMB_END_STRIP_RADIUS_SEC),
    [stripCenter, duration],
  );
  const thumbnails = useDetectionThumbnails(videoSrc, strip.frames, ready);

  // The frame the marker would land on, and whether it may.
  const pending = snapToDetectionFrame(currentTime, duration);
  const lastFrame = snapToDetectionFrame(duration, duration);
  const check = checkClimbEnd(pending, climbStart);
  const canSet = ready && !busy && check.ok;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        <div
          className="relative overflow-hidden"
          style={fitMediaStyle(size.w, size.h, stageHeight)}
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
          {ready && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
              <span
                role="status"
                className={cn(
                  "flex max-w-full items-center rounded-full border border-edge/60 bg-surface/90 px-3 py-1.5 text-center text-xs font-medium text-fg-secondary shadow-lg backdrop-blur-sm",
                  climbEnd === undefined && "animate-pulse",
                )}
              >
                {climbEnd === undefined
                  ? "Unmarked — scrub back to the topout, then set the climb end."
                  : `Climb end marked at ${formatClipTime(climbEnd)}. Scrub to move it, or clear it.`}
              </span>
            </div>
          )}
        </div>
      </div>

      <div
        className="mx-auto flex w-full shrink-0 flex-col gap-2"
        style={{ maxWidth: fitMediaWidth(size.w, size.h, stageHeight) }}
      >
        {/* ±2 s confirmation strip — the frame either side of the candidate. */}
        {ready && strip.frames.length > 0 && (
          <div className="overflow-x-auto px-1">
            <div className="flex w-max min-w-full items-start justify-center gap-0.5">
              {strip.frames.map((frame, i) => {
                const isPending = Math.abs(frame.timestamp - pending) < 0.001;
                const isMarked =
                  climbEnd !== undefined && Math.abs(frame.timestamp - climbEnd) < 0.001;
                return (
                  <button
                    key={frame.timestamp}
                    type="button"
                    onClick={() => seekTo(frame.timestamp)}
                    title={`${formatClipTime(frame.timestamp)}${isMarked ? " · climb end" : ""}`}
                    aria-label={`Seek to ${formatClipTime(frame.timestamp)}`}
                    data-testid="climb-end-strip-cell"
                    data-pending={isPending || undefined}
                    data-marked={isMarked || undefined}
                    style={{ height: CELL_HEIGHT }}
                    className={cn(
                      "block w-fit shrink-0 overflow-hidden rounded-sm border-2 bg-surface-alt p-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                      isMarked ? "border-send" : "border-edge",
                      isPending && "ring-2 ring-fg ring-offset-1 ring-offset-surface",
                    )}
                  >
                    {thumbnails[i] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbnails[i]}
                        alt=""
                        aria-hidden="true"
                        className="block h-full w-auto"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="block aspect-9/16 h-full w-auto bg-surface-alt"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex w-full items-center gap-2.5 px-1">
          <button
            type="button"
            onClick={handlePlayPause}
            disabled={!ready}
            className="ui-icon-btn shrink-0 p-0.5 disabled:opacity-50"
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
          <button
            type="button"
            onClick={() => stepFrame(-1)}
            disabled={!ready || pending <= 0}
            className="shrink-0 rounded-md bg-surface-alt px-2 py-1 text-xs text-fg disabled:opacity-50"
          >
            ◀ frame
          </button>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={currentTime}
            onChange={(e) => seekTo(Number(e.target.value))}
            className="flex-1 accent-accent"
            aria-label="Video progress"
          />
          <button
            type="button"
            onClick={() => stepFrame(1)}
            disabled={!ready || pending >= lastFrame}
            className="shrink-0 rounded-md bg-surface-alt px-2 py-1 text-xs text-fg disabled:opacity-50"
          >
            frame ▶
          </button>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
            {formatClipTime(pending)} / {formatClipTime(duration)}
          </span>
        </div>

        {error && (
          <p
            role="status"
            className="mx-1 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger"
          >
            {error}
          </p>
        )}
        {ready && !check.ok && (
          <p
            role="status"
            className="mx-1 rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution"
          >
            {check.reason}
          </p>
        )}

        <div className="flex w-full flex-wrap items-center gap-2 px-1 pb-1">
          <button
            type="button"
            onClick={() => check.ok && onCommit(check.value)}
            disabled={!canSet}
            title={
              check.ok
                ? "Save this Detection Frame as the end of the climb — off-hash, so no run goes stale"
                : check.reason
            }
            className="rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse disabled:opacity-50"
          >
            {busy ? "Saving…" : `Set climb end — ${formatClipTime(pending)}`}
          </button>
          <button
            type="button"
            onClick={() => onCommit(null)}
            disabled={busy || climbEnd === undefined}
            title="Remove the marker — the window reopens on that side and the harness scores as it does today"
            className="rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:opacity-50"
          >
            Clear marker
          </button>
          <span className="text-xs text-fg-muted">
            Climb start{" "}
            {climbStart === undefined ? (
              <span className="text-caution">unknown — the setup tap has no frame time</span>
            ) : (
              <span className="font-mono tabular-nums">{formatClipTime(climbStart)}</span>
            )}
          </span>
          {actions}
        </div>
      </div>
    </div>
  );
}
