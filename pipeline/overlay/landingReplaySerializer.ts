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
import type { OrbFeatures, OrbMatch } from "@/pipeline/matching/orbDetector";
import { MP_KP_NAMES } from "@/utils/poseConstants";
import {
  LANDING_REPLAY_VERSION,
  REPLAY_CAPTURE_SECONDS,
  REPLAY_POSE_INTERVAL_SECONDS,
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
  /** Source video pixel dimensions — the space ORB and pose coordinates live in. */
  source: ReplayDims;
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
   * Projects a **source video pixel** point into Route Photo pixel space —
   * built by the caller from the matcher's gated homography, so the matrix
   * itself never reaches this module (nor the export).
   */
  project: (x: number, y: number) => { x: number; y: number };
  /** Holds already projected into Route Photo pixel space, times absolute. */
  holds: readonly AuthoredHold[];
}

/** Round a normalized coordinate to 4 dp — keeps the checked-in JSON small. */
function r4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/** Round a clip-relative time to 3 dp (millisecond resolution). */
function r3(v: number): number {
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
    project,
    holds,
  } = params;

  const sw = safeDim(source.w);
  const sh = safeDim(source.h);
  const pw = safeDim(photoSpace?.w ?? photo.w);
  const ph = safeDim(photoSpace?.h ?? photo.h);
  const windowEnd = windowStart + windowSeconds;

  const starfield: ReplayPoint[] = refFeatures.keypoints.map((kp) => ({
    x: r4(kp.pt.x / sw),
    y: r4(kp.pt.y / sh),
  }));

  // `queryIdx` indexes the reference (source) keypoints and `trainIdx` the query
  // (photo) keypoints — the same convention computeHomography reads them by.
  const pairedMatches: ReplayMatch[] = [];
  for (const m of matches) {
    const ref = refFeatures.keypoints[m.queryIdx];
    const qry = queryFeatures.keypoints[m.trainIdx];
    if (!ref || !qry) continue;
    pairedMatches.push({
      sx: r4(ref.pt.x / sw),
      sy: r4(ref.pt.y / sh),
      px: r4(qry.pt.x / pw),
      py: r4(qry.pt.y / ph),
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
      sourceKp.push([index, r4(kp.x), r4(kp.y), score]);
      const projected = project(kp.x * sw, kp.y * sh);
      photoKp.push([index, r4(projected.x / pw), r4(projected.y / ph), score]);
    }
    return { t: r3(frame.timestamp - windowStart), source: sourceKp, photo: photoKp };
  });

  const replayHolds: ReplayHold[] = holds
    .filter((h) => h.firstUseTime <= windowEnd)
    .map((h) => ({
      x: r4(h.x / pw),
      y: r4(h.y / ph),
      kind: h.kind,
      side: h.side,
      t: r3(Math.max(0, h.firstUseTime - windowStart)),
    }))
    .sort((a, b) => a.t - b.t);

  return {
    id,
    label: { area: label.area, route: label.route, rating: label.rating },
    duration: r3(windowSeconds),
    source: { w: source.w, h: source.h },
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
