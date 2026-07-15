"use client";

/**
 * Dev-only read-only Ground Truth reviewer.
 *
 * Shows the paused video frame with the scaffold seed skeleton being attested.
 * The author can zoom/pan for inspection and flag the frame Auto / Wrong /
 * Absent, but cannot edit joints, translate poses, or toggle occlusion.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { dark } from "@/utils/theme";
import { getTopology } from "@/utils/poseConstants";
import {
  reviewToFlag,
  type ReviewFlag,
} from "@/utils/harnessGroundTruthScaffold";
import type { GroundTruthFrame, GroundTruthJoint } from "@/utils/harnessGroundTruth";

type Pos = { x: number; y: number };

export interface GroundTruthReviewerProps {
  videoSrc: string;
  /** Native video dimensions; the canvas draws at this resolution. */
  videoWidth: number;
  videoHeight: number;
  /** The working frame, used for the current review flag. */
  frame: GroundTruthFrame;
  /** The immutable seed frame shown on the canvas. */
  seedFrame: GroundTruthFrame;
  /** Non-core scaffold keypoints (video-normalized) drawn faintly for context. */
  contextKeypoints: Record<string, Pos>;
  onFlagChange: (flag: ReviewFlag) => void;
  className?: string;
}

const REVIEW_OPTIONS: readonly { value: ReviewFlag; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Accept the scaffold seed for this frame" },
  { value: "wrong", label: "Wrong", hint: "Climber is present, but the seed skeleton is wrong" },
  { value: "absent", label: "Absent", hint: "No climber is present in this frame" },
];

const { keypointNames, skeletonEdges } = getTopology("mediapipe");
const NAME_BY_INDEX = keypointNames;
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export default function GroundTruthReviewer({
  videoSrc,
  videoWidth,
  videoHeight,
  frame,
  seedFrame,
  contextKeypoints,
  onFlagChange,
  className,
}: GroundTruthReviewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameReadyRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );

  const seedJointsRef = useRef(seedFrame.joints);
  const contextRef = useRef(contextKeypoints);
  useEffect(() => {
    seedJointsRef.current = seedFrame.joints;
  }, [seedFrame.joints]);
  useEffect(() => {
    contextRef.current = contextKeypoints;
  }, [contextKeypoints]);

  const flag = reviewToFlag(frame.review);
  const occludedCount = Object.values(seedFrame.joints).filter((j) => j.occluded).length;
  const jointCount = Object.keys(seedFrame.joints).length;

  const posOf = useCallback((name: string): Pos | null => {
    return seedJointsRef.current[name] ?? contextRef.current[name] ?? null;
  }, []);

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

    const unit = Math.min(w, h);
    const px = (p: Pos) => ({ x: p.x * w, y: p.y * h });

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(1.5, unit * 0.0035);
    for (const [a, b] of skeletonEdges) {
      const pa = posOf(NAME_BY_INDEX[a]);
      const pb = posOf(NAME_BY_INDEX[b]);
      if (!pa || !pb) continue;
      const A = px(pa);
      const B = px(pb);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
    ctx.restore();

    const coreNames = new Set(Object.keys(seedJointsRef.current));
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    for (const name of Object.keys(contextRef.current)) {
      if (coreNames.has(name)) continue;
      const p = px(contextRef.current[name]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.5, unit * 0.004), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const rHandle = Math.max(5, unit * 0.012);
    for (const name of Object.keys(seedJointsRef.current)) {
      const j: GroundTruthJoint = seedJointsRef.current[name];
      const p = px(j);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, rHandle, 0, Math.PI * 2);
      ctx.fillStyle = j.occluded ? "transparent" : dark.accent;
      ctx.strokeStyle = j.occluded ? dark.caution : "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(2, unit * 0.004);
      if (!j.occluded) ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, [videoWidth, videoHeight, posOf]);

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
        video.currentTime = frame.timestamp;
      } catch {
        /* not seekable yet; loadeddata retries */
      }
    };
    if (video.readyState >= 1) applyTime();
    else video.addEventListener("loadeddata", applyTime, { once: true });
    return () => video.removeEventListener("seeked", onSeeked);
  }, [frame.timestamp, draw]);

  useEffect(() => {
    draw();
  }, [draw, seedFrame.joints, contextKeypoints]);

  const clampPan = useCallback((p: Pos, z: number): Pos => {
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
        <div
          role="group"
          aria-label="Frame review"
          className="flex items-center gap-0.5 rounded-md bg-surface-alt p-0.5"
        >
          {REVIEW_OPTIONS.map((opt) => {
            const active = flag === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                title={opt.hint}
                onClick={() => onFlagChange(opt.value)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition",
                  active ? "bg-accent text-fg-inverse" : "text-fg-muted hover:text-fg",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

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

        <div className="ml-auto flex items-center gap-3 text-xs tabular-nums text-fg-muted">
          <span>{jointCount} seed joints</span>
          {occludedCount > 0 && <span className="text-caution">{occludedCount} occluded</span>}
        </div>
      </div>

      <p className="min-h-5 text-xs text-fg-secondary">
        Review the seed skeleton for this frame. Occluded seed joints are hollow.
      </p>

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
          aria-label="Read-only Ground Truth seed skeleton"
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
