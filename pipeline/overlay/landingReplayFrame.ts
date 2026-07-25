/**
 * The landing replay's **frame composition** — everything the hero renderer needs
 * to know about "what does the stage look like at this instant", derived purely
 * from one number: elapsed milliseconds off the replay clock.
 *
 * The renderer only lerps and crossfades (see the PRD's design invariant), and
 * this module is where all of that arithmetic lives so it can be pinned down by
 * tests without a canvas. Four things happen here:
 *
 *  - **Playlist cycling.** The same clock decides which item is on screen: every
 *    item owns one clip-length slot, the first 300 ms of each slot crossfades from
 *    the previous item, and the cycle wraps to the first item indefinitely.
 *  - **Phase windows.** One item's screen window runs four fixed windows — 0-30%,
 *    30-45%, 45-80%, 80-100% — and each window is expressed as a set of alphas
 *    plus a single `morph` factor. Windows are fractions of the clip, never
 *    wall-clock offsets, so pausing cannot desynchronise them.
 *  - **Pose sampling by time.** The pose plays continuously across all four
 *    phases, sampled at the clip-relative second the clock is on. Phases change
 *    the *space* the figure is drawn in, never the playback rate.
 *  - **Contain mapping.** Both coordinate planes (source video, Route Photo) are
 *    letterboxed into one fixed portrait stage up front, so the morph moves
 *    points between two rectangles that were computed before the clip started —
 *    nothing reflows partway through.
 *
 * Framework-agnostic — no React imports, no OpenCV. Keep it that way.
 */

import { lerpKeypoints, type OverlayPoint } from "@/pipeline/overlay/skeletonOverlay";
import {
  replayKeypointName,
  type ReplayKeypoint,
  type ReplayPose,
} from "@/pipeline/overlay/landingReplayItem";

// ---------------------------------------------------------------------------
// Phase windows
// ---------------------------------------------------------------------------

/** End of phase 1 (starfield + video-space pose) as a fraction of the clip. */
export const PHASE_1_END = 0.3;
/** End of phase 2 (starfield fades out, matched source points emerge). */
export const PHASE_2_END = 0.45;
/** End of phase 3 (Route Photo appears, points + Skeleton morph into its space). */
export const PHASE_3_END = 0.8;

/** Which of the four fixed windows a clip progress falls in. */
export type ReplayPhase = 1 | 2 | 3 | 4;

/** Everything the renderer composites for one instant of one item. */
export interface ReplayFrameComposition {
  /** Clip progress in [0,1]. */
  progress: number;
  /**
   * Clip-relative **captured** seconds — what pose sampling and Hold reveal read.
   * Scaled by the item's playback rate, so it runs ahead of screen time.
   */
  clipSeconds: number;
  phase: ReplayPhase;
  /** ORB wall starfield, drawn in source space. */
  starfieldAlpha: number;
  /** Paired wall features — the points that visibly migrate during the morph. */
  matchAlpha: number;
  /** The Route Photo backdrop. */
  photoAlpha: number;
  /** The motion trail behind the live figure. */
  trailAlpha: number;
  /** 0 = draw in source video space, 1 = draw in Route Photo space. */
  morph: number;
}

/** Linear ramp of `t` across `[from, to]`, clamped to [0,1]. */
function ramp(t: number, from: number, to: number): number {
  if (to <= from) return t >= to ? 1 : 0;
  return Math.max(0, Math.min(1, (t - from) / (to - from)));
}

/** Smoothstep easing — used for the morph so the migration eases in and out
 *  while still hitting exactly 0 and 1 on the phase-3 boundaries. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Clip progress in [0,1] for a monotonic elapsed clock.
 *
 * A whole number of completed clips reads as the **end** of a clip (1) rather
 * than the start of the next (0). For a running clock that boundary is
 * measure-zero and the two are visually identical, but it is what lets the
 * reduced-motion clock park exactly on the duration and show the finished Route
 * Overlay instead of snapping back to the starfield.
 */
export function clipProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs <= 0) return 0;
  const frac = (elapsedMs % durationMs) / durationMs;
  return frac === 0 ? 1 : frac;
}

/**
 * Project elapsed clock time onto the four-phase composition.
 *
 * Every ramp is continuous at its boundary — phase 2 opens with the starfield
 * still at full and the matched points still at zero, phase 3 opens with the
 * photo hidden and the morph at zero, phase 4 opens with the morph complete —
 * so a boundary crossing never shows a visible step.
 *
 * `durationMs` is **screen** time and `captureSeconds` is how much climbing the
 * clip holds; the phases are fractions of the former and `clipSeconds` runs on
 * the latter. Passing a capture window wider than the animation is what plays the
 * ascent above 1×; omitting it plays real time.
 */
export function composeReplayFrame(
  elapsedMs: number,
  durationMs: number,
  captureSeconds: number = durationMs / 1000,
): ReplayFrameComposition {
  const progress = clipProgress(elapsedMs, durationMs);
  const phase: ReplayPhase =
    progress < PHASE_1_END ? 1 : progress < PHASE_2_END ? 2 : progress < PHASE_3_END ? 3 : 4;

  // Phase 2 swaps the ambient wall field for the matched subset of it.
  const swap = ramp(progress, PHASE_1_END, PHASE_2_END);
  // Phase 3 raises the Route Photo and carries everything into its space.
  const migrate = ramp(progress, PHASE_2_END, PHASE_3_END);
  // Phase 4 retires the scaffolding so the Route Overlay stands alone.
  const settle = ramp(progress, PHASE_3_END, 1);

  return {
    progress,
    clipSeconds: progress * captureSeconds,
    phase,
    starfieldAlpha: 1 - swap,
    matchAlpha: swap * (1 - settle),
    photoAlpha: migrate,
    // The wake belongs to the x-ray half of the story; it clears as the figure
    // arrives on the wall so the final frame reads like a real exported overlay.
    trailAlpha: 1 - migrate,
    morph: smoothstep(migrate),
  };
}

// ---------------------------------------------------------------------------
// Playlist cycling — which item (or pair of items) the stage shows
// ---------------------------------------------------------------------------

/** Width of the crossfade that hands one item off to the next. */
export const HANDOFF_MS = 300;

/** One item drawn at one instant: which clip, how far into it, at what opacity. */
export interface ReplayLayer {
  /** Playlist index — items play in file order, and file order is the only order. */
  index: number;
  /** Elapsed milliseconds *within that item's own clip*, for {@link composeReplayFrame}. */
  elapsedMs: number;
  /** Stage opacity in (0,1]. Across a handoff the two layers' alphas sum to 1. */
  alpha: number;
}

/**
 * Project the one replay clock onto the playlist.
 *
 * Each item owns a `durationMs` slot on the clock, and the cycle is
 * `itemCount × durationMs` long, so cycling wraps back to the first item and
 * continues for as long as the clock runs. The first `handoffMs` of every slot is
 * a crossfade: the incoming item plays from `t = 0` while the outgoing one holds
 * its **own final frame** — the finished Route Overlay, the payoff of its clip —
 * and fades out beneath it. Holding rather than advancing is deliberate: the
 * clip's last frame is already static except for the figure, whereas letting the
 * outgoing clock run on would wrap it straight back to its starfield.
 *
 * The return is paint order, back to front, and never longer than two entries.
 * Two boundary cases carry weight:
 *
 *  - The **first** slot has no predecessor to fade from, so the hero simply
 *    starts on the first item rather than dissolving in from the last one.
 *  - Every later slot *opens* on its predecessor alone at full opacity, which is
 *    what lets the clock park on exactly `durationMs` and show the first item's
 *    finished Route Overlay — the frame reduced motion holds.
 */
export function composePlaylistLayers(
  elapsedMs: number,
  itemCount: number,
  durationMs: number,
  handoffMs: number = HANDOFF_MS,
): ReplayLayer[] {
  if (itemCount <= 0) return [];
  if (durationMs <= 0) return [{ index: 0, elapsedMs: 0, alpha: 1 }];

  const handoff = Math.max(0, Math.min(handoffMs, durationMs));
  // Slots are counted from the clock's origin, not from the current cycle, so a
  // cold start is distinguishable from the wrap that lands on the same item.
  const slot = Math.floor(Math.max(0, elapsedMs) / durationMs);
  const local = Math.max(0, elapsedMs) - slot * durationMs;
  const index = slot % itemCount;

  // How far through the handoff we are; 1 once the crossfade has finished.
  const arrived = slot === 0 || handoff === 0 ? 1 : Math.min(1, local / handoff);
  const incoming: ReplayLayer = { index, elapsedMs: local, alpha: arrived };
  if (arrived >= 1) return [incoming];

  const outgoing: ReplayLayer = {
    index: (index + itemCount - 1) % itemCount,
    elapsedMs: durationMs,
    alpha: 1 - arrived,
  };
  return arrived > 0 ? [outgoing, incoming] : [outgoing];
}

// ---------------------------------------------------------------------------
// Contain mapping — both coordinate planes letterboxed into one stage
// ---------------------------------------------------------------------------

/** A plane's letterboxed placement on the stage, in stage pixels. */
export interface ContainRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Letterbox a coordinate plane into the stage, preserving its aspect ratio and
 * centring it. Computed once per item per plane — the source video plane and the
 * Route Photo plane each get one — so the morph interpolates between two fixed
 * rectangles and the stage never reflows partway through a clip.
 */
export function containRect(
  planeW: number,
  planeH: number,
  stageW: number,
  stageH: number,
): ContainRect {
  const pw = planeW > 0 ? planeW : 1;
  const ph = planeH > 0 ? planeH : 1;
  const scale = Math.min(stageW / pw, stageH / ph);
  const w = pw * scale;
  const h = ph * scale;
  return { x: (stageW - w) / 2, y: (stageH - h) / 2, w, h };
}

/** Map a normalized `[0,1]` point of a plane onto the stage. */
export function toStage(rect: ContainRect, x: number, y: number): { x: number; y: number } {
  return { x: rect.x + x * rect.w, y: rect.y + y * rect.h };
}

// ---------------------------------------------------------------------------
// Pose sampling
// ---------------------------------------------------------------------------

/** One sampled pose, still normalized, in both baked coordinate spaces. */
export interface SampledReplayPose {
  source: Record<string, OverlayPoint>;
  photo: Record<string, OverlayPoint>;
}

/** Encoded keypoints → the name-keyed map the overlay drawing helpers expect. */
function toMap(keypoints: readonly ReplayKeypoint[]): Record<string, OverlayPoint> {
  const out: Record<string, OverlayPoint> = {};
  for (const kp of keypoints) {
    const name = replayKeypointName(kp);
    if (name) out[name] = { x: kp[1], y: kp[2], score: kp[3] };
  }
  return out;
}

/**
 * The pose at clip-relative second `t`, interpolated between the two baked
 * samples that bracket it — the same blend in both spaces, so the figure stays
 * one figure however far the morph has carried it.
 *
 * Sampling is by time, not by index, which is what makes playback continuous
 * across the phase boundaries: the phases read the same clock and only decide
 * which space the result is drawn in. Times outside the clip clamp to the first
 * or last sample.
 */
export function sampleReplayPose(
  poses: readonly ReplayPose[],
  t: number,
): SampledReplayPose | null {
  if (poses.length === 0) return null;

  const first = poses[0];
  if (t <= first.t) return { source: toMap(first.source), photo: toMap(first.photo) };
  const last = poses[poses.length - 1];
  if (t >= last.t) return { source: toMap(last.source), photo: toMap(last.photo) };

  let i = 1;
  while (i < poses.length - 1 && poses[i].t < t) i++;
  const a = poses[i - 1];
  const b = poses[i];
  const span = b.t - a.t;
  const alpha = span > 0 ? (t - a.t) / span : 0;

  return {
    source: lerpKeypoints(toMap(a.source), toMap(b.source), alpha),
    photo: lerpKeypoints(toMap(a.photo), toMap(b.photo), alpha),
  };
}

/** Blend two keypoint maps that are already in stage pixels. Thin alias kept so
 *  the renderer states its intent (source space → photo space) in one call. */
export function morphKeypoints(
  source: Record<string, OverlayPoint>,
  photo: Record<string, OverlayPoint>,
  morph: number,
): Record<string, OverlayPoint> {
  if (morph <= 0) return source;
  if (morph >= 1) return photo;
  return lerpKeypoints(source, photo, morph);
}
