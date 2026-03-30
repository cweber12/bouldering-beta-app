/**
 * Pre-computes skeleton overlay data for frame-by-frame canvas playback.
 *
 * Transforms pose keypoints through a homography matrix for each output
 * timestamp, producing ready-to-draw keypoint maps. No canvas allocation,
 * bitmap creation, or MediaRecorder involved — pure computation.
 *
 * Typical execution time: < 1 ms for 30 seconds of 30 fps output.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

import type { PoseFrame } from "@/pipeline/poseDetection";
import type { VideoMeta, OrbFeatures, OrbMatch } from "@/storage/sessionStore";
import { computeHomography } from "@/pipeline/homography";
import { buildTransformedKeypoints, lerpKeypoints } from "@/pipeline/skeletonOverlay";

/** Single output frame with pre-transformed keypoints in image-pixel space. */
export interface RenderedSkeletonFrame {
  /** Seconds relative to the start of the animation (0-based). */
  timestamp: number;
  /** Keypoint name → {x, y} in image pixels. Empty object for blank frames. */
  keypoints: Record<string, { x: number; y: number }>;
}

/** Single-layer skeleton data ready for FramePlayer. */
export interface SkeletonFrameData {
  frames: RenderedSkeletonFrame[];
  /** Total duration in seconds. */
  duration: number;
  /** Frames per second used when generating output timestamps. */
  fps: number;
}

/** Multi-layer skeleton data ready for FramePlayer. */
export interface MultiSkeletonFrameData {
  /** One entry per input layer, each containing its own frame array. */
  layers: Array<{ frames: RenderedSkeletonFrame[] }>;
  /** Total duration in seconds (union of all layer timelines). */
  duration: number;
  fps: number;
}

// ---------------------------------------------------------------------------
// Single-layer builder
// ---------------------------------------------------------------------------

export interface BuildSkeletonFramesParams {
  cv: CV;
  frames: PoseFrame[];
  videoMeta: VideoMeta;
  orbFeatures: OrbFeatures;
  queryOrb: OrbFeatures;
  matches: OrbMatch[];
  /** Output frame rate. Default 60. */
  targetFps?: number;
}

/**
 * Pre-compute transformed skeleton keypoints for every output timestamp.
 *
 * @throws When fewer than 4 matches are available for homography computation.
 */
export function buildSkeletonFrames({
  cv,
  frames,
  videoMeta,
  orbFeatures,
  queryOrb,
  matches,
  targetFps = 60,
}: BuildSkeletonFramesParams): SkeletonFrameData {
  const h = computeHomography(cv, matches, orbFeatures, queryOrb);
  if (!h) {
    throw new Error(
      `Not enough matches to compute homography — need ≥ 4, got ${matches.length}.`,
    );
  }

  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
  const firstTs = sorted.length > 0 ? sorted[0].timestamp : 0;
  const lastTs = sorted.length > 0 ? sorted[sorted.length - 1].timestamp : 0;
  const duration = Math.max(lastTs - firstTs, 1 / targetFps);
  const total = Math.ceil(duration * targetFps) + 1;

  const out: RenderedSkeletonFrame[] = [];

  // Floor cursor: index of the last sorted frame with timestamp ≤ t.
  let floorIdx = 0;
  // Cache transformed keypoints so each input frame is transformed at most once.
  let cachedFloorKp: Record<string, { x: number; y: number }> | null = null;
  let cachedFloorAt = -1;
  let cachedCeilKp: Record<string, { x: number; y: number }> | null = null;
  let cachedCeilAt = -1;

  for (let i = 0; i < total; i++) {
    const t = firstTs + i / targetFps;

    // Advance floor to the last frame whose timestamp ≤ t.
    while (floorIdx < sorted.length - 1 && sorted[floorIdx + 1].timestamp <= t) {
      floorIdx++;
    }

    // Compute / reuse transformed keypoints for floor frame.
    if (cachedFloorAt !== floorIdx) {
      cachedFloorKp = sorted[floorIdx].keypoints.length > 0
        ? buildTransformedKeypoints(sorted[floorIdx], h, videoMeta.width, videoMeta.height)
        : null;
      cachedFloorAt = floorIdx;
    }

    if (!cachedFloorKp) {
      out.push({ timestamp: t - firstTs, keypoints: {} });
      continue;
    }

    const ceilIdx = Math.min(floorIdx + 1, sorted.length - 1);

    // Compute / reuse transformed keypoints for ceil frame.
    if (cachedCeilAt !== ceilIdx) {
      cachedCeilKp = ceilIdx !== floorIdx && sorted[ceilIdx].keypoints.length > 0
        ? buildTransformedKeypoints(sorted[ceilIdx], h, videoMeta.width, videoMeta.height)
        : null;
      cachedCeilAt = ceilIdx;
    }

    if (!cachedCeilKp || ceilIdx === floorIdx) {
      out.push({ timestamp: t - firstTs, keypoints: cachedFloorKp });
      continue;
    }

    const dt = sorted[ceilIdx].timestamp - sorted[floorIdx].timestamp;
    const alpha = dt > 0 ? (t - sorted[floorIdx].timestamp) / dt : 0;
    out.push({ timestamp: t - firstTs, keypoints: lerpKeypoints(cachedFloorKp, cachedCeilKp, alpha) });
  }

  return { frames: out, duration, fps: targetFps };
}

// ---------------------------------------------------------------------------
// Multi-layer builder
// ---------------------------------------------------------------------------

export interface MultiSkeletonLayerInput {
  frames: PoseFrame[];
  videoMeta: VideoMeta;
  orbFeatures: OrbFeatures;
  queryOrb: OrbFeatures;
  matches: OrbMatch[];
}

export interface BuildMultiSkeletonFramesParams {
  cv: CV;
  layers: MultiSkeletonLayerInput[];
  /** Output frame rate. Default 60. */
  targetFps?: number;
}

/**
 * Pre-compute transformed skeleton keypoints for multiple layers on a unified
 * timeline spanning from the earliest to latest timestamp across all layers.
 *
 * @throws When any layer has fewer than 4 matches, or when layers is empty.
 */
export function buildMultiSkeletonFrames({
  cv,
  layers,
  targetFps = 60,
}: BuildMultiSkeletonFramesParams): MultiSkeletonFrameData {
  if (layers.length === 0) {
    throw new Error("buildMultiSkeletonFrames: at least one layer is required.");
  }

  // Compute homographies — fail fast.
  const homographies = layers.map((layer, i) => {
    const h = computeHomography(cv, layer.matches, layer.orbFeatures, layer.queryOrb);
    if (!h) {
      throw new Error(
        `Layer ${i}: not enough matches to compute homography — need ≥ 4, got ${layer.matches.length}.`,
      );
    }
    return h;
  });

  const sortedPerLayer = layers.map((l) =>
    [...l.frames].sort((a, b) => a.timestamp - b.timestamp),
  );

  const firstTs = Math.min(
    ...sortedPerLayer.map((sf) => (sf.length > 0 ? sf[0].timestamp : Infinity)),
  );
  const lastTs = Math.max(
    ...sortedPerLayer.map((sf) =>
      sf.length > 0 ? sf[sf.length - 1].timestamp : -Infinity,
    ),
  );
  const duration = Math.max(lastTs - firstTs, 1 / targetFps);
  const total = Math.ceil(duration * targetFps) + 1;

  const cursors = Array.from({ length: layers.length }, () => 0);
  const layerFrames: RenderedSkeletonFrame[][] = layers.map(() => []);

  // Per-layer caches so each input frame is transformed at most once.
  const cachedFloorKp: (Record<string, { x: number; y: number }> | null)[] =
    layers.map(() => null);
  const cachedFloorAt: number[] = layers.map(() => -1);
  const cachedCeilKp: (Record<string, { x: number; y: number }> | null)[] =
    layers.map(() => null);
  const cachedCeilAt: number[] = layers.map(() => -1);

  for (let i = 0; i < total; i++) {
    const t = firstTs + i / targetFps;

    for (let li = 0; li < layers.length; li++) {
      const sf = sortedPerLayer[li];
      if (sf.length === 0) {
        layerFrames[li].push({ timestamp: t - firstTs, keypoints: {} });
        continue;
      }

      // Advance floor cursor to the last frame with timestamp ≤ t.
      while (
        cursors[li] < sf.length - 1 &&
        sf[cursors[li] + 1].timestamp <= t
      ) {
        cursors[li]++;
      }

      const fi = cursors[li];

      // Compute / reuse transformed keypoints for floor frame.
      if (cachedFloorAt[li] !== fi) {
        cachedFloorKp[li] = sf[fi].keypoints.length > 0
          ? buildTransformedKeypoints(sf[fi], homographies[li], layers[li].videoMeta.width, layers[li].videoMeta.height)
          : null;
        cachedFloorAt[li] = fi;
      }

      if (!cachedFloorKp[li]) {
        layerFrames[li].push({ timestamp: t - firstTs, keypoints: {} });
        continue;
      }

      const ci = Math.min(fi + 1, sf.length - 1);

      if (cachedCeilAt[li] !== ci) {
        cachedCeilKp[li] = ci !== fi && sf[ci].keypoints.length > 0
          ? buildTransformedKeypoints(sf[ci], homographies[li], layers[li].videoMeta.width, layers[li].videoMeta.height)
          : null;
        cachedCeilAt[li] = ci;
      }

      if (!cachedCeilKp[li] || ci === fi) {
        layerFrames[li].push({ timestamp: t - firstTs, keypoints: cachedFloorKp[li]! });
        continue;
      }

      const dt = sf[ci].timestamp - sf[fi].timestamp;
      const alpha = dt > 0 ? (t - sf[fi].timestamp) / dt : 0;
      layerFrames[li].push({
        timestamp: t - firstTs,
        keypoints: lerpKeypoints(cachedFloorKp[li]!, cachedCeilKp[li]!, alpha),
      });
    }
  }

  return {
    layers: layerFrames.map((frames) => ({ frames })),
    duration,
    fps: targetFps,
  };
}
