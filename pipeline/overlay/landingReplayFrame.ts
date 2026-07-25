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
 *  - **Phase windows.** One item's screen window runs four fixed phases, each
 *    expressed as a set of alphas plus a single `morph` factor, and all of them
 *    built from the crossfades in {@link REPLAY_WINDOWS}. Windows are fractions of
 *    the clip, never wall-clock offsets, so pausing cannot desynchronise them.
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

/**
 * Every crossfade in the clip, as `[start, end]` fractions of the screen window.
 *
 * They are listed together because the composition is really one storyboard, and
 * the interesting decisions are all in how these windows *overlap*:
 *
 *  - The wall still **recedes to black** (`still.out`) well before the Route Photo
 *    arrives (`photo`), rather than cross-dissolving straight into it. The gap is
 *    the black starfield beat — the scanner's abstraction of the wall, with
 *    nothing photographic left to lean on. It is bounded on purpose: long enough
 *    to read the matched points travelling, short enough that the visitor still
 *    remembers the real wall when the Route Photo answers it.
 *  - The photo's window starts *after* the morph has begun and runs past its end,
 *    eased so it stays faint through the middle. If the photo arrives at the same
 *    rate as the points, it covers the very migration it is supposed to explain.
 *  - The wake arrives with the black and clears as the figure lands on the wall,
 *    so the motion trail belongs to the x-ray beat rather than the photographic
 *    ones at either end.
 *
 * The `morph` window takes **57% of the clip** — it is the payoff, and the change
 * of coordinate space is the one thing here that cannot be read at a glance. Its
 * budget comes out of the three beats around it, since the clip's length is fixed:
 * the wall still holds a little less, the swap to matched points is quicker, and
 * the finished Route Overlay stands alone for about a second before the handoff
 * (which itself holds that final frame for another 300 ms).
 */
export const REPLAY_WINDOWS = {
  /** The video-space wall still: up out of black, then back down to it. */
  still: { in: [0, 0.1], out: [0.26, 0.34] },
  /** The ambient ORB field igniting on the still, then thinning to the matches. */
  starfield: { in: [0.1, 0.26], out: [0.26, 0.34] },
  /** The matched subset — up as the ambient field thins, retired at the very end. */
  match: { in: [0.26, 0.34], out: [0.91, 1] },
  /** Points and Skeleton travelling from source space into Route Photo space. */
  morph: [0.34, 0.91],
  /** The Route Photo: late and slow, so the migration stays legible under it. */
  photo: [0.45, 0.95],
  /** The motion trail: arrives with the black beat, gone once the figure lands. */
  wake: { in: [0.2, 0.32], out: [0.45, 0.82] },
} as const;

/**
 * End of phase 1's opening beat: the wall still has fully arrived, and only then
 * does the starfield ignite on it. Splitting phase 1 in two is what keeps the cold
 * open — the hero starts on the dark stage rather than cutting to a photograph.
 */
export const PHASE_1_MID = REPLAY_WINDOWS.still.in[1];
/** End of phase 1 (wall still + starfield + video-space pose) as a fraction of the clip. */
export const PHASE_1_END = REPLAY_WINDOWS.starfield.in[1];
/** End of phase 2 (still recedes to black, starfield thins to the matched points). */
export const PHASE_2_END = REPLAY_WINDOWS.morph[0];
/** End of phase 3 (the migration into Route Photo space). */
export const PHASE_3_END = REPLAY_WINDOWS.morph[1];

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
  /**
   * The video-space wall still behind the figure: rises through phase 1's opening
   * beat, then recedes to black across phase 2, leaving the starfield beat with no
   * photograph under it. Zero throughout when the item carries no still.
   */
  frameAlpha: number;
  /** ORB wall starfield, drawn in source space. */
  starfieldAlpha: number;
  /** Paired wall features — the points that visibly migrate during the morph. */
  matchAlpha: number;
  /** The Route Photo backdrop — deliberately behind the morph it sits under. */
  photoAlpha: number;
  /** The motion trail behind the live figure, confined to the x-ray beat. */
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

/** Quadratic ease-in: the Route Photo stays faint for most of its window and
 *  only commits at the end, so it never covers the migration mid-travel. */
function easeIn(t: number): number {
  return t * t;
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
 * so a boundary crossing never shows a visible step. Several ramps deliberately
 * cross phase boundaries — the still recedes into phase 2, the photo rises out of
 * phase 3 — because the storyboard is continuous and the phase numbers are only a
 * way to talk about it.
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

  const w = REPLAY_WINDOWS;
  // Phase 1 opens on the dark stage and raises the wall still behind the figure,
  // then ignites the starfield on it.
  const arrive = ramp(progress, ...w.still.in);
  const ignite = ramp(progress, ...w.starfield.in);
  // Phase 2 takes the still back down to black and swaps the ambient wall field
  // for the matched subset of it.
  const recede = ramp(progress, ...w.still.out);
  const swap = ramp(progress, ...w.starfield.out);
  // Phase 3 carries everything into Route Photo space; the photo itself follows.
  const migrate = ramp(progress, ...w.morph);
  // Phase 4 retires the scaffolding so the Route Overlay stands alone.
  const settle = ramp(progress, ...w.match.out);

  return {
    progress,
    clipSeconds: progress * captureSeconds,
    phase,
    frameAlpha: arrive * (1 - recede),
    starfieldAlpha: ignite * (1 - swap),
    matchAlpha: swap * (1 - settle),
    photoAlpha: easeIn(ramp(progress, ...w.photo)),
    // The wake belongs to the x-ray beat: it arrives with the black and clears as
    // the figure lands on the wall, so the frames at either end — the real video
    // still and the finished Route Overlay — are free of it.
    trailAlpha: ramp(progress, ...w.wake.in) * (1 - ramp(progress, ...w.wake.out)),
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
