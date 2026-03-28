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
import { buildTransformedKeypoints } from "@/pipeline/skeletonOverlay";

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
  /** Output frame rate. Default 30. */
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
  targetFps = 30,
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
  let cursor = 0;

  for (let i = 0; i < total; i++) {
    const t = firstTs + i / targetFps;

    while (
      cursor < sorted.length - 1 &&
      Math.abs(sorted[cursor + 1].timestamp - t) <=
        Math.abs(sorted[cursor].timestamp - t)
    ) {
      cursor++;
    }

    const frame = sorted[cursor];
    const keypoints =
      frame.keypoints.length > 0
        ? buildTransformedKeypoints(frame, h, videoMeta.width, videoMeta.height)
        : {};

    out.push({ timestamp: t - firstTs, keypoints });
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
  /** Output frame rate. Default 30. */
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
  targetFps = 30,
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

  for (let i = 0; i < total; i++) {
    const t = firstTs + i / targetFps;

    for (let li = 0; li < layers.length; li++) {
      const sf = sortedPerLayer[li];
      if (sf.length === 0) {
        layerFrames[li].push({ timestamp: t - firstTs, keypoints: {} });
        continue;
      }

      while (
        cursors[li] < sf.length - 1 &&
        Math.abs(sf[cursors[li] + 1].timestamp - t) <=
          Math.abs(sf[cursors[li]].timestamp - t)
      ) {
        cursors[li]++;
      }

      const frame = sf[cursors[li]];
      const keypoints =
        frame.keypoints.length > 0
          ? buildTransformedKeypoints(
              frame,
              homographies[li],
              layers[li].videoMeta.width,
              layers[li].videoMeta.height,
            )
          : {};

      layerFrames[li].push({ timestamp: t - firstTs, keypoints });
    }
  }

  return {
    layers: layerFrames.map((frames) => ({ frames })),
    duration,
    fps: targetFps,
  };
}
