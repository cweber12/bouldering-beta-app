"use client";

/**
 * Dev-only zoomable video-frame stage.
 *
 * One seeked video frame painted to a canvas, with 1x-6x zoom and pan, and a
 * caller-supplied overlay drawn on top. This is the machinery both harness
 * review surfaces need — the Ground Truth reviewer draws one seed skeleton on
 * it, the run reviewer draws the Ground Truth and the run's pose together — so
 * it lives here once rather than being written twice.
 *
 * The stage owns the video element, the seek, the canvas sizing and the
 * zoom/pan transform. It owns nothing about *what* is drawn: consumers pass a
 * {@link FrameStagePainter} and get the frame already painted underneath, plus
 * the geometry needed to place normalized points. Repaints happen on seek, on
 * resize of the source, and whenever the painter identity changes — so a
 * consumer memoises its painter over the data it draws.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/utils/cn";
import { dark } from "@/utils/theme";

/** A video-normalized point, [0, 1] on both axes. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/** Canvas geometry handed to a painter, so it never re-derives the mapping. */
export interface FrameStageGeometry {
  /** Canvas width in pixels (the video's native width). */
  width: number;
  /** Canvas height in pixels (the video's native height). */
  height: number;
  /**
   * `min(width, height)` — the scale unit for line widths and marker radii, so
   * an overlay reads the same on a portrait ascent and a landscape clip.
   */
  unit: number;
  /** Map a video-normalized point into canvas pixels. */
  px(p: NormalizedPoint): NormalizedPoint;
}

/**
 * Draws the overlay for one frame. Called with the video frame already painted
 * (or a placeholder fill, before the first `seeked`), on a context with no
 * transform applied — zoom and pan are CSS on the canvas element, so a painter
 * always works in native video pixels.
 */
export type FrameStagePainter = (
  ctx: CanvasRenderingContext2D,
  geom: FrameStageGeometry,
) => void;

export interface FrameStageProps {
  videoSrc: string;
  /** Native video dimensions; the canvas draws at this resolution. */
  videoWidth: number;
  videoHeight: number;
  /** Video time (seconds) to seek to and paint. */
  timestamp: number;
  /** Draws the overlay over the painted frame. Memoise over the data it reads. */
  paint: FrameStagePainter;
  /** Accessible name for the canvas — what this stage is showing. */
  canvasLabel: string;
  /** Consumer controls, rendered at the start of the toolbar row. */
  controls?: ReactNode;
  /** Consumer status text, pushed to the end of the toolbar row. */
  status?: ReactNode;
  /** A line of guidance under the toolbar. Reserves its height when absent. */
  caption?: ReactNode;
  className?: string;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export default function FrameStage({
  videoSrc,
  videoWidth,
  videoHeight,
  timestamp,
  paint,
  canvasLabel,
  controls,
  status,
  caption,
  className,
}: FrameStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameReadyRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<NormalizedPoint>({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const w = videoWidth || video.videoWidth || 16;
    const h = videoHeight || video.videoHeight || 9;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    if (frameReadyRef.current && video.videoWidth > 0) {
      ctx.drawImage(video, 0, 0, w, h);
    } else {
      ctx.fillStyle = dark.surfaceAlt;
      ctx.fillRect(0, 0, w, h);
    }

    paint(ctx, {
      width: w,
      height: h,
      unit: Math.min(w, h),
      px: (p) => ({ x: p.x * w, y: p.y * h }),
    });
  }, [videoWidth, videoHeight, paint]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    frameReadyRef.current = false;
    const onSeeked = () => {
      frameReadyRef.current = true;
      draw();
    };
    video.addEventListener("seeked", onSeeked);
    const applyTime = () => {
      try {
        video.currentTime = timestamp;
      } catch {
        /* not seekable yet; loadeddata retries */
      }
    };
    if (video.readyState >= 1) applyTime();
    else video.addEventListener("loadeddata", applyTime, { once: true });
    return () => video.removeEventListener("seeked", onSeeked);
  }, [timestamp, draw]);

  // Repaint when the overlay changes without the frame changing (a toggle
  // flipped, a different run selected on the same timestamp).
  useEffect(() => {
    draw();
  }, [draw]);

  const clampPan = useCallback((p: NormalizedPoint, z: number): NormalizedPoint => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return p;
    const maxX = (rect.width * (z - 1)) / 2;
    const maxY = (rect.height * (z - 1)) / 2;
    return { x: clamp(p.x, -maxX, maxX), y: clamp(p.y, -maxY, maxY) };
  }, []);

  const zoomAt = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const z2 = clamp(next, ZOOM_MIN, ZOOM_MAX);
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) {
        setZoom(z2);
        return;
      }
      if (z2 === 1) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }
      const r = z2 / zoom;
      const dx = clientX != null ? clientX - rect.left - rect.width / 2 : 0;
      const dy = clientY != null ? clientY - rect.top - rect.height / 2 : 0;
      setZoom(z2);
      setPan(clampPan({ x: dx * (1 - r) + r * pan.x, y: dy * (1 - r) + r * pan.y }, z2));
    },
    [zoom, pan, clampPan],
  );

  const zoomAtRef = useRef(zoomAt);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomAtRef.current = zoomAt;
    zoomRef.current = zoom;
  }, [zoomAt, zoom]);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      zoomAtRef.current(
        zoomRef.current + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP),
        e.clientX,
        e.clientY,
      );
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (zoom <= 1) return;
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    [zoom, pan],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setPan(
        clampPan(
          { x: drag.panX + (e.clientX - drag.startX), y: drag.panY + (e.clientY - drag.startY) },
          zoom,
        ),
      );
    },
    [clampPan, zoom],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {controls}

        <div className="flex items-center gap-1 rounded-md bg-surface-alt px-1.5 py-1">
          <button
            type="button"
            onClick={() => zoomAt(zoom - ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            className="h-6 w-6 rounded text-sm font-semibold text-fg disabled:opacity-40"
            aria-label="Zoom out"
          >
            -
          </button>
          <span className="w-10 text-center text-xs tabular-nums text-fg-muted">
            {zoom.toFixed(1)}x
          </span>
          <button
            type="button"
            onClick={() => zoomAt(zoom + ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            className="h-6 w-6 rounded text-sm font-semibold text-fg disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
          {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
            <button
              type="button"
              onClick={() => zoomAt(1)}
              className="ml-1 rounded px-1.5 text-xs text-fg-muted hover:text-fg"
            >
              reset
            </button>
          )}
        </div>

        {status && (
          <div className="ml-auto flex items-center gap-3 text-xs tabular-nums text-fg-muted">
            {status}
          </div>
        )}
      </div>

      <p className="min-h-5 text-xs text-fg-secondary">{caption}</p>

      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "relative mx-auto flex min-h-0 select-none items-center justify-center overflow-hidden rounded-lg border border-edge/40 bg-surface-alt",
          zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        )}
        style={{
          aspectRatio: `${videoWidth || 16} / ${videoHeight || 9}`,
          maxHeight: "calc(100dvh - var(--nav-h) - 15rem)",
          touchAction: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label={canvasLabel}
          className="block h-full w-full object-contain"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        />
        <video ref={videoRef} src={videoSrc} muted playsInline preload="auto" className="hidden" />
      </div>
    </div>
  );
}
