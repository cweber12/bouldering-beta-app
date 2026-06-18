"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { drawSkeleton, computeStableBodyScale, type SkeletonStyle } from "@/pipeline/skeletonOverlay";
import type { RenderedSkeletonFrame } from "@/pipeline/skeletonRenderer";
import { drawHolds, type HoldStyle } from "@/pipeline/holdsOverlay";
import type { Hold } from "@/pipeline/holdDetection";
import { cn } from "@/utils/cn";

/** A single layer of pre-computed skeleton data with optional visual style. */
export interface FramePlayerLayer {
  frames: RenderedSkeletonFrame[];
  style?: SkeletonStyle;
  /**
   * Seconds added to the global playback time when sampling this layer's
   * frames. Used to align multiple climbs to a common start: a layer whose
   * sequence begins at t=2s gets timeOffset=2 so global time 0 shows its start.
   */
  timeOffset?: number;
}

/** Imperative methods exposed via ref for external playback control. */
export interface FramePlayerHandle {
  play: () => void;
  pause: () => void;
  /** Jump to an absolute time (seconds) and redraw. */
  seek: (t: number) => void;
  /** Current playback time in seconds. */
  getCurrentTime: () => number;
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
  /** When true, playback starts automatically once the image is loaded. */
  autoPlay?: boolean;
  /**
   * Playback anchor in seconds. Looping wraps back here (not to 0), so an
   * aligned start keeps its sync across loops. Default 0.
   */
  startOffset?: number;
  /**
   * How the canvas sizes within its container:
   * - `"width"` (default): fills the container width, height follows aspect
   *   ratio (the player grows as tall as the frame — fine in a scroll area).
   * - `"contain"`: the canvas shrinks to fit BOTH the width and the height of a
   *   height-bounded parent, preserving aspect ratio. Use this when the player
   *   must never overflow the viewport (e.g. tall portrait frames).
   */
  fit?: "width" | "contain";
  /**
   * When true, drops the player's own border / background so it can sit flush
   * inside a shared surface (e.g. the grouped compare stage). The transport
   * bar keeps its own subtle background.
   */
  bare?: boolean;
  /**
   * ORB reference keypoints drawn as bright-red background dots before the
   * skeleton overlay. Coordinates must be in image-pixel space (matching the
   * native resolution of `imageFile`). Half the configured joint point radius.
   */
  orbKeypoints?: { x: number; y: number }[];
  /**
   * Detected Holds drawn as the **Holds** overlay pass on top of the skeleton
   * layers (Route Overlay only). Coordinates are in image-pixel space; markers
   * reveal progressively as playback time passes each Hold's `firstUseTime`.
   */
  holds?: Hold[];
  /** Style for the Holds pass (colours, visibility). */
  holdStyle?: HoldStyle;
  /**
   * Seconds added to the global playback time when gating Holds, matching the
   * `timeOffset` of the layer the Holds belong to (aligned-start Compare slots).
   * Default 0.
   */
  holdsTimeOffset?: number;
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
  autoPlay = false,
  startOffset = 0,
  orbKeypoints,
  holds,
  holdStyle,
  holdsTimeOffset = 0,
  fit = "width",
  bare = false,
  className,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const layersRef = useRef(layers);
  const orbKeypointsRef = useRef<{ x: number; y: number }[]>([]);
  const holdsRef = useRef<Hold[]>([]);
  const holdStyleRef = useRef<HoldStyle | undefined>(undefined);
  const holdsTimeOffsetRef = useRef(holdsTimeOffset);
  const timeRef = useRef(0);
  // High-water mark for the Holds reveal: the furthest playback time reached
  // since the last Reset. A Hold shows once time has *ever* reached its
  // first-use time, so the first pass reveals Holds in order and they then stay
  // shown across loops; Reset re-arms the sequential reveal (ADR 0009).
  const holdsHighWaterRef = useRef(startOffset);
  // Cache the sequence-stable body scale per layer (keyed by its frames array)
  // so limb widths stay fixed across the sequence and are computed once.
  const scaleCacheRef = useRef(new WeakMap<RenderedSkeletonFrame[], number>());
  const startOffsetRef = useRef(startOffset);
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

  // Keep ORB keypoints ref current.
  useEffect(() => {
    orbKeypointsRef.current = orbKeypoints ?? [];
  }, [orbKeypoints]);

  // Keep the Holds refs current without re-triggering the animation loop.
  useEffect(() => {
    holdsRef.current = holds ?? [];
  }, [holds]);
  useEffect(() => {
    holdStyleRef.current = holdStyle;
  }, [holdStyle]);
  useEffect(() => {
    holdsTimeOffsetRef.current = holdsTimeOffset;
  }, [holdsTimeOffset]);

  // Keep the start-offset ref current; redraw if it moves while paused.
  useEffect(() => {
    startOffsetRef.current = startOffset;
  }, [startOffset]);

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

    // Draw ORB reference keypoints as bright-red background dots. Sized as a
    // small fraction of the canvas so they stay visible at any photo resolution.
    const orb = orbKeypointsRef.current;
    if (orb.length > 0) {
      const orbRadius = Math.max(1, Math.min(canvas.width, canvas.height) * 0.004);
      ctx.save();
      ctx.fillStyle = "#ff2020";
      for (const pt of orb) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, orbRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Holds pass — drawn beneath the skeleton layers so the pose lines stay
    // legible on top of the markers. Gated by the high-water mark (the furthest
    // time reached since Reset), not the instantaneous time, so revealed Holds
    // persist across loops and backward seeks (ADR 0009).
    const holdsList = holdsRef.current;
    if (holdsList.length > 0) {
      const baseFrames = layersRef.current[0]?.frames;
      let holdScale: number | undefined = baseFrames && scaleCacheRef.current.get(baseFrames);
      if (holdScale === undefined) {
        holdScale = baseFrames
          ? computeStableBodyScale(baseFrames, canvas.width, canvas.height)
          : Math.min(canvas.width, canvas.height) * 0.15;
        if (baseFrames) scaleCacheRef.current.set(baseFrames, holdScale);
      }
      if (t > holdsHighWaterRef.current) holdsHighWaterRef.current = t;
      drawHolds(ctx, holdsList, holdsHighWaterRef.current + holdsTimeOffsetRef.current, holdStyleRef.current, holdScale);
    }

    for (const layer of layersRef.current) {
      const nearest = findNearest(layer.frames, t + (layer.timeOffset ?? 0));
      if (nearest && Object.keys(nearest.keypoints).length > 0) {
        // Resolve (and cache) this layer's stable body scale so limb widths do
        // not pulse as the climber moves.
        let scale = scaleCacheRef.current.get(layer.frames);
        if (scale === undefined) {
          scale = computeStableBodyScale(layer.frames, canvas.width, canvas.height);
          scaleCacheRef.current.set(layer.frames, scale);
        }
        drawSkeleton(ctx, nearest.keypoints, { ...layer.style, bodyScale: scale });
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
          // Wrap back to the anchor so an aligned start stays in sync on loop.
          const anchor = startOffsetRef.current;
          const span = duration - anchor;
          timeRef.current = span > 0 ? anchor + ((timeRef.current - anchor) % span) : anchor;
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

  // Draw the first frame when the image is ready; auto-play if requested.
  // Start at the anchor so an aligned player begins at its set start.
  useEffect(() => {
    if (!ready) return;
    timeRef.current = startOffsetRef.current;
    holdsHighWaterRef.current = startOffsetRef.current;
    setDisplayTime(timeRef.current);
    drawFrame(timeRef.current);
    if (!autoPlay) return;
    const id = requestAnimationFrame(() => setPlaying(true));
    return () => cancelAnimationFrame(id);
  }, [ready, drawFrame, autoPlay]);

  // Re-draw current frame when layers or Holds change (e.g. style sliders,
  // visibility toggles) while paused.
  useEffect(() => {
    if (ready && !playing) drawFrame(timeRef.current);
  }, [layers, holds, holdStyle, ready, playing, drawFrame]);

  // Expose imperative controls to parent via ref.
  useImperativeHandle(ref, () => ({
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    seek: (t: number) => {
      timeRef.current = t;
      setDisplayTime(t);
      drawFrame(t);
    },
    getCurrentTime: () => timeRef.current,
  }), [drawFrame]);

  function togglePlay() {
    setPlaying((p) => !p);
  }

  // Replay the Holds reveal: seek back to the anchor and re-arm the high-water
  // mark so Holds reveal in first-use order again (ADR 0009).
  function handleResetHolds() {
    timeRef.current = startOffsetRef.current;
    holdsHighWaterRef.current = startOffsetRef.current;
    setDisplayTime(startOffsetRef.current);
    drawFrame(startOffsetRef.current);
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
        className={cn(
          "flex items-center justify-center rounded-lg border border-edge/50 bg-card/60 py-10",
          className,
        )}
      >
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-edge border-t-fg" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-0 overflow-hidden rounded-lg",
        !bare && "border border-edge/50 bg-surface",
        fit === "contain" && "h-full min-h-0",
        className,
      )}
    >
      {fit === "contain" ? (
        // Centered, viewport-fit canvas: shrinks to fit the bounded parent.
        <div className={cn("flex min-h-0 flex-1 items-center justify-center overflow-hidden", !bare && "bg-surface-alt/30")}>
          <canvas ref={canvasRef} className="block max-h-full max-w-full object-contain" />
        </div>
      ) : (
        <canvas ref={canvasRef} className="w-full block" />
      )}

      <div className="flex shrink-0 items-center gap-3 bg-surface-alt/80 backdrop-blur-sm px-3 py-2">
        {!hidePlayButton && (
          <button
            onClick={togglePlay}
            className="flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition hover:text-fg"
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

        {(holds?.length ?? 0) > 0 && holdStyle?.holdsVisible !== false && (
          <button
            onClick={handleResetHolds}
            className="flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition hover:text-fg"
            aria-label="Replay holds"
            title="Replay the holds reveal"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356M3.985 19.644v-4.992h4.992M19.5 9.348a8.25 8.25 0 00-15.357-2.34M4.5 14.652a8.25 8.25 0 0015.357 2.34" />
            </svg>
          </button>
        )}

        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={displayTime}
          onChange={handleSeek}
          className="h-1 flex-1 cursor-pointer accent-accent"
          aria-label="Seek"
        />

        <span className="select-none whitespace-nowrap text-xs tabular-nums text-fg-muted">
          {formatTime(displayTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
});

export default FramePlayer;
