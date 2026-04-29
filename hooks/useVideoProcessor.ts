"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { estimateFrameWithRetry, type PoseFrame } from "@/pipeline/poseDetection";
import { extractFeatures, extractFeaturesFromCrop, extractFeaturesExcludingClimber, type NormalizedPoint } from "@/pipeline/orbDetector";
import { generateOrbThumbnail } from "@/pipeline/orbThumbnail";
import { analyzeFrame, type FrameAnalysis } from "@/pipeline/frameAnalyzer";
import { applyOrbPreprocessing, applyPosePreprocessing } from "@/pipeline/framePreprocessor";
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

/**
 * Re-analyse lighting every N pose-detection frames so preprocessing adapts
 * to gradual changes in illumination as the climber moves through the scene.
 * At the default frameStep=5 and frameIntervalMs=100 ms this means roughly
 * every 10 seconds of video.
 */
const POSE_REANALYSIS_INTERVAL = 20;

/**
 * Module-level monotonic counter (seconds) for MediaPipe timestamps.
 * Each run advances by the video duration + gap so detectForVideo()
 * always receives strictly increasing ms values that stay well within
 * int32 range (~2.15 billion ms ≈ 596 hours total capacity).
 */
let nextMpTimestampSec = 1;

export interface VideoProcessorResult {
  /**
   * Start processing the supplied video File.
   *
   * Lighting analysis runs automatically from the first frame and adapts
   * every {@link POSE_REANALYSIS_INTERVAL} detection frames.  Pose and ORB
   * preprocessing use independent, purpose-built pipelines — no user-supplied
   * conditions are required.
   *
   * @param file      - The video to process.
   * @param detector  - Loaded MediaPipe PoseLandmarker instance.
   * @param cv        - Initialised OpenCV runtime.
   * @param frameStep - Pose detection runs every N-th sampled frame.
   *                    Gaps are filled by filtering + linear interpolation.
   *                    Default: 5.
   * @param meta      - Optional location + classification metadata.
   * @param cropOptions - Optional user-defined crop boxes.
   * @param startTime - Optional start time in seconds.
   * @param backend   - Which pose backend is active. Default: "mediapipe".
   */
  process: (
    file: File,
    detector: PoseDetector,
    cv: CV,
    frameStep?: number,
    meta?: { state: string; area: string; route: string; runType?: RunType; rating?: string; notes?: string },
    cropOptions?: { climberCrop?: CropFraction; orbCrop?: CropFraction },
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
 * Lighting is analysed automatically from the first frame and re-analysed
 * every {@link POSE_REANALYSIS_INTERVAL} detection frames.  Pose and ORB
 * preprocessing are applied through independent pipelines:
 *   - applyPosePreprocessing — adaptive gamma + optional equalisation blend
 *   - applyOrbPreprocessing  — retinex LCN + equalisation for cross-condition
 *                              descriptor stability
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
      cropOptions: { climberCrop?: CropFraction; orbCrop?: CropFraction } = {},
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

        // Pre-compute pixel-space crop boxes used by analyzeFrame
        const climberCropPx = cropOptions.climberCrop ? {
          x: Math.round(cropOptions.climberCrop.x * videoWidth),
          y: Math.round(cropOptions.climberCrop.y * videoHeight),
          width: Math.round(cropOptions.climberCrop.w * videoWidth),
          height: Math.round(cropOptions.climberCrop.h * videoHeight),
        } : undefined;

        const wallCropPx = cropOptions.orbCrop ? {
          x: Math.round(cropOptions.orbCrop.x * videoWidth),
          y: Math.round(cropOptions.orbCrop.y * videoHeight),
          width: Math.round(cropOptions.orbCrop.w * videoWidth),
          height: Math.round(cropOptions.orbCrop.h * videoHeight),
        } : undefined;

        let referenceImageData: ImageData | null = null;
        let middleFrameImageData: ImageData | null = null;
        const middleIndex = Math.floor(frameCount / 2);

        // Lighting analysis — seeded from frame 0, adapted at intervals
        let currentAnalysis: FrameAnalysis | null = null;
        let detectionFrameCount = 0;

        // Sparse detected frames + all timestamps for interpolation.
        const detected: PoseFrame[] = [];
        const allTimestamps: number[] = [];
        const frameCaptures: FrameCapture[] = [];
        let lastHipCenter: HipCenter | null = null;

        const mpTimestampBase = nextMpTimestampSec;
        nextMpTimestampSec += duration + 2;

        let lastMpTs = mpTimestampBase;

        for (let i = 0; i < frameCount; i++) {
          if (abortRef.current) break;

          const seekTime = ((startFrame + i) * frameIntervalMs) / 1000;

          await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = () => reject(new Error(`Seek failed at ${seekTime}s`));
            video.currentTime = Math.min(seekTime, duration);
          });

          ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

          if (i === 0) {
            // Capture first frame for ORB reference and seed the lighting analysis.
            referenceImageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
            currentAnalysis = analyzeFrame(cv, referenceImageData, climberCropPx, wallCropPx);
          }

          if (i === middleIndex) {
            middleFrameImageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
          }

          allTimestamps.push(video.currentTime);

          if (i % frameStep === 0) {
            let poseCanvas: HTMLCanvasElement = canvas;
            let appliedCropBox: { x: number; y: number; width: number; height: number } | null = null;
            let plannedCropBox: { x: number; y: number; width: number; height: number } | null = null;

            if (cropOptions.climberCrop && lastHipCenter !== null) {
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

            // Pose-specific preprocessing driven by the current lighting analysis.
            if (currentAnalysis) {
              applyPosePreprocessing(cv, poseCanvas, currentAnalysis);
            }

            const mpTs = Math.max(lastMpTs + 0.005, mpTimestampBase + video.currentTime);
            lastMpTs = mpTs;
            const frame = estimateFrameWithRetry(detector, poseCanvas, mpTs);
            if (frame) {
              frame.timestamp = video.currentTime;

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

            // Periodically re-analyse lighting to adapt to scene changes.
            detectionFrameCount++;
            if (detectionFrameCount % POSE_REANALYSIS_INTERVAL === 0) {
              const reData = ctx.getImageData(0, 0, videoWidth, videoHeight);
              currentAnalysis = analyzeFrame(cv, reData, climberCropPx, wallCropPx);
            }
          }

          setCurrentFrame(i + 1);
        }

        // ---------------------------------------------------------------
        // Gap recovery pass
        // ---------------------------------------------------------------
        const GAP_RECOVERY_THRESHOLD = 3 * frameStep;
        const MAX_RECOVERY_FRAMES = 30;

        if (detected.length >= 2 && !abortRef.current) {
          detected.sort((a, b) => a.timestamp - b.timestamp);

          const tsToIdx = new Map<number, number>();
          allTimestamps.forEach((ts, idx) => tsToIdx.set(ts, idx));

          const gaps: Array<{ afterIdx: number; gapStart: number; gapEnd: number }> = [];
          for (let d = 1; d < detected.length; d++) {
            const prevTs = detected[d - 1].timestamp;
            const currTs = detected[d].timestamp;
            const prevIdx = tsToIdx.get(prevTs) ?? 0;
            const currIdx = tsToIdx.get(currTs) ?? 0;
            const gapSize = currIdx - prevIdx;
            if (gapSize > GAP_RECOVERY_THRESHOLD) {
              gaps.push({ afterIdx: prevIdx, gapStart: prevIdx + 1, gapEnd: currIdx - 1 });
            }
          }

          for (const gap of gaps) {
            if (abortRef.current) break;
            const framesToProcess = Math.min(gap.gapEnd - gap.gapStart + 1, MAX_RECOVERY_FRAMES);

            for (let g = 0; g < framesToProcess; g++) {
              if (abortRef.current) break;
              const tsIdx = gap.gapStart + g;
              if (tsIdx >= allTimestamps.length) break;
              const seekTime = allTimestamps[tsIdx];

              await new Promise<void>((resolve, reject) => {
                video.onseeked = () => resolve();
                video.onerror = () => reject(new Error(`Recovery seek failed at ${seekTime}s`));
                video.currentTime = Math.min(seekTime, duration);
              });

              ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

              const recMpTs = Math.max(lastMpTs + 0.005, mpTimestampBase + video.currentTime);
              lastMpTs = recMpTs;
              const recoveryFrame = estimateFrameWithRetry(detector, canvas, recMpTs);
              if (recoveryFrame) {
                recoveryFrame.timestamp = video.currentTime;
                detected.push(recoveryFrame);
                lastHipCenter = extractHipCenter(recoveryFrame.keypoints) ?? lastHipCenter;
                break;
              }
            }
          }

          if (gaps.length > 0) {
            detected.sort((a, b) => a.timestamp - b.timestamp);
          }
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

        await new Promise<void>(r => setTimeout(r, 0));

        // ORB extraction — apply ORB-specific preprocessing to the reference
        // frame before descriptor extraction so features are stable across
        // different lighting conditions (indoor vs outdoor, etc.).
        if (referenceImageData) {
          setOrbStatus("extracting");
          try {
            // Draw reference frame onto a temporary canvas and apply ORB
            // preprocessing (retinex LCN + equalisation).  extractFeatures
            // then receives a locally-normalised grayscale image and skips
            // its own equaliseHist pass (normalizePixels=false).
            const orbCanvas = document.createElement("canvas");
            orbCanvas.width  = videoWidth;
            orbCanvas.height = videoHeight;
            const orbCtx = orbCanvas.getContext("2d");

            let processedOrbImageData = referenceImageData;
            if (orbCtx && currentAnalysis) {
              orbCtx.putImageData(referenceImageData, 0, 0);
              applyOrbPreprocessing(cv, orbCanvas, currentAnalysis);
              processedOrbImageData = orbCtx.getImageData(0, 0, videoWidth, videoHeight);
            }

            let orbFeatures;
            if (cropOptions.orbCrop) {
              const oc = cropOptions.orbCrop;
              orbFeatures = extractFeaturesFromCrop(cv, processedOrbImageData, {
                x: Math.round(oc.x * videoWidth),
                y: Math.round(oc.y * videoHeight),
                width: Math.round(oc.w * videoWidth),
                height: Math.round(oc.h * videoHeight),
                srcWidth: videoWidth,
                srcHeight: videoHeight,
              }, false); // normalizePixels=false — preprocessing already applied
            } else {
              const firstPose = detected.length > 0 ? detected[0] : null;
              const poseLandmarks: NormalizedPoint[] = firstPose
                ? firstPose.keypoints.map(kp => ({ x: kp.x, y: kp.y }))
                : [];
              orbFeatures = poseLandmarks.length >= 3
                ? extractFeaturesExcludingClimber(cv, processedOrbImageData, poseLandmarks, false)
                : extractFeatures(cv, processedOrbImageData, false);
            }

            const thumbSource = middleFrameImageData ?? referenceImageData;
            const thumbnail = thumbSource
              ? generateOrbThumbnail(thumbSource, orbFeatures)
              : undefined;
            middleFrameImageData = null;

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
            referenceImageData = null;
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
