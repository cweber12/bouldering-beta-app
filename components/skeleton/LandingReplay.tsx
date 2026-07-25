"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReplayClock } from "@/hooks/useReplayClock";
import {
  computeStableBodyScale,
  drawSkeleton,
  type OverlayPoint,
} from "@/pipeline/overlay/skeletonOverlay";
import {
  LANDING_REPLAY_ASSET_PATH,
  REPLAY_ANIMATION_SECONDS,
  readReplayPlaylist,
  replayKeypointName,
  type LandingReplayItem,
  type ReplayKeypoint,
} from "@/pipeline/overlay/landingReplayItem";
import {
  composePlaylistLayers,
  composeReplayFrame,
  containRect,
  morphKeypoints,
  sampleReplayPose,
  toStage,
  type ContainRect,
  type ReplayLayer,
} from "@/pipeline/overlay/landingReplayFrame";
import { mediaContainerStyle } from "@/utils/mediaContainerStyle";

// ---------------------------------------------------------------------------
// LandingReplay — the landing-page hero. It plays the curated playlist: 1-5
// replay items, in the checked-in file's order, each a four-phase story in which
// the scanner's x-ray view of the climb resolves into the Route Overlay on the
// real wall.
//
// An item captures more climbing than it spends showing it: ~20 captured seconds
// over a 12-second window, so the figure runs at ~1.7×. Detection is 2 Hz and the
// stored track is interpolated up from there, so the speed-up costs no motion
// that was ever measured — it buys a longer look at the ascent for the same
// dwell time. The phases below are fractions of the *screen* window; pose and
// Hold times are captured seconds.
//
//   0-12%   the wall still rises out of the dark stage behind the figure
//   12-30%  the ORB starfield ignites on that still — the scanner reading it
//   30-46%  the still recedes to black while the ambient field thins to the
//           matched wall features: the x-ray beat, with no photograph under it
//   46-84%  the matched points and the Skeleton migrate into Route Photo space,
//           the Route Photo itself rising late and slow beneath them — the
//           payoff, so it gets the longest window
//   84-100% the matched points retire and the Route Overlay stands alone
//
// The hero deliberately draws **no Holds**: they are a secondary feature, and a
// ring lighting up mid-morph reads as clutter against the one thing this clip is
// for — the Skeleton arriving on the wall. Items still carry them, so re-enabling
// is a call to drawHolds, not a re-curation.
//
// An item may carry no wall still (the field is optional), in which case phases
// 1-2 play against the dark stage as the hero originally did.
//
// Every visitor sees the same playlist and the hero is passive: no previous/next,
// no per-visitor ordering, one pause/play control. Items hand off with a 300 ms
// crossfade and wrap to the first item for as long as the clock runs.
//
// The renderer only lerps and crossfades. Every expensive step (ORB match,
// homography, Hold projection, Skeleton transform) already ran once at authoring
// time on /dev/landing-clip, and each item carries **both** coordinate spaces, so
// the phase-3 morph is interpolation between two saved arrays — no OpenCV, no
// MediaPipe, no homography here. The arithmetic — phase windows, pose sampling,
// contain mapping and the playlist handoff — lives in
// `pipeline/overlay/landingReplayFrame`; this file is the canvas and the chrome.
//
// Time comes from exactly one clock (`useReplayClock`) whose pause inputs are
// the visitor, the intersection observer, the tab's visibility, and the
// reduced-motion preference. That one clock also drives the cycling, so a pause
// freezes the handoff exactly as it freezes a phase. If the asset is missing or
// every item fails the guard the hero renders nothing and the page degrades to its
// text content — there is no fallback asset and no fallback load path.
// ---------------------------------------------------------------------------

/**
 * Screen time per item, in milliseconds — the window all four phases are
 * fractions of. Each item carries its own (longer) captured span, so the figure
 * plays back at `item.duration / REPLAY_ANIMATION_SECONDS`.
 */
const DURATION_MS = REPLAY_ANIMATION_SECONDS * 1000;

/** Longest-edge resolution of the internal render canvas (CSS stretches to fit). */
const CANVAS_BASE = 900;
/** Stage shape before a playlist loads, and when one carries no usable dimensions. */
const FALLBACK_ASPECT = { w: 9, h: 16 } as const;

/** The stage's pixel size and the CSS aspect it presents. */
interface StageSize {
  w: number;
  h: number;
}

/**
 * The stage takes the **first item's source plane** and holds it for the whole
 * playlist.
 *
 * It is one shape for the run of the page, not the aspect of whichever item is
 * showing: both coordinate planes are contained inside it up front, so neither
 * the phase-3 morph nor an item handoff can reflow the layout. But it is no
 * longer hard-coded portrait — curated footage is as often landscape, and a 16:9
 * clip letterboxed into a 9:16 box renders as a strip a quarter of the frame
 * high. The source plane wins over the Route Photo's because phases 1-2 are the
 * video's own wall still, and that is what should fill the frame.
 */
function stageSize(items: readonly LandingReplayItem[]): StageSize {
  const first = items[0]?.source;
  const w = first && first.w > 0 ? first.w : FALLBACK_ASPECT.w;
  const h = first && first.h > 0 ? first.h : FALLBACK_ASPECT.h;
  const scale = CANVAS_BASE / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

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
/**
 * Spacing between wake samples, in **captured** seconds. Holding it in captured
 * rather than screen time keeps the trail the same length behind the figure at
 * any playback rate; the whole wake simply passes by faster.
 */
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
    const name = replayKeypointName(kp);
    if (!name) continue;
    const p = toStage(rect, kp[1], kp[2]);
    out[name] = { x: p.x, y: p.y, score: kp[3] };
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
  /** Stable body scale per space, so limb widths never pulse with the movement. */
  sourceScale: number;
  photoScale: number;
}

function buildGeometry(item: LandingReplayItem, stage: StageSize): ReplayGeometry {
  const sourceRect = containRect(item.source.w, item.source.h, stage.w, stage.h);
  const photoRect = containRect(item.photo.w, item.photo.h, stage.w, stage.h);

  return {
    sourceRect,
    photoRect,
    starfield: item.starfield.map((p) => toStage(sourceRect, p.x, p.y)),
    matches: item.matches.map((m) => ({
      from: toStage(sourceRect, m.sx, m.sy),
      to: toStage(photoRect, m.px, m.py),
    })),
    sourceScale: computeStableBodyScale(
      item.poses.map((p) => ({ keypoints: stageFromList(p.source, sourceRect) })),
      stage.w,
      stage.h,
    ),
    photoScale: computeStableBodyScale(
      item.poses.map((p) => ({ keypoints: stageFromList(p.photo, photoRect) })),
      stage.w,
      stage.h,
    ),
  };
}

// ---------------------------------------------------------------------------
// Drawing one item at one instant
// ---------------------------------------------------------------------------

/**
 * One item's decoded backdrops. Either may still be absent — a decode in flight,
 * or an item authored without a wall still — and the frame composes the same way
 * regardless; the missing backdrop simply leaves the stage dark behind the figure.
 */
interface ItemImages {
  /** The video-space wall still, drawn in the source plane through phases 1-3. */
  frame?: HTMLImageElement;
  /** The Route Photo, drawn in the photo plane from phase 3 on. */
  photo?: HTMLImageElement;
}

/**
 * Paint one replay item at `elapsedMs` of its own clip into `ctx`.
 *
 * Pure function of the clock value: it reads no component state and leaves no
 * residue on the context, so the caller can send it at the visible stage (the
 * common single-item case) or at an offscreen layer that then gets composited at
 * a handoff alpha. `wake` is a scratch canvas for the motion trail, cleared on
 * every use and safe to share between layers.
 */
function drawReplayItem(
  ctx: CanvasRenderingContext2D,
  elapsedMs: number,
  item: LandingReplayItem,
  geometry: ReplayGeometry,
  images: ItemImages,
  wake: HTMLCanvasElement,
  stage: StageSize,
): void {
  const frame = composeReplayFrame(elapsedMs, DURATION_MS, item.duration);
  const { sourceRect, photoRect } = geometry;

  // 1 — the wall still from the source video, rising behind the figure.
  if (images.frame && frame.frameAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = frame.frameAlpha;
    ctx.drawImage(images.frame, sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h);
    ctx.restore();
  }

  // 2 — the ambient wall field igniting on it, in the same source space.
  if (frame.starfieldAlpha > 0) {
    const r = Math.max(1, Math.min(stage.w, stage.h) * 0.0024);
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

  // 3 — the Route Photo rising through phase 3 as the still hands over.
  if (images.photo && frame.photoAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = frame.photoAlpha;
    ctx.drawImage(images.photo, photoRect.x, photoRect.y, photoRect.w, photoRect.h);
    ctx.restore();
  }

  // 4 — the matched features, migrating from source space to photo space.
  if (frame.matchAlpha > 0) {
    const r = Math.max(1.5, Math.min(stage.w, stage.h) * 0.004);
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

  // 5 — the wake: superseded poses on their own layer, composited at one alpha.
  if (frame.trailAlpha > 0) {
    const wctx = wake.getContext("2d");
    if (wctx) {
      wctx.clearRect(0, 0, stage.w, stage.h);
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

  // 6 — the live figure, on top in every phase.
  const live = figureAt(frame.clipSeconds);
  if (live) drawSkeleton(ctx, live, { bodyScale });
}

/** An offscreen stage-sized canvas, created on first use and resized with the stage. */
function ensureCanvas(
  ref: React.MutableRefObject<HTMLCanvasElement | null>,
  stage: StageSize,
): HTMLCanvasElement {
  const canvas = ref.current ?? document.createElement("canvas");
  if (canvas.width !== stage.w) canvas.width = stage.w;
  if (canvas.height !== stage.h) canvas.height = stage.h;
  ref.current = canvas;
  return canvas;
}

/** The item the caption belongs to: the most opaque layer, incoming on a tie. */
function dominantLayer(layers: readonly ReplayLayer[]): ReplayLayer | null {
  let best: ReplayLayer | null = null;
  for (const layer of layers) if (!best || layer.alpha >= best.alpha) best = layer;
  return best;
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
  const [items, setItems] = useState<LandingReplayItem[]>([]);
  // Keyed by item id rather than index, so a decode can never land on the wrong
  // clip and there is nothing to reset when the playlist arrives.
  const [images, setImages] = useState<Record<string, ItemImages>>({});
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Own wake layer: composited once at the frame's trail alpha, because
  // drawSkeleton sets globalAlpha itself and would overwrite a per-call fade.
  const wakeRef = useRef<HTMLCanvasElement | null>(null);
  // One offscreen layer, reused: during a handoff each item is drawn into it and
  // blitted at that layer's alpha, so a per-item fade cannot leak into the alphas
  // the phase composition is already using inside the item.
  const layerRef = useRef<HTMLCanvasElement | null>(null);

  const { elapsedMs, running, togglePaused } = useReplayClock({
    targetRef: stageRef,
    enabled: items.length > 0,
    // Reduced motion parks on the finished Route Overlay — the last frame of the
    // first clip, held at the instant before the handoff starts — and stays
    // there until the visitor presses play.
    staticElapsedMs: DURATION_MS,
  });

  // The playlist asset. One fetch, one guard, no fallback: anything unexpected
  // leaves the playlist empty and the hero renders nothing.
  useEffect(() => {
    let mounted = true;
    fetch(LANDING_REPLAY_ASSET_PATH)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const playlist = readReplayPlaylist(data);
        if (mounted && playlist.length > 0) setItems(playlist);
      })
      .catch(() => {
        /* no asset — the hero degrades to the page's text content */
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Decode every item's embedded images up front, so a handoff never waits on a
  // decode. Until one resolves its clip still runs; that backdrop simply stays
  // dark, which is also what an item with no wall still looks like throughout.
  useEffect(() => {
    if (items.length === 0) return;
    let mounted = true;
    const decode = (src: string, slot: keyof ItemImages, id: string) => {
      const img = new window.Image();
      img.onload = () => {
        if (mounted) setImages((prev) => ({ ...prev, [id]: { ...prev[id], [slot]: img } }));
      };
      img.src = src;
    };
    for (const item of items) {
      decode(item.photo.webp, "photo", item.id);
      if (item.source.webp) decode(item.source.webp, "frame", item.id);
    }
    return () => {
      mounted = false;
    };
  }, [items]);

  // One stage shape for the whole playlist, taken from the first item's source
  // plane — see stageSize. Geometry is contained into it, so both are memoised
  // together and nothing reflows once a clip is running.
  const stage = useMemo(() => stageSize(items), [items]);
  const geometries = useMemo(() => items.map((i) => buildGeometry(i, stage)), [items, stage]);

  // Which item (or crossfading pair) the one clock puts on the stage right now.
  const layers = useMemo(
    () => composePlaylistLayers(elapsedMs, items.length, DURATION_MS),
    [elapsedMs, items.length],
  );

  // ── The frame ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || layers.length === 0) return;

    ctx.clearRect(0, 0, stage.w, stage.h);
    const wake = ensureCanvas(wakeRef, stage);

    // Away from a handoff there is one item at full opacity: draw it straight at
    // the stage and skip the layer blit entirely.
    if (layers.length === 1 && layers[0].alpha >= 1) {
      const { index, elapsedMs: clipMs } = layers[0];
      const item = items[index];
      const geometry = geometries[index];
      if (item && geometry) {
        drawReplayItem(ctx, clipMs, item, geometry, images[item.id] ?? {}, wake, stage);
      }
      return;
    }

    // Mid-handoff: each item composites as a whole at its own alpha, back to front.
    const layer = ensureCanvas(layerRef, stage);
    const lctx = layer.getContext("2d");
    if (!lctx) return;
    for (const { index, elapsedMs: clipMs, alpha } of layers) {
      const item = items[index];
      const geometry = geometries[index];
      if (!item || !geometry) continue;
      lctx.clearRect(0, 0, stage.w, stage.h);
      drawReplayItem(lctx, clipMs, item, geometry, images[item.id] ?? {}, wake, stage);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    }
  }, [layers, items, images, geometries, stage]);

  // Sized like the scan flow: fill the width but cap the height so the stage never
  // overflows on first paint.
  const stageStyle = useMemo(() => {
    const { w, h } = stage;
    if (maxHeight) {
      const ratio = (w / h).toFixed(6);
      return {
        width: `min(100%, calc(${maxHeight} * ${ratio}))`,
        maxHeight,
        aspectRatio: `${w} / ${h}`,
      } as const;
    }
    return mediaContainerStyle(w, h);
  }, [maxHeight, stage]);

  // The caption follows whichever item is currently the more visible of the two.
  const captioned = dominantLayer(layers);
  if (!captioned || !items[captioned.index]) return null;

  const { area, route, rating } = items[captioned.index].label;

  return (
    <figure className="flex w-full flex-col items-center gap-3">
      <div
        ref={stageRef}
        className="relative mx-auto w-full overflow-hidden rounded-md border border-edge/40 bg-scan-stage"
        style={stageStyle}
      >
        <canvas
          ref={canvasRef}
          width={stage.w}
          height={stage.h}
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
