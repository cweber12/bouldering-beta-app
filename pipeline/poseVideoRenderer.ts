/**
 * Pose video renderer.
 *
 * Renders annotated pose skeleton frames as a WebM video by:
 *  1. Computing a homography H from matched ORB keypoints (reference frame →
 *     uploaded route image).
 *  2. For each PoseFrame (chronological order):
 *     a. Drawing the route image onto an offscreen canvas.
 *     b. Transforming each keypoint through H.
 *     c. Drawing the skeleton overlay.
 *  3. Capturing the canvas via MediaRecorder and returning the resulting
 *     object URL pointing to a WebM blob.
 *
 * Throws on insufficient matches, missing MediaRecorder support, or canvas
 * context failures. Handles missing-keypoint frames gracefully (image drawn,
 * no overlay).
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

import type { PoseFrame } from "@/pipeline/poseDetection";
import type { VideoMeta, OrbFeatures, OrbMatch } from "@/storage/sessionStore";
import { computeHomography, ransacReprojThresholdFor, type KeyframeHomography } from "@/pipeline/homography";
import { capToPixelBudget } from "@/utils/imageHelpers";
import { buildTransformedKeypoints, drawSkeleton, lerpKeypoints, type SkeletonStyle } from "@/pipeline/skeletonOverlay";
import { buildPanningSkeletonFrames } from "@/pipeline/skeletonRenderer";

export type { SkeletonStyle };

export interface PoseVideoParams {
  cv: CV;
  imageFile: File;
  frames: PoseFrame[];
  videoMeta: VideoMeta;
  /** ORB features from the reference video frame. Unused (and optional) in Panning Capture. */
  orbFeatures?: OrbFeatures | null;
  /** ORB features from the uploaded route image. */
  queryOrb: OrbFeatures;
  matches: OrbMatch[];
  /**
   * Panning Capture only: per-keyframe homographies (reference video-frame →
   * photo), ascending by timestamp. When present and non-empty, the overlay is
   * projected through the time-interpolated keyframe homography per frame and
   * `orbFeatures`/`queryOrb`/`matches` are not used for transform computation.
   */
  keyframeHomographies?: KeyframeHomography[];
  /**
   * Milliseconds between sampled video frames (the original sampling interval).
   * Used to compute the original sampling rate for informational purposes.
   * Defaults to 100 ms (10 fps sampling).
   */
  frameIntervalMs?: number;
  /**
   * Target output frame rate of the WebM video. Defaults to 60 fps.
   * Each output frame is filled with the nearest pose frame by timestamp,
   * so smoother values produce proportionally more output frames.
   * Common values: 24, 25, 30 (standard video), 60.
   */
  targetFps?: number;
  /**
   * Called after each frame is drawn.
   * `framesRendered` is 1-based; `totalFrames` is the full count.
   */
  onProgress?: (framesRendered: number, totalFrames: number) => void;
  /** Visual style for the skeleton overlay. Falls back to built-in defaults. */
  skeletonStyle?: SkeletonStyle;
}

/** Preferred MIME type order; first supported type wins. */
const CANDIDATE_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

function chooseMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

/**
 * Render all pose frames onto copies of the route image and return an object
 * URL pointing to the resulting video blob.
 *
 * The caller is responsible for calling `URL.revokeObjectURL()` on the
 * returned URL when the video element is no longer needed.
 *
 * @throws If MediaRecorder is unavailable, the homography cannot be computed
 *         (fewer than 4 matches), or a canvas context cannot be obtained.
 */
export async function renderPoseVideo({
  cv,
  imageFile,
  frames,
  videoMeta,
  orbFeatures,
  queryOrb,
  matches,
  frameIntervalMs: _frameIntervalMs = 100,
  targetFps = 60,
  onProgress,
  skeletonStyle,
  keyframeHomographies,
}: PoseVideoParams): Promise<string> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not supported in this browser.");
  }

  const imageBitmap = await createImageBitmap(imageFile);

  // Mirror useImageMatcher's decode-time cap so the canvas the photo is drawn on
  // shares the pixel space the query ORB features (and therefore the homography)
  // were computed in. Without this, a >MAX_DECODE_PIXELS photo would render at
  // full size while the keypoints live in capped space, mis-placing the overlay.
  const { width: canvasW, height: canvasH } = capToPixelBudget(imageBitmap.width, imageBitmap.height);

  const panning = (keyframeHomographies?.length ?? 0) > 0;

  // Fixed Capture: a single frame-0 homography reused for every frame.
  // Panning Capture skips this — it projects through the time-interpolated
  // keyframe homography per frame (pre-computed below).
  let h: Float64Array | null = null;
  if (!panning) {
    if (!orbFeatures) {
      imageBitmap.close();
      throw new Error("Fixed Capture rendering requires reference ORB features.");
    }
    h = computeHomography(cv, matches, orbFeatures, queryOrb, {
      ransacReprojThreshold: ransacReprojThresholdFor(Math.max(canvasW, canvasH)),
      gate: { srcWidth: videoMeta.width, srcHeight: videoMeta.height },
    });
    if (!h) {
      imageBitmap.close();
      throw new Error(
        `Not enough matches to compute homography — need ≥ 4, got ${matches.length}.`,
      );
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    imageBitmap.close();
    throw new Error("Could not acquire 2D canvas context for video rendering.");
  }

  const fps = targetFps;
  const frameDelay = Math.round(1000 / fps);
  const stream = canvas.captureStream(fps);
  const mimeType = chooseMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const sortedFrames = [...frames].sort((a, b) => a.timestamp - b.timestamp);

  // Derive total output duration from start- to end-timestamp of pose data.
  const firstTs = sortedFrames.length > 0 ? sortedFrames[0].timestamp : 0;
  const lastTs  = sortedFrames.length > 0 ? sortedFrames[sortedFrames.length - 1].timestamp : 0;
  const duration = Math.max(lastTs - firstTs, 1 / fps);
  const totalOutputFrames = Math.ceil(duration * fps) + 1;

  // Panning Capture: pre-compute the per-output-frame keypoints (pose blended in
  // normalised space, projected through the time-interpolated keyframe
  // homography). Uses the same fps/duration formula as the loop, so indices align.
  const panningFrames = panning
    ? buildPanningSkeletonFrames({
        frames,
        videoMeta,
        keyframeHomographies: keyframeHomographies!,
        targetFps: fps,
      }).frames
    : null;

  return new Promise<string>((resolve, reject) => {
    recorder.onstop = () => {
      imageBitmap.close();
      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      resolve(URL.createObjectURL(blob));
    };

    recorder.onerror = () => {
      imageBitmap.close();
      reject(new Error("MediaRecorder encountered an error during encoding."));
    };

    recorder.start();

    (async () => {
      // Floor-bracket interpolation: advance cursor to the last frame ≤ t,
      // then lerp between that frame and the next for smooth motion.
      let floorIdx = 0;
      let cachedFloorKp: Record<string, { x: number; y: number }> | null = null;
      let cachedFloorAt = -1;
      let cachedCeilKp: Record<string, { x: number; y: number }> | null = null;
      let cachedCeilAt = -1;

      for (let i = 0; i < totalOutputFrames; i++) {
        const t = firstTs + (i / fps);

        while (floorIdx < sortedFrames.length - 1 && sortedFrames[floorIdx + 1].timestamp <= t) {
          floorIdx++;
        }

        ctx.drawImage(imageBitmap, 0, 0, canvasW, canvasH);

        // Panning Capture: draw the pre-computed time-varying overlay and skip
        // the single-homography caching path entirely.
        if (panningFrames) {
          const kp = panningFrames[i]?.keypoints;
          if (kp && Object.keys(kp).length > 0) drawSkeleton(ctx, kp, skeletonStyle);
          onProgress?.(i + 1, totalOutputFrames);
          await new Promise<void>((r) => setTimeout(r, frameDelay));
          continue;
        }

        // Compute / reuse transformed keypoints for floor frame.
        if (cachedFloorAt !== floorIdx) {
          cachedFloorKp = sortedFrames[floorIdx].keypoints.length > 0
            ? buildTransformedKeypoints(sortedFrames[floorIdx], h!, videoMeta.width, videoMeta.height)
            : null;
          cachedFloorAt = floorIdx;
        }

        if (cachedFloorKp) {
          const ceilIdx = Math.min(floorIdx + 1, sortedFrames.length - 1);

          if (cachedCeilAt !== ceilIdx) {
            cachedCeilKp = ceilIdx !== floorIdx && sortedFrames[ceilIdx].keypoints.length > 0
              ? buildTransformedKeypoints(sortedFrames[ceilIdx], h!, videoMeta.width, videoMeta.height)
              : null;
            cachedCeilAt = ceilIdx;
          }

          if (cachedCeilKp && ceilIdx !== floorIdx) {
            const dt = sortedFrames[ceilIdx].timestamp - sortedFrames[floorIdx].timestamp;
            const alpha = dt > 0 ? (t - sortedFrames[floorIdx].timestamp) / dt : 0;
            drawSkeleton(ctx, lerpKeypoints(cachedFloorKp, cachedCeilKp, alpha), skeletonStyle);
          } else {
            drawSkeleton(ctx, cachedFloorKp, skeletonStyle);
          }
        }

        onProgress?.(i + 1, totalOutputFrames);

        await new Promise<void>((r) => setTimeout(r, frameDelay));
      }

      recorder.stop();
    })().catch((err) => {
      imageBitmap.close();
      try {
        recorder.stop();
      } catch {
        // recorder may already be stopped; ignore
      }
      reject(err);
    });
  });
}
