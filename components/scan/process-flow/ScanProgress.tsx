"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { NormalizedPoint } from "@/pipeline/matching/orbDetector";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import { drawSkeleton, lerpKeypoints, type OverlayPoint } from "@/pipeline/overlay/skeletonOverlay";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { fitMediaStyle } from "@/utils/mediaContainerStyle";
import { dark } from "@/utils/theme";

// ---------------------------------------------------------------------------
// ScanProgress — the loading view shown while a scan runs. It mirrors the
// Step 2 (StepSetDetection) layout: the same top/bottom bars and the same
// measured, aspect-bounded media stage. The bars carry no controls — the top
// bar labels the step, the bottom bar shows the percentage and the cancel X.
//
// The stage is an "x-ray" of the frame we no longer paint: a plain, always-dark
// backdrop carrying only the scanner's own findings, all at their true
// frame-relative positions.
//
//   • ORB starfield — the wall feature field (climber masked out) the matcher
//     relies on, extracted once from the reference frame and drawn as a faint
//     neutral field. It appears first and persists for the whole scan.
//   • Pose skeletons — every detected pose stays visible. The live pose is
//     accented (green, full silhouette) and glides between detections; each
//     superseded pose is demoted to a muted ghost-green "motion trail".
//
// The trail + starfield accumulate on a static offscreen canvas (drawn once
// each), so only the single accented skeleton is re-rendered per animation
// frame.
// ---------------------------------------------------------------------------

export interface ScanProgressProps {
  /** Wall ORB feature field (full-frame normalised); null until ready. */
  orbPreview: NormalizedPoint[] | null;
  /** The pose detected on the current detection frame; null until first found. */
  currentPose: PoseFrame | null;
  /** Natural video dimensions, to shape the stage; defaults to portrait 9:16. */
  videoAspect: { w: number; h: number } | null;
  /** Seek-loop progress, 0–100. */
  progressPct: number;
  /** True once the seek loop is done and refinement / ORB are still running. */
  finishing: boolean;
  /** Abort the scan and return to the detection step. */
  onCancel: () => void;
}

/** Longest-edge resolution of the internal render canvas (CSS stretches to fit). */
const CANVAS_BASE = 900;
/** Glide duration between consecutive detected poses. */
const GLIDE_MS = 300;
/** Faint neutral starfield colour (warm stone, low alpha) for ORB keypoints. */
const ORB_COLOR = "rgba(232, 228, 222, 0.38)";
/** Muted ghost of the accent for the trailing (previous) skeletons. */
const TRAIL_COLOR = "rgba(34, 197, 94, 0.16)";

/** Build a canvas-space keypoint map from a normalised PoseFrame. */
function toOverlay(pose: PoseFrame, w: number, h: number): Record<string, OverlayPoint> {
  const out: Record<string, OverlayPoint> = {};
  for (const kp of pose.keypoints) out[kp.name] = { x: kp.x * w, y: kp.y * h, score: kp.score };
  return out;
}

/** Paint the faint ORB starfield onto a context. */
function drawStarfield(ctx: CanvasRenderingContext2D, pts: NormalizedPoint[], w: number, h: number): void {
  ctx.save();
  ctx.fillStyle = ORB_COLOR;
  const r = Math.max(1, Math.min(w, h) * 0.0024);
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Stamp a muted, lines-only skeleton (the motion trail) onto a context. */
function stampTrail(ctx: CanvasRenderingContext2D, kp: Record<string, OverlayPoint>): void {
  drawSkeleton(ctx, kp, {
    silhouetteVisible: false,
    jointsVisible: false,
    linesVisible: true,
    lineColor: TRAIL_COLOR,
    estimatedDimThreshold: 0, // trail reads uniformly; no per-joint dimming
  });
}

/** Draw the live, accented skeleton (green, full silhouette) onto a context. */
function drawLive(ctx: CanvasRenderingContext2D, kp: Record<string, OverlayPoint>): void {
  drawSkeleton(ctx, kp, {
    silhouetteColor: dark.accent,
    silhouetteOpacity: 0.2,
    lineColor: dark.accent,
    jointColor: dark.accent,
  });
}

export default function ScanProgress({
  orbPreview,
  currentPose,
  videoAspect,
  progressPct,
  finishing,
  onCancel,
}: ScanProgressProps) {
  const [stageRef, stageHeight] = useMeasuredHeight();
  const displayRef = useRef<HTMLCanvasElement>(null);

  const aspectW = videoAspect?.w ?? 9;
  const aspectH = videoAspect?.h ?? 16;

  // Internal canvas resolution, longest edge capped to CANVAS_BASE.
  const { cw, ch } = useMemo(() => {
    const ar = aspectW / aspectH;
    return ar >= 1
      ? { cw: CANVAS_BASE, ch: Math.max(1, Math.round(CANVAS_BASE / ar)) }
      : { cw: Math.max(1, Math.round(CANVAS_BASE * ar)), ch: CANVAS_BASE };
  }, [aspectW, aspectH]);

  // Static layer (ORB starfield + accumulated trail); the accented skeleton is
  // composited over it live. Refs so accumulation survives re-renders.
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const orbDrawnRef = useRef(false);
  const prevTargetRef = useRef<Record<string, OverlayPoint> | null>(null);
  const lastLiveRef = useRef<Record<string, OverlayPoint> | null>(null);
  const animRef = useRef<{ from: Record<string, OverlayPoint>; to: Record<string, OverlayPoint>; start: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Composite the static layer + the current live skeleton onto the display.
  const render = useCallback((live: Record<string, OverlayPoint> | null) => {
    const display = displayRef.current;
    const dctx = display?.getContext("2d");
    if (!display || !dctx) return;
    dctx.clearRect(0, 0, cw, ch);
    if (staticRef.current) dctx.drawImage(staticRef.current, 0, 0);
    if (live) drawLive(dctx, live);
  }, [cw, ch]);

  // (Re)initialise the static canvas whenever the render size changes — this is
  // effectively a fresh scan; reset all accumulation.
  useEffect(() => {
    const s = document.createElement("canvas");
    s.width = cw;
    s.height = ch;
    staticRef.current = s;
    orbDrawnRef.current = false;
    prevTargetRef.current = null;
    lastLiveRef.current = null;
    animRef.current = null;
    render(null);
  }, [cw, ch, render]);

  // Draw the ORB starfield once, under everything, when it arrives.
  useEffect(() => {
    if (!orbPreview || orbDrawnRef.current) return;
    const sctx = staticRef.current?.getContext("2d");
    if (!sctx) return;
    drawStarfield(sctx, orbPreview, cw, ch);
    orbDrawnRef.current = true;
    render(lastLiveRef.current);
  }, [orbPreview, cw, ch, render]);

  // Each new detected pose: demote the previous one to the trail, then glide the
  // accented skeleton from the last shown pose to the new one (snap if the user
  // prefers reduced motion).
  useEffect(() => {
    if (!currentPose || currentPose.keypoints.length === 0) return;
    const target = toOverlay(currentPose, cw, ch);

    const sctx = staticRef.current?.getContext("2d");
    if (sctx && prevTargetRef.current) stampTrail(sctx, prevTargetRef.current);
    prevTargetRef.current = target;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const from = reduceMotion ? target : (lastLiveRef.current ?? target);
    animRef.current = { from, to: target, start: performance.now() };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const step = () => {
      const anim = animRef.current;
      if (!anim) return;
      const t = Math.min(1, (performance.now() - anim.start) / GLIDE_MS);
      const live = t >= 1 ? anim.to : lerpKeypoints(anim.from, anim.to, t);
      lastLiveRef.current = live;
      render(live);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [currentPose, cw, ch, render]);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Scanning video">
      {/* Top bar — mirrors the Step 2 toolbar height; no controls. */}
      <header className="shrink-0 border-b border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex h-7 w-full max-w-5xl items-center gap-3">
          <span className="text-sm font-medium text-fg">Scanning video</span>
        </div>
      </header>

      {/* Media stage — same structure and sizing as StepSetDetection, but a
          plain always-dark backdrop carrying only the scan's findings. */}
      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        <div
          ref={stageRef}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        >
          <div
            className="relative overflow-hidden bg-scan-stage"
            style={fitMediaStyle(aspectW, aspectH, stageHeight)}
          >
            <canvas
              ref={displayRef}
              width={cw}
              height={ch}
              className="absolute inset-0 h-full w-full object-fill"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      {/* Bottom bar — mirrors the Step 2 footer; contents replaced by progress. */}
      <footer className="shrink-0 border-t border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel scan"
            title="Cancel scan"
            className="ui-control -ml-1 flex h-8 w-8 shrink-0 items-center justify-center p-0 text-fg-muted"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="flex flex-1 items-center justify-center gap-2" role="status" aria-live="polite">
            {finishing ? (
              <span className="text-sm font-medium text-fg-secondary">Finishing up&#8230;</span>
            ) : (
              <>
                <span className="text-sm text-fg-secondary">Scanning</span>
                <span className="text-sm font-semibold tabular-nums text-fg">{progressPct}%</span>
              </>
            )}
          </div>

          {/* Spacer to keep the progress text optically centered against the X. */}
          <div className="h-8 w-8 shrink-0" aria-hidden="true" />
        </div>
      </footer>
    </section>
  );
}
