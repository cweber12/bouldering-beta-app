"use client";

import { useCallback, useRef, useState } from "react";
import { estimateFrame, type PoseFrame } from "@/pipeline/poseDetection";
import { extractFeatures, extractFeaturesFromCrop } from "@/pipeline/orbDetector";
import {
  extractHipCenter,
  mapKeypointsToFullFrame,
  type HipCenter,
} from "@/pipeline/cropDetector";
import { interpolatePoseFrames, smoothPoseFrames } from "@/pipeline/poseInterpolator";
import { saveAttempt, type VideoMeta, type FrameCapture } from "@/storage/sessionStore";
import type { CropFraction } from "@/components/shared/CropBoxOverlay";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export type ClimbingMode = "indoor" | "outdoor";
export type ProcessingStatus = "idle" | "processing" | "done" | "error";
export type OrbStatus = "idle" | "extracting" | "ready" | "failed";

export interface VideoProcessorResult {
  /**
   * Start processing the supplied video File.
   *
   * @param file      - The video to process.
   * @param detector  - Loaded TF.js PoseDetector.
   * @param cv        - Initialised OpenCV runtime.
   * @param mode      - "indoor": pose on every frame.
   *                    "outdoor": pose every `frameStep` frames with hip-crop.
   * @param frameStep - (outdoor only) Pose detection runs every N-th sampled
   *                    frame. Gaps are filled by linear interpolation.
   *                    Default: 5.
   * @param meta      - Optional location metadata (state, area, route).
   * @param cropOptions - Optional user-defined crop boxes.
   *                    `climberCrop`: used for pose detection in outdoor mode;
   *                    the box dimensions are preserved and re-centered on the
   *                    hip each frame. `orbCrop`: used to extract ORB features
   *                    from a sub-region of the first frame only.
   */
  process: (
    file: File,
    detector: PoseDetector,
    cv: CV,
    mode?: ClimbingMode,
    frameStep?: number,
    meta?: { state: string; area: string; route: string },
    cropOptions?: { climberCrop?: CropFraction; orbCrop?: CropFraction },
  ) => Promise<void>;
  status: ProcessingStatus;
  /** Tracks background ORB extraction after the seek loop completes. */
  orbStatus: OrbStatus;
  /** Frame index currently being processed (0-based). */
  currentFrame: number;
  /** Total frames to process (known after video metadata loads). */
  totalFrames: number;
  /** The attempt ID written to sessionStore, available when status === "done". */
  attemptId: string | null;
  errorMessage: string | null;
}

const DEFAULT_FRAME_STEP = 5;

/**
 * Seeks through a video file frame-by-frame, runs pose estimation, and writes
 * the result to the session store. Supports two modes:
 *
 * Indoor  — pose detection on every sampled frame (original behaviour).
 *
 * Outdoor — pose detection every N frames with hip-centred cropping:
 *   1. First outdoor frame: full frame, establishes initial hip position.
 *   2. Subsequent N-th frames: crop centered on previous hips before detection.
 *   3. Keypoints mapped back to full-frame coordinates after detection.
 *   4. Gaps between detected frames filled by linear interpolation.
 *   5. FrameCapture metadata (crop box per detected frame) saved to the store.
 *
 * ORB extraction is unchanged in both modes — always runs on the first full
 * frame after the seek loop completes.
 *
 * @param frameIntervalMs - Seek step in milliseconds (default 100 ms).
 */
export function useVideoProcessor(frameIntervalMs = 100): VideoProcessorResult {
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [orbStatus, setOrbStatus] = useState<OrbStatus>("idle");
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef(false);

  const process = useCallback(
    async (
      file: File,
      detector: PoseDetector,
      cv: CV,
      mode: ClimbingMode = "indoor",
      frameStep: number = DEFAULT_FRAME_STEP,
      meta: { state: string; area: string; route: string } = { state: "", area: "", route: "" },
      cropOptions: { climberCrop?: CropFraction; orbCrop?: CropFraction } = {},
    ) => {
      abortRef.current = false;
      setStatus("processing");
      setOrbStatus("idle");
      setCurrentFrame(0);
      setTotalFrames(0);
      setAttemptId(null);
      setErrorMessage(null);

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      const objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      // Separate canvas for cropped outdoor frames.
      const cropCanvas = document.createElement("canvas");

      if (!ctx) {
        setStatus("error");
        setErrorMessage("Could not get 2D canvas context.");
        URL.revokeObjectURL(objectUrl);
        return;
      }

      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error("Failed to load video metadata."));
        });

        const { duration, videoWidth, videoHeight } = video;
        canvas.width = videoWidth;
        canvas.height = videoHeight;

        const frameCount = Math.ceil((duration * 1000) / frameIntervalMs);
        setTotalFrames(frameCount);

        const videoMeta: VideoMeta = {
          name: file.name,
          duration,
          fps: frameCount / duration,
          width: videoWidth,
          height: videoHeight,
        };

        const id = `attempt-${Date.now()}`;
        let referenceImageData: ImageData | null = null;

        // Indoor: dense frames (one per seek step).
        const indoorFrames: PoseFrame[] = [];

        // Outdoor: sparse detected frames + all timestamps for interpolation.
        const outdoorDetected: PoseFrame[] = [];
        const allTimestamps: number[] = [];
        const frameCaptures: FrameCapture[] = [];
        let lastHipCenter: HipCenter | null = null;

        for (let i = 0; i < frameCount; i++) {
          if (abortRef.current) break;

          const seekTime = (i * frameIntervalMs) / 1000;

          await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = () => reject(new Error(`Seek failed at ${seekTime}s`));
            video.currentTime = Math.min(seekTime, duration);
          });

          ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

          // Always use the first full frame as the ORB reference.
          if (i === 0) {
            referenceImageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
          }

          if (mode === "indoor") {
            // Apply the climber crop to focus detection on the relevant region,
            // then remap detected keypoints back to full-frame normalised coords
            // so every stored PoseFrame uses the same [0,1] coordinate space.
            let poseCanvas: HTMLCanvasElement = canvas;
            let appliedCropBox: { x: number; y: number; width: number; height: number } | null = null;

            if (cropOptions.climberCrop) {
              const cf = cropOptions.climberCrop;
              const cropBox = {
                x: Math.round(cf.x * videoWidth),
                y: Math.round(cf.y * videoHeight),
                width: Math.round(cf.w * videoWidth),
                height: Math.round(cf.h * videoHeight),
              };
              cropCanvas.width = cropBox.width;
              cropCanvas.height = cropBox.height;
              const cropCtx = cropCanvas.getContext("2d");
              if (cropCtx) {
                cropCtx.drawImage(
                  canvas,
                  cropBox.x, cropBox.y, cropBox.width, cropBox.height,
                  0, 0, cropBox.width, cropBox.height,
                );
                poseCanvas = cropCanvas;
                appliedCropBox = cropBox; // track that the crop was actually drawn
              }
            }

            const frame = await estimateFrame(detector, poseCanvas, video.currentTime);
            if (frame) {
              // Transform from crop-relative [0,1] → full-frame [0,1] before saving.
              const poseFrame: PoseFrame = appliedCropBox
                ? {
                    ...frame,
                    keypoints: mapKeypointsToFullFrame(
                      frame.keypoints,
                      appliedCropBox,
                      videoWidth,
                      videoHeight,
                    ),
                  }
                : frame;
              indoorFrames.push(poseFrame);
            }
          } else {
            // Collect every timestamp so the interpolator can produce a dense output.
            allTimestamps.push(video.currentTime);

            if (i % frameStep === 0) {
              let poseCanvas: HTMLCanvasElement = canvas;
              // appliedCropBox tracks whether crop drawing actually succeeded.
              // It is intentionally separate from the planned cropBox so that
              // mapKeypointsToFullFrame is only called when pose detection ran
              // on the crop canvas, not on the full canvas.
              let appliedCropBox: { x: number; y: number; width: number; height: number } | null = null;

              // Only apply a climber crop when the user specified one AND we
              // have a previous hip position to center it on. The first
              // outdoor frame always uses the full canvas (or the user crop
              // box at its original position), establishing the initial hip.
              let plannedCropBox: { x: number; y: number; width: number; height: number } | null = null;
              if (cropOptions.climberCrop && lastHipCenter !== null) {
                const cf = cropOptions.climberCrop;
                const boxW = Math.round(cf.w * videoWidth);
                const boxH = Math.round(cf.h * videoHeight);
                const hipX = lastHipCenter.x * videoWidth;
                const hipY = lastHipCenter.y * videoHeight;
                const bx = Math.max(0, Math.min(videoWidth - boxW, Math.round(hipX - boxW / 2)));
                const by = Math.max(0, Math.min(videoHeight - boxH, Math.round(hipY - boxH / 2)));
                plannedCropBox = { x: bx, y: by, width: boxW, height: boxH };
              } else if (cropOptions.climberCrop && lastHipCenter === null) {
                // First outdoor frame with a user crop: use the crop at its
                // original position as drawn on the video preview.
                const cf = cropOptions.climberCrop;
                plannedCropBox = {
                  x: Math.round(cf.x * videoWidth),
                  y: Math.round(cf.y * videoHeight),
                  width: Math.round(cf.w * videoWidth),
                  height: Math.round(cf.h * videoHeight),
                };
              }

              if (plannedCropBox) {
                cropCanvas.width = plannedCropBox.width;
                cropCanvas.height = plannedCropBox.height;
                const cropCtx = cropCanvas.getContext("2d");
                if (cropCtx) {
                  cropCtx.drawImage(
                    canvas,
                    plannedCropBox.x, plannedCropBox.y, plannedCropBox.width, plannedCropBox.height,
                    0, 0, plannedCropBox.width, plannedCropBox.height,
                  );
                  poseCanvas = cropCanvas;
                  appliedCropBox = plannedCropBox; // crop was drawn; remap after detection
                }
              }

              const frame = await estimateFrame(detector, poseCanvas, video.currentTime);
              if (frame) {
                // Transform from crop-relative [0,1] → full-frame [0,1] before saving.
                const poseFrame: PoseFrame = appliedCropBox
                  ? {
                      ...frame,
                      keypoints: mapKeypointsToFullFrame(
                        frame.keypoints,
                        appliedCropBox,
                        videoWidth,
                        videoHeight,
                      ),
                    }
                  : frame;

                outdoorDetected.push(poseFrame);
                lastHipCenter = extractHipCenter(poseFrame.keypoints) ?? lastHipCenter;
              }

              frameCaptures.push({ frameIndex: i, timestamp: video.currentTime, cropBox: plannedCropBox });
            }
          }

          setCurrentFrame(i + 1);
        }

        // Produce the final dense frame array, then smooth to fill dropouts
        // and reduce jitter.  Indoor mode benefits from the EMA pass too
        // (smooths detection noise on every sampled frame).
        const rawFrames =
          mode === "indoor"
            ? indoorFrames
            : interpolatePoseFrames(outdoorDetected, allTimestamps);
        const frames = smoothPoseFrames(rawFrames);

        saveAttempt({
          id,
          videoMeta,
          frames,
          orbFeatures: null,
          matchesPerFrame: null,
          frameCaptures: mode === "outdoor" ? frameCaptures : null,
          state: meta.state,
          area: meta.area,
          route: meta.route,
        });
        setAttemptId(id);
        setStatus("done");

        console.info(
          `[useVideoProcessor] Done. mode=${mode} attempt=${id} frames=${frames.length}`,
          frames[0] ?? "no frames detected",
        );

        // Yield to the React render cycle so the "done" status is painted
        // before we block the main thread with WASM ORB extraction.
        await new Promise<void>(r => setTimeout(r, 0));

        // ORB extraction: use user-defined orbCrop when provided, otherwise
        // extract from the full first frame.
        if (referenceImageData) {
          setOrbStatus("extracting");
          try {
            let orbFeatures;
            if (cropOptions.orbCrop) {
              const oc = cropOptions.orbCrop;
              orbFeatures = extractFeaturesFromCrop(cv, referenceImageData, {
                x: Math.round(oc.x * videoWidth),
                y: Math.round(oc.y * videoHeight),
                width: Math.round(oc.w * videoWidth),
                height: Math.round(oc.h * videoHeight),
                srcWidth: videoWidth,
                srcHeight: videoHeight,
              });
            } else {
              orbFeatures = extractFeatures(cv, referenceImageData);
            }
            saveAttempt({
              id,
              videoMeta,
              frames,
              orbFeatures,
              matchesPerFrame: null,
              frameCaptures: mode === "outdoor" ? frameCaptures : null,
              state: meta.state,
              area: meta.area,
              route: meta.route,
            });
            referenceImageData = null; // allow GC — no longer needed
            setOrbStatus("ready");
            console.info(
              `[useVideoProcessor] ORB reference ready. keypoints=${orbFeatures.keypoints.length}`,
            );
          } catch (orbErr) {
            setOrbStatus("failed");
            console.warn("[useVideoProcessor] ORB reference extraction failed:", orbErr);
          }
        } else {
          setOrbStatus("failed");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useVideoProcessor] Error:", err);
        setStatus("error");
        setErrorMessage(msg);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    [frameIntervalMs],
  );

  return { process, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage };
}
