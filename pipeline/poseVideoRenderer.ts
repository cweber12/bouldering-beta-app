/**
 * Pose video renderer.
 *
 * Renders annotated pose skeleton frames as a WebM video by:
 *  1. Computing a homography H from matched ORB keypoints (reference frame →
 *     uploaded route image).
 *  2. For each PoseFrame (chronological order):
 *     a. Drawing the route image onto an offscreen canvas.
 *     b. Transforming each keypoint through H.
 *     c. Drawing the MoveNet skeleton overlay.
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
import { buildTransformedKeypoints, drawSkeleton } from "@/pipeline/skeletonOverlay";

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
   * Milliseconds between sampled video frames.
   * Controls both playback speed and the MediaRecorder frame rate.
   * Defaults to 100 ms (10 fps).
   */
  frameIntervalMs?: number;
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
  frameIntervalMs = 100,
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

  const fps = Math.max(1, Math.round(1000 / frameIntervalMs));
  const frameDelay = Math.round(1000 / fps);
  const stream = canvas.captureStream(fps);
  const mimeType = chooseMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const sortedFrames = [...frames].sort((a, b) => a.timestamp - b.timestamp);

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
      for (const frame of sortedFrames) {
        ctx.drawImage(imageBitmap, 0, 0);

        if (frame.keypoints.length > 0) {
          const kp = buildTransformedKeypoints(
            frame,
            h,
            videoMeta.width,
            videoMeta.height,
          );
          drawSkeleton(ctx, kp);
        }

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
