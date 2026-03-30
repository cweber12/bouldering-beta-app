"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { estimateFrameUnified, type PoseFrame } from "@/pipeline/poseDetection";
import { extractFeatures, extractFeaturesFromCrop } from "@/pipeline/orbDetector";
import { generateOrbThumbnail } from "@/pipeline/orbThumbnail";
import { applyFramePreprocessing } from "@/pipeline/framePreprocessor";
import {
  extractHipCenter,
  mapKeypointsToFullFrame,
  type HipCenter,
} from "@/pipeline/cropDetector";
import {
  filterLandmarks,
  interpolatePoseFrames,
  estimateMissingLandmarks,
  smoothPoseFrames,
} from "@/pipeline/poseInterpolator";
import { saveAttempt, type VideoMeta, type FrameCapture, type RunType } from "@/storage/sessionStore";
import type { CropFraction } from "@/components/shared/CropBoxOverlay";
import type { PoseBackend } from "@/utils/poseConstants";
import { getTopology } from "@/utils/poseConstants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export type ProcessingStatus = "idle" | "processing" | "done" | "error";
export type OrbStatus = "idle" | "extracting" | "ready" | "failed";

export interface VideoProcessorResult {
  /**
   * Start processing the supplied video File.
   *
   * All processing uses hip-crop tracking with configurable frame step,
   * followed by landmark filtering, interpolation, and EMA smoothing.
   *
   * @param file      - The video to process.
   * @param detector  - Loaded MediaPipe PoseLandmarker instance.
   * @param cv        - Initialised OpenCV runtime.
   * @param frameStep - Pose detection runs every N-th sampled frame.
   *                    Gaps are filled by filtering + linear interpolation.
   *                    Default: 5.
   * @param meta      - Optional location + classification metadata.
   * @param cropOptions - Optional user-defined crop boxes and lighting hints.
   * @param startTime - Optional start time in seconds.
   * @param backend   - Which pose backend is active. Default: "mediapipe".
   */
  process: (
    file: File,
    detector: PoseDetector,
    cv: CV,
    frameStep?: number,
    meta?: { state: string; area: string; route: string; runType?: RunType; rating?: string; notes?: string },
    cropOptions?: { climberCrop?: CropFraction; orbCrop?: CropFraction; conditions?: ReadonlySet<string> },
    startTime?: number,
    backend?: PoseBackend,
  ) => Promise<void>;
  /** Abort any in-flight processing and reset all state back to idle. */
  reset: () => void;
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
 * Seeks through a video file frame-by-frame, runs pose estimation on every
 * N-th sampled frame with hip-centred cropping, then filters low-confidence
 * frames, interpolates across gaps, and applies EMA smoothing.
 *
 * ORB extraction runs on the first full frame after the seek loop completes.
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
  const mountedRef = useRef(true);

  const process = useCallback(
    async (
      file: File,
      detector: PoseDetector,
      cv: CV,
      frameStep: number = DEFAULT_FRAME_STEP,
      meta: { state: string; area: string; route: string; runType?: RunType; rating?: string; notes?: string } = { state: "", area: "", route: "" },
      cropOptions: { climberCrop?: CropFraction; orbCrop?: CropFraction; conditions?: ReadonlySet<string> } = {},
      startTime: number = 0,
      backend: PoseBackend = "mediapipe",
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

      // Separate canvas for cropped frames.
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

        const totalFrameCount = Math.ceil((duration * 1000) / frameIntervalMs);
        const startFrame = startTime > 0 ? Math.floor((startTime * 1000) / frameIntervalMs) : 0;
        const frameCount = totalFrameCount - startFrame;
        setTotalFrames(frameCount);

        const videoMeta: VideoMeta = {
          name: file.name,
          duration,
          fps: frameCount / duration,
          width: videoWidth,
          height: videoHeight,
        };

        const id = `run-${Date.now()}`;
        let referenceImageData: ImageData | null = null;
        let middleFrameImageData: ImageData | null = null;
        const middleIndex = Math.floor(frameCount / 2);

        // Sparse detected frames + all timestamps for interpolation.
        const detected: PoseFrame[] = [];
        const allTimestamps: number[] = [];
        const frameCaptures: FrameCapture[] = [];
        let lastHipCenter: HipCenter | null = null;

        for (let i = 0; i < frameCount; i++) {
          if (abortRef.current) break;

          const seekTime = ((startFrame + i) * frameIntervalMs) / 1000;

          await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = () => reject(new Error(`Seek failed at ${seekTime}s`));
            video.currentTime = Math.min(seekTime, duration);
          });

          ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

          // Always capture the first full frame for ORB reference.
          if (i === 0) {
            referenceImageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
          }
          // Capture the middle frame for the ORB thumbnail.
          if (i === middleIndex) {
            middleFrameImageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
          }

          // Collect every timestamp for the dense interpolation timeline.
          allTimestamps.push(video.currentTime);

          if (i % frameStep === 0) {
            let poseCanvas: HTMLCanvasElement = canvas;
            let appliedCropBox: { x: number; y: number; width: number; height: number } | null = null;
            let plannedCropBox: { x: number; y: number; width: number; height: number } | null = null;

            if (cropOptions.climberCrop && lastHipCenter !== null) {
              // Subsequent frames: re-centre crop on last known hip.
              const cf = cropOptions.climberCrop;
              const boxW = Math.round(cf.w * videoWidth);
              const boxH = Math.round(cf.h * videoHeight);
              const hipX = lastHipCenter.x * videoWidth;
              const hipY = lastHipCenter.y * videoHeight;
              plannedCropBox = {
                x: Math.max(0, Math.min(videoWidth  - boxW, Math.round(hipX - boxW / 2))),
                y: Math.max(0, Math.min(videoHeight - boxH, Math.round(hipY - boxH / 2))),
                width: boxW,
                height: boxH,
              };
            } else if (cropOptions.climberCrop && lastHipCenter === null) {
              // First frame with user crop: use the box at its original position.
              const cf = cropOptions.climberCrop;
              plannedCropBox = {
                x: Math.round(cf.x * videoWidth),
                y: Math.round(cf.y * videoHeight),
                width: Math.round(cf.w * videoWidth),
                height: Math.round(cf.h * videoHeight),
              };
            }

            if (plannedCropBox) {
              cropCanvas.width  = plannedCropBox.width;
              cropCanvas.height = plannedCropBox.height;
              const cropCtx = cropCanvas.getContext("2d");
              if (cropCtx) {
                cropCtx.drawImage(
                  canvas,
                  plannedCropBox.x, plannedCropBox.y, plannedCropBox.width, plannedCropBox.height,
                  0, 0, plannedCropBox.width, plannedCropBox.height,
                );
                poseCanvas   = cropCanvas;
                appliedCropBox = plannedCropBox;
              }
            }

            // Apply lighting-condition preprocessing to the pose canvas before
            // running the model. ORB canvas is left untouched.
            if (cropOptions.conditions && cropOptions.conditions.size > 0) {
              applyFramePreprocessing(cv, poseCanvas, cropOptions.conditions);
            }

            const frame = await estimateFrameUnified(detector, poseCanvas, video.currentTime, backend);
            if (frame) {
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

              detected.push(poseFrame);
              lastHipCenter = extractHipCenter(poseFrame.keypoints) ?? lastHipCenter;
            }

            frameCaptures.push({ frameIndex: i, timestamp: video.currentTime, cropBox: plannedCropBox });
          }

          setCurrentFrame(i + 1);
        }

        // Pipeline: filter → interpolate → estimate missing landmarks → smooth.
        const topo = getTopology(backend);
        const goodFrames   = filterLandmarks(detected, 0.3, 2, topo.keypointCount);
        const interpolated = interpolatePoseFrames(goodFrames, allTimestamps);
        const estimated    = estimateMissingLandmarks(interpolated, 10, 5, backend);
        const frames       = smoothPoseFrames(estimated);

        saveAttempt({
          id,
          videoMeta,
          frames,
          orbFeatures: null,
          matchesPerFrame: null,
          frameCaptures,
          poseBackend: backend,
          state: meta.state,
          area: meta.area,
          route: meta.route,
          runType: meta.runType ?? "attempt",
          rating: meta.rating,
          notes: meta.notes,
        });
        setAttemptId(id);
        setStatus("done");

        console.info(
          `[useVideoProcessor] Done. attempt=${id} backend=${backend} detected=${detected.length} good=${goodFrames.length} frames=${frames.length}`,
        );

        // Yield to the React render cycle so the "done" status is painted
        // before we block the main thread with WASM ORB extraction.
        await new Promise<void>(r => setTimeout(r, 0));

        // ORB extraction: use user-defined orbCrop when provided.
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
            // Generate thumbnail: draw ORB keypoints on the middle frame.
            const thumbSource = middleFrameImageData ?? referenceImageData;
            const thumbnail = thumbSource
              ? generateOrbThumbnail(thumbSource, orbFeatures.keypoints)
              : undefined;
            middleFrameImageData = null; // allow GC

            saveAttempt({
              id,
              videoMeta,
              frames,
              orbFeatures,
              matchesPerFrame: null,
              frameCaptures,
              poseBackend: backend,
              state: meta.state,
              area: meta.area,
              route: meta.route,
              runType: meta.runType ?? "attempt",
              rating: meta.rating,
              notes: meta.notes,
              thumbnail: thumbnail || undefined,
            });
            referenceImageData = null; // allow GC
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

  // Abort processing when the component unmounts so background work does not
  // continue silently (fixes the upload-page navigation bug).
  const resetRef = useRef(() => {
    abortRef.current = true;
  });

  const reset = useCallback(() => {
    abortRef.current = true;
    if (mountedRef.current) {
      setStatus("idle");
      setOrbStatus("idle");
      setCurrentFrame(0);
      setTotalFrames(0);
      setAttemptId(null);
      setErrorMessage(null);
    }
  }, []);

  // On unmount, abort any in-flight processing.
  useEffect(() => {
    mountedRef.current = true;
    const resetFn = resetRef.current;
    return () => {
      mountedRef.current = false;
      resetFn();
    };
  }, []);

  return { process, reset, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage };
}
