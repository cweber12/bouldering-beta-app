"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { NormalizedPoint } from "@/pipeline/matching/orbDetector";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import { drawSkeleton, lerpKeypoints, type OverlayPoint } from "@/pipeline/overlay/skeletonOverlay";
import { dark } from "@/utils/theme";

// ---------------------------------------------------------------------------
// XrayStage — the reusable "x-ray" canvas engine shared by the scan loading
// screen (ScanProgress, fed live by useVideoProcessor) and the landing-page
// demo (XrayReplayDemo, fed by useReplayDriver). It owns nothing but a single
// <canvas>; the parent supplies the sized container.
//
// The stage carries only the scanner's own findings on a dark backdrop:
//   • ORB starfield — the wall feature field (climber masked out), refreshed
//     during the scan so it tracks camera motion.
//   • Pose skeletons — the live pose is accented (bright green, full
//     silhouette) and glides between detections. Each superseded pose is
//     demoted to a neutral "motion trail" that fades over following detections.
//
// Three offscreen layers composite onto the display: the ORB starfield (drawn
// once), the trail (faded then stamped as each pose is demoted), and — redrawn
// live per animation frame — the single accented skeleton.
// ---------------------------------------------------------------------------

export interface XrayStageProps {
  /** Wall ORB feature field (full-frame normalised); null until ready. */
  orbPreview: NormalizedPoint[] | null;
  /** The pose to show now; each new object glides from the last and stamps a trail. */
  currentPose: PoseFrame | null;
  /** Natural video dimensions, to shape the internal canvas; defaults to portrait 9:16. */
  aspect: { w: number; h: number } | null;
  /**
   * Bump to clear the accumulated motion trail (e.g. when a replay loops back to
   * its first pose) so the wake does not jump across the restart.
   */
  resetSignal?: number;
  /** Extra classes for the <canvas> (positioning/sizing is the parent's job). */
  className?: string;
}

/** Longest-edge resolution of the internal render canvas (CSS stretches to fit). */
const CANVAS_BASE = 900;
/** Glide duration between consecutive poses. */
export const GLIDE_MS = 300;
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
/** Blend duration when ORB starfield updates. */
const ORB_FADE_MS = 180;

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

export default function XrayStage({
  orbPreview,
  currentPose,
  aspect,
  resetSignal = 0,
  className,
}: XrayStageProps) {
  const displayRef = useRef<HTMLCanvasElement>(null);

  const aspectW = aspect?.w ?? 9;
  const aspectH = aspect?.h ?? 16;

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
  const prevOrbRef = useRef<HTMLCanvasElement | null>(null);
  const orbFadeStartRef = useRef<number | null>(null);
  const trailRef = useRef<HTMLCanvasElement | null>(null);
  const prevTargetRef = useRef<Record<string, OverlayPoint> | null>(null);
  const lastLiveRef = useRef<Record<string, OverlayPoint> | null>(null);
  const animRef = useRef<{ from: Record<string, OverlayPoint>; to: Record<string, OverlayPoint>; start: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const orbFadeRafRef = useRef<number | null>(null);

  // Composite the ORB starfield + trail + the current live skeleton on top.
  const render = useCallback((live: Record<string, OverlayPoint> | null) => {
    const display = displayRef.current;
    const dctx = display?.getContext("2d");
    if (!display || !dctx) return;
    dctx.clearRect(0, 0, cw, ch);
    const fadeStart = orbFadeStartRef.current;
    let orbAlpha = 1;
    if (fadeStart !== null) {
      orbAlpha = Math.min(1, (performance.now() - fadeStart) / ORB_FADE_MS);
      if (orbAlpha >= 1) {
        orbFadeStartRef.current = null;
        prevOrbRef.current = null;
      }
    }
    if (prevOrbRef.current && orbAlpha < 1) {
      dctx.save();
      dctx.globalAlpha = 1 - orbAlpha;
      dctx.drawImage(prevOrbRef.current, 0, 0);
      dctx.restore();
    }
    if (orbRef.current) {
      dctx.save();
      dctx.globalAlpha = orbAlpha;
      dctx.drawImage(orbRef.current, 0, 0);
      dctx.restore();
    }
    if (trailRef.current) dctx.drawImage(trailRef.current, 0, 0);
    if (live) drawLive(dctx, live);
  }, [cw, ch]);

  // (Re)initialise the trail layer whenever the render size changes, or when the
  // parent bumps resetSignal (e.g. a replay loop wrap) — a fresh scan; reset the
  // pose accumulation.
  useEffect(() => {
    const trail = document.createElement("canvas");
    trail.width = cw; trail.height = ch;
    trailRef.current = trail;
    prevTargetRef.current = null;
    lastLiveRef.current = null;
    animRef.current = null;
    render(null);
  }, [cw, ch, resetSignal, render]);

  // ORB starfield — owned entirely by this effect. It always (re)builds its own
  // layer from the current keypoints + size, so it can never be left blank by a
  // re-init of the trail layer. Idempotent: no "drawn once" flag to fall out of
  // sync with the canvas it guards.
  useEffect(() => {
    if (!orbPreview) {
      prevOrbRef.current = orbRef.current;
      orbRef.current = null;
      orbFadeStartRef.current = performance.now();
      render(lastLiveRef.current);
      return;
    }
    const orb = document.createElement("canvas");
    orb.width = cw; orb.height = ch;
    const octx = orb.getContext("2d");
    if (!octx) return;
    drawStarfield(octx, orbPreview, cw, ch);
    prevOrbRef.current = orbRef.current;
    orbRef.current = orb;
    orbFadeStartRef.current = performance.now();
    render(lastLiveRef.current);
  }, [orbPreview, cw, ch, render]);

  // Animate the ORB cross-fade even when pose updates are sparse.
  useEffect(() => {
    if (orbFadeStartRef.current === null) return;
    const step = () => {
      if (orbFadeStartRef.current === null) {
        orbFadeRafRef.current = null;
        return;
      }
      render(lastLiveRef.current);
      orbFadeRafRef.current = requestAnimationFrame(step);
    };
    orbFadeRafRef.current = requestAnimationFrame(step);
    return () => {
      if (orbFadeRafRef.current !== null) {
        cancelAnimationFrame(orbFadeRafRef.current);
        orbFadeRafRef.current = null;
      }
    };
  }, [orbPreview, render]);

  // Each new pose: fade the existing trail a notch and stamp the just-superseded
  // pose into it (neutral), then glide the accented skeleton from the last shown
  // pose to the new one (snap if the user prefers reduced motion).
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
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [currentPose, cw, ch, render]);

  return (
    <canvas
      ref={displayRef}
      width={cw}
      height={ch}
      className={className}
      aria-hidden="true"
    />
  );
}
