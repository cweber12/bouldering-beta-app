/**
 * Multi-layer pose video renderer.
 *
 * Renders an annotated WebM video where multiple pose-skeleton overlays are
 * drawn simultaneously on the same reference image. Each "layer" provides its
 * own pose frames, ORB match data, and skeleton style.
 *
 * Timeline spans from the earliest first-frame timestamp to the latest
 * last-frame timestamp across all layers. Layers that have not yet started or
 * have already ended at a given output time contribute no skeleton for that
 * segment; the background image is still drawn.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

import type { PoseFrame } from "@/pipeline/poseDetection";
import type { VideoMeta, OrbFeatures, OrbMatch } from "@/storage/sessionStore";
import { computeHomography } from "@/pipeline/homography";
import {
  buildTransformedKeypoints,
  drawSkeleton,
  type SkeletonStyle,
} from "@/pipeline/skeletonOverlay";

export type { SkeletonStyle };

export interface MultiPoseLayer {
  frames: PoseFrame[];
  videoMeta: VideoMeta;
  /** ORB features from the reference video frame. */
  orbFeatures: OrbFeatures;
  /** ORB features from the uploaded route image. */
  queryOrb: OrbFeatures;
  matches: OrbMatch[];
  /** Visual style for this layer's skeleton overlay. */
  skeletonStyle?: SkeletonStyle;
}

export interface MultiPoseVideoParams {
  cv: CV;
  imageFile: File;
  /** One entry per attempt to overlay. Must be non-empty. */
  layers: MultiPoseLayer[];
  /**
   * Target output frame rate of the WebM video. Defaults to 15 fps.
   */
  targetFps?: number;
  /**
   * Called after each output frame is drawn.
   * `framesRendered` is 1-based; `totalFrames` is the full count.
   */
  onProgress?: (framesRendered: number, totalFrames: number) => void;
}

/** Preferred MIME types; first supported one wins. */
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
 * Render a composite annotated video with all layers drawn simultaneously.
 *
 * Each layer's homography is pre-computed before the MediaRecorder is opened,
 * so an insufficient-matches error is thrown immediately rather than mid-render.
 *
 * The caller is responsible for calling `URL.revokeObjectURL()` on the
 * returned URL when the video element is no longer needed.
 *
 * @throws If MediaRecorder is unavailable, `layers` is empty, any layer has
 *         fewer than 4 matches (homography requires ≥ 4), or a canvas context
 *         cannot be obtained.
 */
export async function renderMultiPoseVideo({
  cv,
  imageFile,
  layers,
  targetFps = 15,
  onProgress,
}: MultiPoseVideoParams): Promise<string> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not supported in this browser.");
  }
  if (layers.length === 0) {
    throw new Error("renderMultiPoseVideo: at least one layer is required.");
  }

  // Pre-compute homographies — fail fast before touching MediaRecorder.
  const homographies = layers.map((layer, i) => {
    const h = computeHomography(cv, layer.matches, layer.orbFeatures, layer.queryOrb);
    if (!h) {
      throw new Error(
        `Layer ${i}: not enough matches to compute homography — need ≥ 4, got ${layer.matches.length}.`,
      );
    }
    return h;
  });

  // Sort each layer's frames chronologically once.
  const sortedLayerFrames = layers.map((l) =>
    [...l.frames].sort((a, b) => a.timestamp - b.timestamp),
  );

  // Derive unified timeline: earliest first-ts across all layers to latest last-ts.
  const allFirstTs = sortedLayerFrames.map((sf) =>
    sf.length > 0 ? sf[0].timestamp : Infinity,
  );
  const allLastTs = sortedLayerFrames.map((sf) =>
    sf.length > 0 ? sf[sf.length - 1].timestamp : -Infinity,
  );
  const firstTs = Math.min(...allFirstTs);
  const lastTs = Math.max(...allLastTs);

  const fps = targetFps;
  const duration = Math.max(lastTs - firstTs, 1 / fps);
  const totalOutputFrames = Math.ceil(duration * fps) + 1;

  const imageBitmap = await createImageBitmap(imageFile);

  const canvas = document.createElement("canvas");
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    imageBitmap.close();
    throw new Error("Could not acquire 2D canvas context for video rendering.");
  }

  const frameDelay = Math.round(1000 / fps);
  const stream = canvas.captureStream(fps);
  const mimeType = chooseMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // Per-layer two-pointer cursors for O(n) frame lookup across the timeline.
  const cursors = Array.from({ length: layers.length }, () => 0);

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
      for (let i = 0; i < totalOutputFrames; i++) {
        const t = firstTs + i / fps;

        // Draw background image once per output frame.
        ctx.drawImage(imageBitmap, 0, 0);

        // Draw each layer's nearest-frame skeleton.
        for (let li = 0; li < layers.length; li++) {
          const sf = sortedLayerFrames[li];
          if (sf.length === 0) continue;

          // Advance two-pointer to the nearest frame at time t.
          while (
            cursors[li] < sf.length - 1 &&
            Math.abs(sf[cursors[li] + 1].timestamp - t) <=
              Math.abs(sf[cursors[li]].timestamp - t)
          ) {
            cursors[li]++;
          }

          const frame = sf[cursors[li]];
          if (frame.keypoints.length === 0) continue;

          const kp = buildTransformedKeypoints(
            frame,
            homographies[li],
            layers[li].videoMeta.width,
            layers[li].videoMeta.height,
          );
          drawSkeleton(ctx, kp, layers[li].skeletonStyle);
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
