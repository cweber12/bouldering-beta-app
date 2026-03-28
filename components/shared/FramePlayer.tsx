"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { drawSkeleton, type SkeletonStyle } from "@/pipeline/skeletonOverlay";
import type { RenderedSkeletonFrame } from "@/pipeline/skeletonRenderer";

/** A single layer of pre-computed skeleton data with optional visual style. */
export interface FramePlayerLayer {
  frames: RenderedSkeletonFrame[];
  style?: SkeletonStyle;
}

/** Imperative methods exposed via ref for external playback control. */
export interface FramePlayerHandle {
  play: () => void;
  pause: () => void;
}

interface FramePlayerProps {
  /** Image drawn as the background of every frame. */
  imageFile: File;
  /** One or more skeleton layers to draw on top of the image. */
  layers: FramePlayerLayer[];
  /** Total animation duration in seconds. */
  duration: number;
  /** Restart automatically when the end is reached. Default true. */
  loop?: boolean;
  /** When true the built-in play/pause button is hidden (for master-play UIs). */
  hidePlayButton?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Binary-search the sorted frames array for the nearest timestamp. */
function findNearest(
  frames: RenderedSkeletonFrame[],
  t: number,
): RenderedSkeletonFrame | null {
  const len = frames.length;
  if (len === 0) return null;
  let lo = 0;
  let hi = len - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timestamp < t) lo = mid + 1;
    else hi = mid;
  }
  if (
    lo > 0 &&
    Math.abs(frames[lo - 1].timestamp - t) < Math.abs(frames[lo].timestamp - t)
  ) {
    return frames[lo - 1];
  }
  return frames[lo];
}

/** Format seconds as M:SS. */
function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Canvas-based frame player that draws a background image with one or more
 * skeleton overlays at 60 fps using requestAnimationFrame.
 *
 * No video encoding is involved — playback is instant.
 *
 * Features:
 * - Play / pause toggle
 * - Draggable seek bar
 * - Time display (M:SS / M:SS)
 * - Loop support (default on)
 *
 * The canvas draws at the image's native resolution and is CSS-scaled to
 * fill the container width, preserving aspect ratio.
 */
const FramePlayer = forwardRef<FramePlayerHandle, FramePlayerProps>(function FramePlayer({
  imageFile,
  layers,
  duration,
  loop = true,
  hidePlayButton = false,
  className,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const layersRef = useRef(layers);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const animRef = useRef(0);
  const lastTickRef = useRef(0);
  const lastUiRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [ready, setReady] = useState(false);

  // Keep layers ref current without re-triggering animation loop.
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  // Load the image as an ImageBitmap.
  useEffect(() => {
    let cancelled = false;
    createImageBitmap(imageFile).then((bmp) => {
      if (cancelled) {
        bmp.close();
        return;
      }
      bitmapRef.current = bmp;
      setReady(true);
    });
    return () => {
      cancelled = true;
      if (bitmapRef.current) {
        bitmapRef.current.close();
        bitmapRef.current = null;
      }
      setReady(false);
    };
  }, [imageFile]);

  // Draw a single frame at the given time (seconds).
  const drawFrame = useCallback((t: number) => {
    const canvas = canvasRef.current;
    const bmp = bitmapRef.current;
    if (!canvas || !bmp) return;

    if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
      canvas.width = bmp.width;
      canvas.height = bmp.height;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(bmp, 0, 0);

    for (const layer of layersRef.current) {
      const nearest = findNearest(layer.frames, t);
      if (nearest && Object.keys(nearest.keypoints).length > 0) {
        drawSkeleton(ctx, nearest.keypoints, layer.style);
      }
    }
  }, []);

  // rAF loop — runs at display refresh rate with no React re-renders per frame.
  // Stored in a ref to avoid self-reference issues with useCallback.
  const tickRef = useRef<FrameRequestCallback | null>(null);

  useEffect(() => {
    tickRef.current = (now: number) => {
      if (!playingRef.current) return;

      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      timeRef.current += delta;
      if (timeRef.current >= duration) {
        if (loop) {
          timeRef.current %= duration;
        } else {
          timeRef.current = duration;
          playingRef.current = false;
          setPlaying(false);
          setDisplayTime(duration);
          drawFrame(duration);
          return;
        }
      }

      drawFrame(timeRef.current);

      // Throttle UI state updates to ~10 Hz for the seek bar / time label.
      if (now - lastUiRef.current > 100) {
        setDisplayTime(timeRef.current);
        lastUiRef.current = now;
      }

      animRef.current = requestAnimationFrame(tickRef.current!);
    };
  }, [duration, loop, drawFrame]);

  // Start / stop animation loop.
  useEffect(() => {
    if (playing) {
      lastTickRef.current = performance.now();
      lastUiRef.current = performance.now();
      playingRef.current = true;
      animRef.current = requestAnimationFrame(tickRef.current!);
    } else {
      playingRef.current = false;
      cancelAnimationFrame(animRef.current);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [playing]);

  // Draw the first frame when the image is ready.
  useEffect(() => {
    if (ready) drawFrame(0);
  }, [ready, drawFrame]);

  // Re-draw current frame when layers change (e.g. style sliders) while paused.
  useEffect(() => {
    if (ready && !playing) drawFrame(timeRef.current);
  }, [layers, ready, playing, drawFrame]);

  // Expose imperative play/pause to parent via ref.
  useImperativeHandle(ref, () => ({
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
  }), []);

  function togglePlay() {
    setPlaying((p) => !p);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const t = parseFloat(e.target.value);
    timeRef.current = t;
    setDisplayTime(t);
    drawFrame(t);
  }

  if (!ready) {
    return (
      <div
        className={[
          "flex items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 py-10",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
      </div>
    );
  }

  return (
    <div
      className={[
        "flex flex-col gap-0 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <canvas ref={canvasRef} className="w-full" style={{ display: "block" }} />

      <div className="flex items-center gap-3 bg-zinc-950/80 px-3 py-2">
        {!hidePlayButton && (
          <button
            onClick={togglePlay}
            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-300 transition hover:text-zinc-100"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        )}

        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={displayTime}
          onChange={handleSeek}
          className="h-1 flex-1 cursor-pointer accent-zinc-400"
          aria-label="Seek"
        />

        <span className="select-none whitespace-nowrap text-xs tabular-nums text-zinc-500">
          {formatTime(displayTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
});

export default FramePlayer;
