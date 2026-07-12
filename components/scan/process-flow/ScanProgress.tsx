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
//   • Pose skeletons — the live pose is accented (bright green, full
//     silhouette) and glides between detections. Each superseded pose is
//     demoted to a neutral "motion trail" that fades out over the following
//     detections, so the wake recedes and the live pose is always the one
//     bright figure to pinpoint.
//
// Three offscreen layers composite onto the display: the ORB starfield (drawn
// once), the trail (faded then stamped as each pose is demoted), and — redrawn
// live per animation frame — the single accented skeleton.
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
/** Neutral (desaturated slate) colour a demoted pose is stamped in. */
const TRAIL_COLOR = "rgba(148, 163, 184, 0.5)";
/**
 * Alpha erased from the whole trail layer each time a new pose is demoted, so
 * older poses fade out over the following detections instead of accumulating
 * into a bright tangle. ~0.2 keeps roughly the last dozen poses as a receding
 * wake before they vanish.
 */
const TRAIL_FADE = 0.2;

/** Build a canvas-space keypoint map from a normalised PoseFrame. */
function toOverlay(pose: PoseFrame, w: number, h: number): Record<string, OverlayPoint> {
  const out: Record<string, OverlayPoint> = {};
  for (const kp of pose.keypoints) out[kp.name] = { x: kp.x * w, y: kp.y * h, score: kp.score };
  return out;
}

/** Paint the faint ORB starfield onto a context. */
function drawStarfield(
  ctx: CanvasRenderingContext2D,
  pts: NormalizedPoint[],
  w: number,
  h: number,
): void {
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

/** Fade the whole trail layer toward transparent so old poses recede. */
function fadeTrail(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Stamp a demoted pose into the trail layer: neutral, lines-only, muted. */
function stampTrail(ctx: CanvasRenderingContext2D, kp: Record<string, OverlayPoint>): void {
  drawSkeleton(ctx, kp, {
    silhouetteVisible: false,
    jointsVisible: false,
    linesVisible: true,
    lineColor: TRAIL_COLOR,
    estimatedDimThreshold: 0, // trail reads uniformly; no per-joint dimming
  });
}

/** Draw the live, accented skeleton (bright green, full silhouette) so it reads
 *  as the single hot figure above the neutral wake. */
function drawLive(ctx: CanvasRenderingContext2D, kp: Record<string, OverlayPoint>): void {
  drawSkeleton(ctx, kp, {
    silhouetteColor: dark.accent,
    silhouetteOpacity: 0.24,
    lineColor: dark.accent,
    lineThickness: 0.02,
    jointColor: "#7cf0b0", // brighter mint so joints pop off the lines
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

  // Offscreen layers composited under the live skeleton. Refs so accumulation
  // survives re-renders. The ORB layer is owned by its own effect; the trail
  // fades + stamps over time.
  const orbRef = useRef<HTMLCanvasElement | null>(null);
  const trailRef = useRef<HTMLCanvasElement | null>(null);
  const prevTargetRef = useRef<Record<string, OverlayPoint> | null>(null);
  const lastLiveRef = useRef<Record<string, OverlayPoint> | null>(null);
  const animRef = useRef<{
    from: Record<string, OverlayPoint>;
    to: Record<string, OverlayPoint>;
    start: number;
  } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Composite the ORB starfield + trail + the current live skeleton on top.
  const render = useCallback(
    (live: Record<string, OverlayPoint> | null) => {
      const display = displayRef.current;
      const dctx = display?.getContext("2d");
      if (!display || !dctx) return;
      dctx.clearRect(0, 0, cw, ch);
      if (orbRef.current) dctx.drawImage(orbRef.current, 0, 0);
      if (trailRef.current) dctx.drawImage(trailRef.current, 0, 0);
      if (live) drawLive(dctx, live);
    },
    [cw, ch],
  );

  // (Re)initialise the trail layer whenever the render size changes —
  // effectively a fresh scan; reset the pose accumulation.
  useEffect(() => {
    const trail = document.createElement("canvas");
    trail.width = cw;
    trail.height = ch;
    trailRef.current = trail;
    prevTargetRef.current = null;
    lastLiveRef.current = null;
    animRef.current = null;
    render(null);
  }, [cw, ch, render]);

  // ORB starfield — owned entirely by this effect. It always (re)builds its own
  // layer from the current keypoints + size, so it can never be left blank by a
  // re-init of the trail layer. Idempotent: no "drawn once" flag to fall out of
  // sync with the canvas it guards.
  useEffect(() => {
    if (!orbPreview) {
      orbRef.current = null;
      render(lastLiveRef.current);
      return;
    }
    const orb = document.createElement("canvas");
    orb.width = cw;
    orb.height = ch;
    const octx = orb.getContext("2d");
    if (!octx) return;
    drawStarfield(octx, orbPreview, cw, ch);
    orbRef.current = orb;
    render(lastLiveRef.current);
  }, [orbPreview, cw, ch, render]);

  // Each new detected pose: fade the existing trail a notch and stamp the just-
  // superseded pose into it (neutral), then glide the accented skeleton from the
  // last shown pose to the new one (snap if the user prefers reduced motion).
  useEffect(() => {
    if (!currentPose || currentPose.keypoints.length === 0) return;
    const target = toOverlay(currentPose, cw, ch);

    const tctx = trailRef.current?.getContext("2d");
    if (tctx && prevTargetRef.current) {
      fadeTrail(tctx, cw, ch);
      stampTrail(tctx, prevTargetRef.current);
    }
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
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
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
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div
            className="flex flex-1 items-center justify-center gap-2"
            role="status"
            aria-live="polite"
          >
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
