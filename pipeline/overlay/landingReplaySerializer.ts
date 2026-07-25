/**
 * Serializer: authored clip inputs → one {@link LandingReplayItem}.
 *
 * This is the whole "export" step of the curation route. It is pure data
 * projection — the caller has already done the expensive work (ORB match,
 * gated homography, Hold projection) and hands in the results; this module
 * windows them to the clip, normalizes every coordinate to `[0,1]`, rebases
 * every timestamp to clip-relative seconds, and drops everything else.
 *
 * Private-field exclusion is **by construction**: the parameter object names
 * every field that can reach the export, so user identity, notes, coordinates,
 * S3 keys, ORB descriptors and the homography matrix have no path into the
 * output. Nothing here filters a wider object down.
 *
 * This module is framework-agnostic — no React imports, no OpenCV, no async.
 * Keep it that way.
 */

import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import type { OrbFeatures, OrbKeypoint, OrbMatch } from "@/pipeline/matching/orbDetector";
import { MP_KP_NAMES } from "@/utils/poseConstants";
import {
  LANDING_REPLAY_VERSION,
  REPLAY_CAPTURE_SECONDS,
  REPLAY_COORD_DECIMALS,
  REPLAY_POSE_INTERVAL_SECONDS,
  REPLAY_STARFIELD_MAX,
  type LandingReplayFile,
  type LandingReplayItem,
  type ReplayDims,
  type ReplayHold,
  type ReplayKeypoint,
  type ReplayLabel,
  type ReplayMatch,
  type ReplayPhoto,
  type ReplayPoint,
  type ReplayPose,
  type ReplaySource,
} from "@/pipeline/overlay/landingReplayItem";

/** A Hold as the authoring route holds it: photo pixels, absolute video time. */
export interface AuthoredHold {
  /** Route Photo pixel x. */
  x: number;
  /** Route Photo pixel y. */
  y: number;
  kind: "hand" | "foot";
  side: "left" | "right";
  /** Absolute video seconds the Climber first used this Hold. */
  firstUseTime: number;
}

export interface BuildLandingReplayItemParams {
  /** Stable clip id (e.g. `run-1750000000-boulder-problem`). */
  id: string;
  label: ReplayLabel;
  /**
   * Source video pixel dimensions — the space ORB and pose coordinates live in —
   * plus, optionally, a WebP still of the wall taken from that same video. The
   * still is what the hero opens on, so the figure starts on the real wall.
   */
  source: ReplaySource;
  /** The embedded WebP and its pixel dimensions — what the hero actually draws. */
  photo: ReplayPhoto;
  /**
   * The pixel space `queryFeatures` and `project` output live in: the Route
   * Photo at match resolution, which is larger than the compressed WebP. Photo
   * coordinates normalize against this. Both spaces share an aspect ratio, so
   * the normalized values are the same either way — passing it explicitly just
   * keeps the export honest about which pixels it measured. Defaults to
   * {@link BuildLandingReplayItemParams.photo}.
   */
  photoSpace?: ReplayDims;
  /** Reference-frame ORB features — the starfield and the source half of each match. */
  refFeatures: OrbFeatures;
  /** Route Photo ORB features — the photo half of each match. */
  queryFeatures: OrbFeatures;
  /** Matches that passed the Lowe ratio test, as returned by the matcher. */
  matches: OrbMatch[];
  /** Every pose frame of the Run; only those inside the window are exported. */
  frames: PoseFrame[];
  /** Clip window start, in absolute video seconds. */
  windowStart: number;
  /** Clip window length. Defaults to {@link REPLAY_CAPTURE_SECONDS}. */
  windowSeconds?: number;
  /**
   * Minimum spacing between exported poses, in seconds. Defaults to
   * {@link REPLAY_POSE_INTERVAL_SECONDS}; pass 0 to export every stored frame.
   */
  poseIntervalSeconds?: number;
  /**
   * How many wall features reach the exported starfield, strongest ORB response
   * first. Defaults to {@link REPLAY_STARFIELD_MAX}; pass `Infinity` to export
   * every extracted keypoint.
   */
  starfieldMax?: number;
  /**
   * Projects a **source video pixel** point into Route Photo pixel space —
   * built by the caller from the matcher's gated homography, so the matrix
   * itself never reaches this module (nor the export).
   */
  project: (x: number, y: number) => { x: number; y: number };
  /** Holds already projected into Route Photo pixel space, times absolute. */
  holds: readonly AuthoredHold[];
}

/** Digits every coordinate is rounded to — see {@link REPLAY_COORD_DECIMALS}. */
const COORD_SCALE = 10 ** REPLAY_COORD_DECIMALS;

/** Round a normalized coordinate — the single biggest lever on a checked-in clip. */
function rc(v: number): number {
  return Math.round(v * COORD_SCALE) / COORD_SCALE;
}

/** Round a clip-relative time to 3 dp (millisecond resolution). */
function rt(v: number): number {
  return Math.round(v * 1e3) / 1e3;
}

/** Round a confidence score to 2 dp — it only drives Estimated-Landmark dimming. */
function r2(v: number): number {
  return Math.round(v * 1e2) / 1e2;
}

/** Landmark name → BlazePose index, for the export's positional encoding. */
const KP_INDEX_BY_NAME = new Map<string, number>(
  Object.entries(MP_KP_NAMES).map(([index, name]) => [name, Number(index)]),
);

/**
 * Thin `frames` to at most one sample every `interval` seconds.
 *
 * The renderer samples poses by time and interpolates, and the stored track was
 * itself bone-space interpolated up from 2 Hz detections, so this drops bytes
 * rather than motion. The first and last frames of the window are always kept, so
 * the clip still opens and closes on real detections.
 */
function decimate(frames: PoseFrame[], interval: number): PoseFrame[] {
  if (interval <= 0 || frames.length <= 2) return frames;
  const kept: PoseFrame[] = [];
  let last = -Infinity;
  for (const frame of frames) {
    if (frame.timestamp - last >= interval - 1e-9) {
      kept.push(frame);
      last = frame.timestamp;
    }
  }
  const final = frames[frames.length - 1];
  if (kept[kept.length - 1] !== final) kept.push(final);
  return kept;
}

/**
 * The `limit` strongest keypoints, back in extraction order.
 *
 * Selection is by `response` — the corner strength ORB scored each keypoint with —
 * so a thinned starfield is a weaker version of the *whole* wall rather than a
 * complete version of one corner of it, which is what slicing the first N would
 * ship. Ties break on the original index so the choice is deterministic, and the
 * survivors are re-ordered back to extraction order: nothing downstream reads the
 * array in order, and keeping it stable keeps the diff on a re-export readable.
 */
function strongestKeypoints(keypoints: readonly OrbKeypoint[], limit: number): OrbKeypoint[] {
  if (keypoints.length <= limit) return [...keypoints];
  return keypoints
    .map((kp, index) => ({ kp, index }))
    .sort((a, b) => b.kp.response - a.kp.response || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.kp);
}

/** Guard against a zero/absent dimension turning every coordinate into NaN. */
function safeDim(v: number): number {
  return v > 0 ? v : 1;
}

/**
 * Project the clip inputs into the v1 item contract.
 *
 * Windowing rules:
 * - Poses are those with `windowStart ≤ timestamp ≤ windowStart + windowSeconds`,
 *   re-timed so the first frame of the window sits at `t = 0`.
 * - Holds first used at or before the window's end are kept; one already in use
 *   when the window opens reveals at `t = 0` rather than at a negative time.
 *
 * Payload rules, because this file is checked into the repo and fetched before
 * the hero draws anything:
 * - The starfield keeps the strongest {@link REPLAY_STARFIELD_MAX} responses.
 * - Every coordinate is rounded to {@link REPLAY_COORD_DECIMALS}; times are not.
 */
export function buildLandingReplayItem(params: BuildLandingReplayItemParams): LandingReplayItem {
  const {
    id,
    label,
    source,
    photo,
    photoSpace,
    refFeatures,
    queryFeatures,
    matches,
    frames,
    windowStart,
    windowSeconds = REPLAY_CAPTURE_SECONDS,
    poseIntervalSeconds = REPLAY_POSE_INTERVAL_SECONDS,
    starfieldMax = REPLAY_STARFIELD_MAX,
    project,
    holds,
  } = params;

  const sw = safeDim(source.w);
  const sh = safeDim(source.h);
  const pw = safeDim(photoSpace?.w ?? photo.w);
  const ph = safeDim(photoSpace?.h ?? photo.h);
  const windowEnd = windowStart + windowSeconds;

  const starfield: ReplayPoint[] = strongestKeypoints(refFeatures.keypoints, starfieldMax).map(
    (kp) => ({
      x: rc(kp.pt.x / sw),
      y: rc(kp.pt.y / sh),
    }),
  );

  // `queryIdx` indexes the reference (source) keypoints and `trainIdx` the query
  // (photo) keypoints — the same convention computeHomography reads them by.
  const pairedMatches: ReplayMatch[] = [];
  for (const m of matches) {
    const ref = refFeatures.keypoints[m.queryIdx];
    const qry = queryFeatures.keypoints[m.trainIdx];
    if (!ref || !qry) continue;
    pairedMatches.push({
      sx: rc(ref.pt.x / sw),
      sy: rc(ref.pt.y / sh),
      px: rc(qry.pt.x / pw),
      py: rc(qry.pt.y / ph),
    });
  }

  const windowed = decimate(
    frames
      .filter((f) => f.timestamp >= windowStart && f.timestamp <= windowEnd)
      .sort((a, b) => a.timestamp - b.timestamp),
    poseIntervalSeconds,
  );

  const poses: ReplayPose[] = windowed.map((frame) => {
    const sourceKp: ReplayKeypoint[] = [];
    const photoKp: ReplayKeypoint[] = [];
    for (const kp of frame.keypoints) {
      // A landmark the topology does not name has no index to encode, and the
      // renderer could not draw it either — drop it rather than ship an orphan.
      const index = KP_INDEX_BY_NAME.get(kp.name);
      if (index === undefined) continue;
      const score = r2(kp.score);
      sourceKp.push([index, rc(kp.x), rc(kp.y), score]);
      const projected = project(kp.x * sw, kp.y * sh);
      photoKp.push([index, rc(projected.x / pw), rc(projected.y / ph), score]);
    }
    return { t: rt(frame.timestamp - windowStart), source: sourceKp, photo: photoKp };
  });

  const replayHolds: ReplayHold[] = holds
    .filter((h) => h.firstUseTime <= windowEnd)
    .map((h) => ({
      x: rc(h.x / pw),
      y: rc(h.y / ph),
      kind: h.kind,
      side: h.side,
      t: rt(Math.max(0, h.firstUseTime - windowStart)),
    }))
    .sort((a, b) => a.t - b.t);

  return {
    id,
    label: { area: label.area, route: label.route, rating: label.rating },
    duration: rt(windowSeconds),
    source: source.webp
      ? { w: source.w, h: source.h, webp: source.webp }
      : { w: source.w, h: source.h },
    photo: { w: photo.w, h: photo.h, webp: photo.webp },
    starfield,
    matches: pairedMatches,
    poses,
    holds: replayHolds,
  };
}

/** Wrap items in the versioned playlist envelope. Items play in array order. */
export function buildLandingReplayFile(items: LandingReplayItem[]): LandingReplayFile {
  return { version: LANDING_REPLAY_VERSION, items };
}
