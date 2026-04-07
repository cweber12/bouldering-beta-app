"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { estimateFrameWithRetry, type PoseFrame } from "@/pipeline/poseDetection";
import { extractFeatures, extractFeaturesFromCrop, extractFeaturesExcludingClimber, type NormalizedPoint } from "@/pipeline/orbDetector";
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

        // Offset ensuring MediaPipe receives strictly increasing timestamps
        // across runs without overflowing int32 (max ≈ 2 147 483 647 ms).
        // A module-level counter advances by each video's duration + gap,
        // keeping cumulative milliseconds well under the limit.
        const mpTimestampBase = nextMpTimestampSec;
        nextMpTimestampSec += duration + 2;

        // Tracks the most-recently used MediaPipe base timestamp so that every
        // subsequent call — including gap-recovery seeks that go backwards in
        // video time — remains strictly greater than the last call.
        // The margin (5 ms) exceeds the maximum per-retry offset used inside
        // estimateFrameWithRetry (1 ms × DEFAULT_MAX_RETRIES = 2 ms), ensuring
        // the *next* outer call is always newer than the last retry's timestamp.
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

            const mpTs = Math.max(lastMpTs + 0.005, mpTimestampBase + video.currentTime);
            lastMpTs = mpTs;
            const frame = estimateFrameWithRetry(detector, poseCanvas, mpTs);
            if (frame) {
              // Restore actual video timestamp — downstream interpolation and
              // playback need the real video time, not the MediaPipe offset.
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
          }

          setCurrentFrame(i + 1);
        }

        // ---------------------------------------------------------------
        // Gap recovery pass: if large gaps exist between detections,
        // seek back and process every frame through the gap until pose
        // is recovered. Bounded to prevent runaway loops.
        // ---------------------------------------------------------------
        const GAP_RECOVERY_THRESHOLD = 3 * frameStep; // frames in allTimestamps
        const MAX_RECOVERY_FRAMES = 30; // cap per gap to prevent runaway processing

        if (detected.length >= 2 && !abortRef.current) {
          // Sort detected by timestamp (should already be sorted, but defensive).
          detected.sort((a, b) => a.timestamp - b.timestamp);

          // Build a timestamp→index lookup for allTimestamps.
          const tsToIdx = new Map<number, number>();
          allTimestamps.forEach((ts, idx) => tsToIdx.set(ts, idx));

          // Find gaps between consecutive detections.
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

              // Use the full frame for recovery (no hip-tracking crop to avoid
              // compounding position errors from the gap).
              // Use max(lastMpTs + margin, ...) so we never pass a timestamp that
              // MediaPipe has already consumed, even though video.currentTime
              // is rewind into an earlier part of the clip.
              const recMpTs = Math.max(lastMpTs + 0.005, mpTimestampBase + video.currentTime);
              lastMpTs = recMpTs;
              const recoveryFrame = estimateFrameWithRetry(detector, canvas, recMpTs);
              if (recoveryFrame) {
                recoveryFrame.timestamp = video.currentTime;
                detected.push(recoveryFrame);
                lastHipCenter = extractHipCenter(recoveryFrame.keypoints) ?? lastHipCenter;
                // Pose recovered — stop dense processing for this gap.
                break;
              }
            }
          }

          // Re-sort after recovery insertions.
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

        // Yield to the React render cycle so the "done" status is painted
        // before we block the main thread with WASM ORB extraction.
        await new Promise<void>(r => setTimeout(r, 0));

        // ORB extraction: use user-defined orbCrop when provided.
        // When no crop is set, exclude the climber region using pose landmarks
        // from the first detected frame so features focus on wall texture.
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
              // Use pose landmarks from the first detected frame as a climber mask.
              const firstPose = detected.length > 0 ? detected[0] : null;
              const poseLandmarks: NormalizedPoint[] = firstPose
                ? firstPose.keypoints.map(kp => ({ x: kp.x, y: kp.y }))
                : [];
              orbFeatures = poseLandmarks.length >= 3
                ? extractFeaturesExcludingClimber(cv, referenceImageData, poseLandmarks)
                : extractFeatures(cv, referenceImageData);
            }
            // Generate thumbnail: draw ORB crop bounding box on the middle frame.
            const thumbSource = middleFrameImageData ?? referenceImageData;
            const thumbnail = thumbSource
              ? generateOrbThumbnail(thumbSource, orbFeatures)
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
