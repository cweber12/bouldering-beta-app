"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReplayClock } from "@/hooks/useReplayClock";
import type { Hold } from "@/pipeline/holds/holdDetection";
import { drawHolds } from "@/pipeline/holds/holdsOverlay";
import {
  computeStableBodyScale,
  drawSkeleton,
  type OverlayPoint,
} from "@/pipeline/overlay/skeletonOverlay";
import {
  LANDING_REPLAY_ASSET_PATH,
  REPLAY_CLIP_SECONDS,
  isReplayItem,
  type LandingReplayItem,
  type ReplayKeypoint,
} from "@/pipeline/overlay/landingReplayItem";
import {
  composeReplayFrame,
  containRect,
  morphKeypoints,
  sampleReplayPose,
  toStage,
  type ContainRect,
} from "@/pipeline/overlay/landingReplayFrame";
import { mediaContainerStyle } from "@/utils/mediaContainerStyle";

// ---------------------------------------------------------------------------
// LandingReplay — the landing-page hero. It plays one curated replay item as an
// 8-second, four-phase story: the scanner's x-ray view of the climb resolves
// into the Route Overlay on the real wall.
//
//   0-30%   starfield + the video-space figure and its motion trail
//   30-45%  the ambient starfield fades out; the matched wall features emerge
//   45-80%  the Route Photo rises while the matched points and the Skeleton
//           migrate into its space — the payoff, so it gets the longest window
//   80-100% the matched points retire and the Route Overlay stands alone, Holds
//           revealing on their own clip-relative times
//
// The renderer only lerps and crossfades. Every expensive step (ORB match,
// homography, Hold projection, Skeleton transform) already ran once at authoring
// time on /dev/landing-clip, and the item carries **both** coordinate spaces, so
// the phase-3 morph is interpolation between two saved arrays — no OpenCV, no
// MediaPipe, no homography here. The arithmetic lives in
// `pipeline/overlay/landingReplayFrame`; this file is the canvas and the chrome.
//
// Time comes from exactly one clock (`useReplayClock`) whose pause inputs are
// the visitor, the intersection observer, the tab's visibility, and the
// reduced-motion preference. If the asset is missing or fails its guard the hero
// renders nothing and the page degrades to its text content — there is no
// fallback asset and no fallback load path.
// ---------------------------------------------------------------------------

/** Clip length in milliseconds — the window all four phases are fractions of. */
const DURATION_MS = REPLAY_CLIP_SECONDS * 1000;

/**
 * The stage is a fixed portrait frame, not the item's own aspect: both
 * coordinate planes are contained inside it up front, so neither the phase-3
 * morph nor (later) an item handoff can reflow the layout.
 */
const STAGE_ASPECT = { w: 9, h: 16 } as const;
/** Longest-edge resolution of the internal render canvas (CSS stretches to fit). */
const CANVAS_BASE = 900;
const CANVAS_H = CANVAS_BASE;
const CANVAS_W = Math.round((CANVAS_BASE * STAGE_ASPECT.w) / STAGE_ASPECT.h);

/** Faint neutral starfield colour (warm stone), matching the scan x-ray stage. */
const STARFIELD_COLOR = "rgba(232, 228, 222, 0.38)";
/** Matched features read as the scanner's own findings — the accent green. */
const MATCH_COLOR = "#7bb695";
/** Base motion-trail colour (desaturated slate), same wake as the scan stage. */
const TRAIL_COLOR = "#94a3b8";
/** The stage backdrop (`--color-scan-stage`) older trail poses recede toward. */
const STAGE_BG = "#0a0908";
/** How many superseded poses form the wake. */
const TRAIL_COUNT = 6;
/** Spacing between wake samples, in clip seconds. */
const TRAIL_STEP_S = 0.18;

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Blend `hex` toward `toward` by `t`. The wake fades by receding into the stage
 * backdrop rather than by opacity: `drawSkeleton` owns `globalAlpha` for its own
 * confidence dimming, so a per-pose alpha set from outside would not survive.
 */
function mixHex(hex: string, toward: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(toward);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Wake colours, oldest last — precomputed once, they never change. */
const TRAIL_COLORS = Array.from({ length: TRAIL_COUNT }, (_, k) =>
  mixHex(TRAIL_COLOR, STAGE_BG, (k + 1) / (TRAIL_COUNT + 1)),
);

// ---------------------------------------------------------------------------
// Geometry — resolved once per item, before the clip starts
// ---------------------------------------------------------------------------

/** Map a baked (normalized) keypoint list onto the stage. */
function stageFromList(
  keypoints: readonly ReplayKeypoint[],
  rect: ContainRect,
): Record<string, OverlayPoint> {
  const out: Record<string, OverlayPoint> = {};
  for (const kp of keypoints) {
    const p = toStage(rect, kp.x, kp.y);
    out[kp.n] = { x: p.x, y: p.y, score: kp.s };
  }
  return out;
}

/** Map a sampled (normalized) keypoint map onto the stage. */
function stageFromMap(
  keypoints: Record<string, OverlayPoint>,
  rect: ContainRect,
): Record<string, OverlayPoint> {
  const out: Record<string, OverlayPoint> = {};
  for (const [name, kp] of Object.entries(keypoints)) {
    const p = toStage(rect, kp.x, kp.y);
    out[name] = { x: p.x, y: p.y, score: kp.score };
  }
  return out;
}

interface ReplayGeometry {
  sourceRect: ContainRect;
  photoRect: ContainRect;
  /** Wall starfield in stage pixels. */
  starfield: { x: number; y: number }[];
  /** Matched features: where each one sits in each space, in stage pixels. */
  matches: { from: { x: number; y: number }; to: { x: number; y: number } }[];
  /** Holds in stage pixels, revealing on their clip-relative `firstUseTime`. */
  holds: Hold[];
  /** Stable body scale per space, so limb widths never pulse with the movement. */
  sourceScale: number;
  photoScale: number;
}

function buildGeometry(item: LandingReplayItem): ReplayGeometry {
  const sourceRect = containRect(item.source.w, item.source.h, CANVAS_W, CANVAS_H);
  const photoRect = containRect(item.photo.w, item.photo.h, CANVAS_W, CANVAS_H);

  return {
    sourceRect,
    photoRect,
    starfield: item.starfield.map((p) => toStage(sourceRect, p.x, p.y)),
    matches: item.matches.map((m) => ({
      from: toStage(sourceRect, m.sx, m.sy),
      to: toStage(photoRect, m.px, m.py),
    })),
    holds: item.holds.map((h, i) => {
      const p = toStage(photoRect, h.x, h.y);
      return {
        id: `hold-${i}`,
        order: i + 1,
        kind: h.kind,
        side: h.side,
        x: p.x,
        y: p.y,
        firstUseTime: h.t,
      };
    }),
    sourceScale: computeStableBodyScale(
      item.poses.map((p) => ({ keypoints: stageFromList(p.source, sourceRect) })),
      CANVAS_W,
      CANVAS_H,
    ),
    photoScale: computeStableBodyScale(
      item.poses.map((p) => ({ keypoints: stageFromList(p.photo, photoRect) })),
      CANVAS_W,
      CANVAS_H,
    ),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LandingReplayProps {
  /**
   * Optional CSS length capping the stage height (the hero column wants a
   * shorter frame than the full viewport); width follows the portrait ratio.
   * Omitted, the stage uses the scan-flow default capped to the viewport.
   */
  maxHeight?: string;
}

export default function LandingReplay({ maxHeight }: LandingReplayProps = {}) {
  const [item, setItem] = useState<LandingReplayItem | null>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Own wake layer: composited once at the frame's trail alpha, because
  // drawSkeleton sets globalAlpha itself and would overwrite a per-call fade.
  const wakeRef = useRef<HTMLCanvasElement | null>(null);

  const { elapsedMs, running, togglePaused } = useReplayClock({
    targetRef: stageRef,
    enabled: item !== null,
    // Reduced motion parks on the finished Route Overlay — the last frame of the
    // clip — and stays there until the visitor presses play.
    staticElapsedMs: DURATION_MS,
  });

  // The playlist asset. One fetch, one guard, no fallback: anything unexpected
  // leaves `item` null and the hero renders nothing.
  useEffect(() => {
    let mounted = true;
    fetch(LANDING_REPLAY_ASSET_PATH)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const first = (data as { items?: unknown[] } | null)?.items?.[0];
        if (mounted && isReplayItem(first)) setItem(first);
      })
      .catch(() => {
        /* no asset — the hero degrades to the page's text content */
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Decode the embedded Route Photo. Until it resolves the morph still runs; the
  // backdrop simply stays dark.
  useEffect(() => {
    if (!item) return;
    let mounted = true;
    const img = new window.Image();
    img.onload = () => {
      if (mounted) setPhoto(img);
    };
    img.src = item.photo.webp;
    return () => {
      mounted = false;
    };
  }, [item]);

  const geometry = useMemo(() => (item ? buildGeometry(item) : null), [item]);

  // ── The frame ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !item || !geometry) return;

    const frame = composeReplayFrame(elapsedMs, DURATION_MS);
    const { sourceRect, photoRect } = geometry;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // 1 — the ambient wall field, in source space.
    if (frame.starfieldAlpha > 0) {
      const r = Math.max(1, Math.min(CANVAS_W, CANVAS_H) * 0.0024);
      ctx.save();
      ctx.globalAlpha = frame.starfieldAlpha;
      ctx.fillStyle = STARFIELD_COLOR;
      for (const p of geometry.starfield) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 2 — the Route Photo rising through phase 3.
    if (photo && frame.photoAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = frame.photoAlpha;
      ctx.drawImage(photo, photoRect.x, photoRect.y, photoRect.w, photoRect.h);
      ctx.restore();
    }

    // 3 — the matched features, migrating from source space to photo space.
    if (frame.matchAlpha > 0) {
      const r = Math.max(1.5, Math.min(CANVAS_W, CANVAS_H) * 0.004);
      ctx.save();
      ctx.globalAlpha = frame.matchAlpha;
      ctx.fillStyle = MATCH_COLOR;
      for (const m of geometry.matches) {
        const x = m.from.x + (m.to.x - m.from.x) * frame.morph;
        const y = m.from.y + (m.to.y - m.from.y) * frame.morph;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    const bodyScale =
      geometry.sourceScale + (geometry.photoScale - geometry.sourceScale) * frame.morph;

    /** The figure at clip second `t`, already carried `morph` into photo space. */
    const figureAt = (t: number): Record<string, OverlayPoint> | null => {
      const sampled = sampleReplayPose(item.poses, t);
      if (!sampled) return null;
      return morphKeypoints(
        stageFromMap(sampled.source, sourceRect),
        stageFromMap(sampled.photo, photoRect),
        frame.morph,
      );
    };

    // 4 — the wake: superseded poses on their own layer, composited at one alpha.
    if (frame.trailAlpha > 0) {
      let wake = wakeRef.current;
      if (!wake) {
        wake = document.createElement("canvas");
        wake.width = CANVAS_W;
        wake.height = CANVAS_H;
        wakeRef.current = wake;
      }
      const wctx = wake.getContext("2d");
      if (wctx) {
        wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        for (let k = TRAIL_COUNT - 1; k >= 0; k--) {
          const t = frame.clipSeconds - (k + 1) * TRAIL_STEP_S;
          if (t < 0) continue; // before the clip opened — nothing to trail yet
          const kp = figureAt(t);
          if (!kp) continue;
          drawSkeleton(wctx, kp, {
            silhouetteVisible: false,
            jointsVisible: false,
            linesVisible: true,
            lineColor: TRAIL_COLORS[k],
            estimatedDimThreshold: 0, // the wake reads uniformly
            bodyScale,
          });
        }
        ctx.save();
        ctx.globalAlpha = frame.trailAlpha;
        ctx.drawImage(wake, 0, 0);
        ctx.restore();
      }
    }

    // 5 — Holds, beneath the figure, revealing on their clip-relative times.
    if (frame.photoAlpha > 0 && geometry.holds.length > 0) {
      ctx.save();
      ctx.globalAlpha = frame.photoAlpha;
      drawHolds(ctx, geometry.holds, frame.clipSeconds, undefined, bodyScale);
      ctx.restore();
    }

    // 6 — the live figure, on top in every phase.
    const live = figureAt(frame.clipSeconds);
    if (live) drawSkeleton(ctx, live, { bodyScale });
  }, [elapsedMs, item, photo, geometry]);

  // Portrait frame sized like the scan flow: fill the width but cap the height so
  // the stage never overflows on first paint.
  const stageStyle = useMemo(() => {
    const { w, h } = STAGE_ASPECT;
    if (maxHeight) {
      const ratio = (w / h).toFixed(6);
      return {
        width: `min(100%, calc(${maxHeight} * ${ratio}))`,
        maxHeight,
        aspectRatio: `${w} / ${h}`,
      } as const;
    }
    return mediaContainerStyle(w, h);
  }, [maxHeight]);

  if (!item) return null;

  const { area, route, rating } = item.label;

  return (
    <figure className="flex flex-col items-center gap-3">
      <div
        ref={stageRef}
        className="relative mx-auto w-full overflow-hidden rounded-md border border-edge/40 bg-scan-stage"
        style={stageStyle}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="absolute inset-0 h-full w-full object-fill"
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={togglePaused}
          aria-label={running ? "Pause replay" : "Play replay"}
          className="ui-control absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface/70 text-fg backdrop-blur-sm"
        >
          {running ? (
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
              <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4.5 2.8v10.4a.8.8 0 0 0 1.22.68l8.2-5.2a.8.8 0 0 0 0-1.36l-8.2-5.2A.8.8 0 0 0 4.5 2.8Z" />
            </svg>
          )}
        </button>
      </div>

      <figcaption className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-body-sm text-fg-secondary">
        <span className="font-medium text-fg">{route}</span>
        {area && <span className="text-fg-muted">·</span>}
        {area && <span>{area}</span>}
        {rating && (
          <span className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-label text-fg-light">
            {rating}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
