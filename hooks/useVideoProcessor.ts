"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type PoseFrame } from "@/pipeline/poseDetection";
import { estimateFramesMediaPipe } from "@/pipeline/mediapipePoseDetection";
import { extractFeatures, extractFeaturesExcludingClimber, type NormalizedPoint, type OrbCropBox } from "@/pipeline/orbDetector";
import { cropImageData } from "@/utils/cvHelpers";
import { generateOrbThumbnail } from "@/pipeline/orbThumbnail";
import { analyzeFrame, type FrameAnalysis } from "@/pipeline/frameAnalyzer";
import { applyOrbPreprocessing, applyPosePreprocessing } from "@/pipeline/framePreprocessor";
import {
  mapKeypointsToFullFrame,
  type CropBox,
} from "@/pipeline/cropDetector";
import {
  deriveClimberCrop,
  expandCropBox,
  poseCentroid,
  predictCentroid,
  selectClimberByPoint,
  selectClimberPose,
  REACQUIRE_GATE,
  type Point,
} from "@/pipeline/climberTracker";
import {
  filterLandmarks,
  interpolatePoseFrames,
  estimateMissingLandmarks,
  smoothPoseFrames,
} from "@/pipeline/poseInterpolator";
import { saveAttempt, type VideoMeta, type FrameCapture, type RunType } from "@/storage/sessionStore";
import { seekVideo, SeekAbortedError, SeekTimeoutError } from "@/utils/videoSeek";
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

/**
 * Derive an ORB extraction region from the user's climber crop.
 *
 * Expands the climber bounding box outward by `padFactor` on each side so that
 * the surrounding wall texture is included. The result is clamped to the frame
 * bounds. Combined with the climber exclusion mask in extractFeaturesExcludingClimber,
 * this gives ORB features from the wall plane immediately around the climber
 * when a user-defined wall crop is not provided.
 */
function deriveWallRegion(
  climberCrop: CropFraction,
  frameW: number,
  frameH: number,
  padFactor = 0.35,
): OrbCropBox {
  const cx = climberCrop.x + climberCrop.w / 2;
  const cy = climberCrop.y + climberCrop.h / 2;
  const halfW = (climberCrop.w / 2) * (1 + padFactor);
  const halfH = (climberCrop.h / 2) * (1 + padFactor);
  const x = Math.max(0, Math.round((cx - halfW) * frameW));
  const y = Math.max(0, Math.round((cy - halfH) * frameH));
  const width  = Math.min(frameW - x, Math.round(halfW * 2 * frameW));
  const height = Math.min(frameH - y, Math.round(halfH * 2 * frameH));
  return { x, y, width, height, srcWidth: frameW, srcHeight: frameH };
}

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
    cropOptions?: { climberCrop?: CropFraction; wallCrop?: CropFraction; climberPoint?: Point },
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
  // Aborts in-flight seeks (the boolean abortRef only gates between iterations).
  const seekAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const process = useCallback(
    async (
      file: File,
      detector: PoseDetector,
      cv: CV,
      frameStep: number = DEFAULT_FRAME_STEP,
      meta: { state: string; area: string; route: string; runType?: RunType; rating?: string; notes?: string } = { state: "", area: "", route: "" },
      cropOptions: { climberCrop?: CropFraction; wallCrop?: CropFraction; climberPoint?: Point } = {},
      startTime: number = 0,
      backend: PoseBackend = "mediapipe",
    ) => {
      abortRef.current = false;
      const seekController = new AbortController();
      seekAbortRef.current = seekController;
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

        // Wall analysis region: prefer explicit user wall crop; otherwise
        // derive from climber crop with 35% padding.
        const wallCropPx = cropOptions.wallCrop ? {
          x: Math.round(cropOptions.wallCrop.x * videoWidth),
          y: Math.round(cropOptions.wallCrop.y * videoHeight),
          width: Math.round(cropOptions.wallCrop.w * videoWidth),
          height: Math.round(cropOptions.wallCrop.h * videoHeight),
          srcWidth: videoWidth,
          srcHeight: videoHeight,
        } : (cropOptions.climberCrop
          ? deriveWallRegion(cropOptions.climberCrop, videoWidth, videoHeight)
          : undefined);

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
        // Climber-identity tracking state.
        const history: Point[] = [];               // climber centroid trajectory (normalised, full frame)
        let lastClimberBox: CropBox | null = null; // adaptive crop derived from the last accepted pose
        const tappedPoint = cropOptions.climberPoint ?? null;

        const mpTimestampBase = nextMpTimestampSec;
        nextMpTimestampSec += duration + 2;

        let lastMpTs = mpTimestampBase;

        /**
         * Detect every person in `region` (pixels; null = full frame), map them
         * back to full-frame coordinates, and return the pose matching the
         * tracked climber identity. Identity is seeded from the tap (or the
         * strongest pose) on first acquisition, then tracked by velocity-gated
         * proximity to the predicted position.
         */
        const detectClimber = (
          region: CropBox | null,
          predicted: Point | null,
          gate?: number,
        ): PoseFrame | null => {
          const reg = region ?? { x: 0, y: 0, width: videoWidth, height: videoHeight };
          cropCanvas.width = reg.width;
          cropCanvas.height = reg.height;
          const cctx = cropCanvas.getContext("2d");
          if (!cctx) return null;
          cctx.drawImage(canvas, reg.x, reg.y, reg.width, reg.height, 0, 0, reg.width, reg.height);

          // Pose-specific preprocessing driven by the current lighting analysis.
          // Applied to the detection canvas only — the main canvas stays pristine
          // for ORB reference capture and lighting re-analysis.
          if (currentAnalysis) applyPosePreprocessing(cv, cropCanvas, currentAnalysis);

          const mpTs = Math.max(lastMpTs + 0.005, mpTimestampBase + video.currentTime);
          lastMpTs = mpTs;
          const posesLocal = estimateFramesMediaPipe(detector, cropCanvas, mpTs);
          if (posesLocal.length === 0) return null;

          const posesFull: PoseFrame[] = posesLocal.map(p => ({
            timestamp: p.timestamp,
            keypoints: mapKeypointsToFullFrame(p.keypoints, reg, videoWidth, videoHeight),
          }));

          // First acquisition: seed identity from the tap, else the strongest pose.
          if (history.length === 0) {
            return tappedPoint
              ? selectClimberByPoint(posesFull, tappedPoint)
              : selectClimberPose(posesFull, null);
          }
          return selectClimberPose(posesFull, predicted, gate);
        };

        for (let i = 0; i < frameCount; i++) {
          if (abortRef.current) break;

          const seekTime = ((startFrame + i) * frameIntervalMs) / 1000;

          try {
            await seekVideo(video, Math.min(seekTime, duration), { signal: seekController.signal });
          } catch (seekErr) {
            // User cancel → exit the loop cleanly (handled like abortRef).
            if (seekErr instanceof SeekAbortedError) break;
            // Decoder stall → skip this frame; the loop index still advances so
            // processing always terminates.
            if (seekErr instanceof SeekTimeoutError) {
              console.warn(`[useVideoProcessor] ${seekErr.message} — skipping frame ${i}`);
              continue;
            }
            throw seekErr;
          }

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
            const predicted = predictCentroid(history);

            // Region selection (pixels):
            //  • established track → adaptive crop around the climber (slack-expanded)
            //  • no track yet, no tap, manual/derived crop → use it as the seed region
            //  • otherwise full frame, so the tap / all people can be found
            let region: CropBox | null = null;
            if (lastClimberBox) {
              region = expandCropBox(lastClimberBox, videoWidth, videoHeight, 0.15);
            } else if (!tappedPoint && climberCropPx) {
              region = climberCropPx;
            }

            let chosen = detectClimber(region, predicted);

            // Lost inside a crop → widen to the full frame and re-acquire by
            // identity rather than locking onto a bystander.
            if (!chosen && region) {
              chosen = detectClimber(null, predicted, REACQUIRE_GATE);
            }

            if (chosen) {
              chosen.timestamp = video.currentTime;
              detected.push(chosen);
              const c = poseCentroid(chosen.keypoints);
              if (c) history.push(c);
              const box = deriveClimberCrop(chosen.keypoints, videoWidth, videoHeight);
              if (box) lastClimberBox = box;
            }

            frameCaptures.push({ frameIndex: i, timestamp: video.currentTime, cropBox: region });

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

          const gaps: Array<{ gapStart: number; gapEnd: number; prevCentroid: Point | null }> = [];
          for (let d = 1; d < detected.length; d++) {
            const prevTs = detected[d - 1].timestamp;
            const currTs = detected[d].timestamp;
            const prevIdx = tsToIdx.get(prevTs) ?? 0;
            const currIdx = tsToIdx.get(currTs) ?? 0;
            const gapSize = currIdx - prevIdx;
            if (gapSize > GAP_RECOVERY_THRESHOLD) {
              // Anchor recovery selection to the climber's position just before
              // the gap, so a full-frame re-detection can't lock onto a bystander.
              gaps.push({
                gapStart: prevIdx + 1,
                gapEnd: currIdx - 1,
                prevCentroid: poseCentroid(detected[d - 1].keypoints),
              });
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

              try {
                await seekVideo(video, Math.min(seekTime, duration), { signal: seekController.signal });
              } catch (seekErr) {
                // User cancel → stop recovery entirely.
                if (seekErr instanceof SeekAbortedError) { abortRef.current = true; break; }
                // Decoder stall → skip this recovery candidate, try the next.
                if (seekErr instanceof SeekTimeoutError) {
                  console.warn(`[useVideoProcessor] recovery ${seekErr.message} — skipping`);
                  continue;
                }
                throw seekErr;
              }

              ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

              // Full-frame re-detection, but selected by identity against the
              // pre-gap position so bystanders are rejected.
              const recoveryFrame = detectClimber(null, gap.prevCentroid, REACQUIRE_GATE);
              if (recoveryFrame) {
                recoveryFrame.timestamp = video.currentTime;
                detected.push(recoveryFrame);
                const c = poseCentroid(recoveryFrame.keypoints);
                if (c) history.push(c);
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

            const firstPose = detected.length > 0 ? detected[0] : null;
            const poseLandmarks: NormalizedPoint[] = firstPose
              ? firstPose.keypoints.map(kp => ({ x: kp.x, y: kp.y }))
              : [];

            let orbFeatures;
            if (cropOptions.climberCrop || wallCropPx) {
              // Prefer user-specified wall crop; fallback to derived wall box.
              // Exclude climber body via pose landmarks remapped to crop-local space.
              const wallBox = wallCropPx ?? deriveWallRegion(cropOptions.climberCrop!, videoWidth, videoHeight);
              const croppedData = cropImageData(processedOrbImageData, wallBox);

              // Remap full-frame normalised landmarks into the crop-local space.
              const remapped: NormalizedPoint[] = poseLandmarks
                .map(lm => ({
                  x: (lm.x * videoWidth  - wallBox.x) / wallBox.width,
                  y: (lm.y * videoHeight - wallBox.y) / wallBox.height,
                }))
                .filter(lm => lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1);

              const croppedFeatures = remapped.length >= 3
                ? extractFeaturesExcludingClimber(cv, croppedData, remapped, false)
                : extractFeatures(cv, croppedData, false);

              // Offset keypoints back to full-frame pixel coordinates.
              orbFeatures = {
                ...croppedFeatures,
                keypoints: croppedFeatures.keypoints.map(kp => ({
                  ...kp,
                  pt: { x: kp.pt.x + wallBox.x, y: kp.pt.y + wallBox.y },
                })),
                cropBox: wallBox,
              };
            } else {
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
    seekAbortRef.current?.abort();
  });

  const reset = useCallback(() => {
    abortRef.current = true;
    seekAbortRef.current?.abort();
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
