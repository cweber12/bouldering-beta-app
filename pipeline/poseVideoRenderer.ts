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
import { computeHomography } from "@/pipeline/homography";
import { buildTransformedKeypoints, drawSkeleton, type SkeletonStyle } from "@/pipeline/skeletonOverlay";

export type { SkeletonStyle };

export interface PoseVideoParams {
  cv: CV;
  imageFile: File;
  frames: PoseFrame[];
  videoMeta: VideoMeta;
  /** ORB features from the reference video frame. */
  orbFeatures: OrbFeatures;
  /** ORB features from the uploaded route image. */
  queryOrb: OrbFeatures;
  matches: OrbMatch[];
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
}: PoseVideoParams): Promise<string> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not supported in this browser.");
  }

  const h = computeHomography(cv, matches, orbFeatures, queryOrb);
  if (!h) {
    throw new Error(
      `Not enough matches to compute homography — need ≥ 4, got ${matches.length}.`,
    );
  }

  const imageBitmap = await createImageBitmap(imageFile);

  const canvas = document.createElement("canvas");
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;

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
      // Two-pointer: advance cursor as output timestamps increase.
      let cursor = 0;
      for (let i = 0; i < totalOutputFrames; i++) {
        const t = firstTs + (i / fps);
        while (cursor < sortedFrames.length - 1 &&
               Math.abs(sortedFrames[cursor + 1].timestamp - t) <= Math.abs(sortedFrames[cursor].timestamp - t)) {
          cursor++;
        }
        const frame = sortedFrames[cursor];
        ctx.drawImage(imageBitmap, 0, 0);

        if (frame.keypoints.length > 0) {
          const kp = buildTransformedKeypoints(
            frame,
            h,
            videoMeta.width,
            videoMeta.height,
          );
          drawSkeleton(ctx, kp, skeletonStyle);
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
