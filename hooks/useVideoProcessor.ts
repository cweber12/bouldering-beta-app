"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type PoseFrame } from "@/pipeline/poseDetection";
import { estimateFramesMediaPipe } from "@/pipeline/mediapipePoseDetection";
import { extractFeatures, extractFeaturesExcludingClimber, type NormalizedPoint, type OrbCropBox, type OrbFeatures, type KeyframeFeatures } from "@/pipeline/orbDetector";
import { cropImageData } from "@/utils/cvHelpers";
import { neutralizeColorCast } from "@/utils/colorBalance";
import { generateOrbThumbnail } from "@/pipeline/orbThumbnail";
import { analyzeFrame, type FrameAnalysis } from "@/pipeline/frameAnalyzer";
import { applyOrbPreprocessing } from "@/pipeline/framePreprocessor";
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
import {
  detectFlips,
  isLandmarkFlip,
  DEFAULT_TELEPORT_THRESHOLD,
} from "@/pipeline/flipDetection";
import { saveAttempt, type VideoMeta, type FrameCapture, type RunType } from "@/storage/sessionStore";
import { seekVideo, SeekAbortedError, SeekTimeoutError } from "@/utils/videoSeek";
import type { CropFraction } from "@/utils/cropFraction";
import type { PoseBackend } from "@/utils/poseConstants";
import {
  buildScanDiagnostics,
  buildReferenceFrameMeta,
  detectBadStretches,
  summarizeMinAvgMax,
  type ScanDiagnostics,
  type SampledFrameStatus,
} from "@/pipeline/diagnostics";
import { hashFile } from "@/utils/hashFile";
import { shipDiagnostics } from "@/utils/shipDiagnostics";
import { APP_VERSION } from "@/utils/appVersion";

/** Minimum keypoint confidence the landmark filter keeps (see filterLandmarks). */
const MIN_KEYPOINT_SCORE = 0.3;

/**
 * Detection diagnostics are dev-local only. Resolved at module scope because the
 * `process` callback below shadows the global `process` inside the hook body.
 */
const DIAGNOSTICS_ENABLED = process.env.NODE_ENV === "development";

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
   * @param detection - Optional quality-tier detection knobs (gap-recovery
   *                    aggressiveness, landmark-filter tolerance).
   */
  process: (
    file: File,
    detector: PoseDetector,
    cv: CV,
    frameStep?: number,
    meta?: { state: string; area: string; route: string; runType?: RunType; rating?: string; notes?: string },
    cropOptions?: { climberCrop?: CropFraction; wallCrop?: CropFraction; climberPoint?: Point; panning?: boolean },
    startTime?: number,
    backend?: PoseBackend,
    detection?: {
      maxRecoveryFrames?: number;
      filterTolerance?: number;
      /** Base teleport threshold for flip detection (scaled by frameStep). */
      flipTeleportBase?: number;
      /**
       * Centroid displacement (normalised) between adjacent detected anchors
       * above which a segment is densified by Adaptive Refinement. Omit / set
       * very high to disable motion-triggered densification (e.g. Fast tier).
       */
      motionThreshold?: number;
      /** Frame stride used while refining a gap (1 = every frame). */
      refineStride?: number;
    },
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
  /**
   * The pristine first video frame as a PNG File, captured during the seek loop
   * for the Detection Preview background. Available shortly after processing
   * starts; null before. Reusing the already-decoded frame avoids a fragile
   * second video decode on the review step.
   */
  firstFrameFile: File | null;
  errorMessage: string | null;
  /**
   * Dev-local detection diagnostics for the completed scan, assembled after ORB
   * extraction. Null until ready; consumed by the dev-only DiagnosticsPanel.
   */
  scanDiagnostics: ScanDiagnostics | null;
}

const DEFAULT_FRAME_STEP = 5;

/**
 * Keyframe sampling interval (seconds) for Panning Capture. A Wall Crop ORB
 * **Keyframe** is captured roughly every {@link KEYFRAME_INTERVAL_SEC} of video
 * (fixed spacing, v1) so each section of the pan can be anchored to the Route
 * Photo independently. Fixed Capture extracts none.
 */
const KEYFRAME_INTERVAL_SEC = 0.75;

/**
 * Seeks through a video file frame-by-frame, runs pose estimation on every
 * N-th sampled frame with hip-centred cropping, then filters low-confidence
 * frames, interpolates across gaps, and applies EMA smoothing.
 *
 * Lighting is analysed automatically from the first frame and re-analysed
 * every {@link POSE_REANALYSIS_INTERVAL} detection frames. The analysis drives
 * ORB preprocessing only — MediaPipe detects on the raw colour frame, since
 * grayscale/equalised input blinds its RGB-trained model:
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
  const [firstFrameFile, setFirstFrameFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scanDiagnostics, setScanDiagnostics] = useState<ScanDiagnostics | null>(null);
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
      cropOptions: { climberCrop?: CropFraction; wallCrop?: CropFraction; climberPoint?: Point; panning?: boolean } = {},
      startTime: number = 0,
      backend: PoseBackend = "mediapipe",
      detection: {
        maxRecoveryFrames?: number;
        filterTolerance?: number;
        flipTeleportBase?: number;
        motionThreshold?: number;
        refineStride?: number;
      } = {},
    ) => {
      abortRef.current = false;
      const seekController = new AbortController();
      seekAbortRef.current = seekController;
      setStatus("processing");
      setOrbStatus("idle");
      setCurrentFrame(0);
      setTotalFrames(0);
      setAttemptId(null);
      setFirstFrameFile(null);
      setErrorMessage(null);
      setScanDiagnostics(null);

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

        // Panning Capture: sample Wall Crop ORB at fixed keyframe intervals so
        // each pan section anchors to the Route Photo independently. Zero-cost
        // for Fixed Capture (panning false → keyframeWallBox null, no captures).
        const panning = cropOptions.panning ?? false;
        const keyframeWallBox: OrbCropBox | null = panning
          ? (wallCropPx ?? { x: 0, y: 0, width: videoWidth, height: videoHeight, srcWidth: videoWidth, srcHeight: videoHeight })
          : null;
        const keyframes: KeyframeFeatures[] = [];
        let nextKeyframeTime = -Infinity; // first qualifying frame becomes keyframe 0
        const kfOrbCanvas = panning ? document.createElement("canvas") : null;
        if (kfOrbCanvas) {
          kfOrbCanvas.width = videoWidth;
          kfOrbCanvas.height = videoHeight;
        }

        let referenceImageData: ImageData | null = null;
        let middleFrameImageData: ImageData | null = null;
        const middleIndex = Math.floor(frameCount / 2);

        // Lighting analysis — seeded from frame 0, adapted at intervals
        let currentAnalysis: FrameAnalysis | null = null;
        let detectionFrameCount = 0;

        // Diagnostics accumulators (dev-local detection diagnostics).
        let referenceFrameAnalysis: FrameAnalysis | null = null; // frame-0 conditions
        const sampledStatus: SampledFrameStatus[] = [];          // one row per pose-detection frame
        const coverageSamples: number[] = [];                    // climber bbox area ÷ frame area
        let recoveryFramesUsed = 0;                              // frames accepted in Adaptive Refinement
        let gapsRefined = 0;                                     // gaps the refinement pass re-probed

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
          const cctx = cropCanvas.getContext("2d", { willReadFrequently: true });
          if (!cctx) return null;
          cctx.drawImage(canvas, reg.x, reg.y, reg.width, reg.height, 0, 0, reg.width, reg.height);

          // MediaPipe detects on the raw colour crop. We deliberately do NOT run
          // pose preprocessing here: it converted the crop to grayscale +
          // equalised it, which blinded MediaPipe's RGB-trained model and
          // produced zero detections on any frame analyzeFrame flagged (backlit /
          // exposed / low-contrast / blurry) — a data-dependent total failure.
          // MediaPipe normalises lighting internally, so the colour frame is both
          // safer and what worked before the preprocessing was introduced. ORB
          // preprocessing (which legitimately wants grayscale) is unaffected.
          //
          // One thing MediaPipe does NOT recover from is a strong global colour
          // cast: HDR / BT.2020 (HLG/PQ) clips drawn onto an sRGB canvas come out
          // heavily green and desaturated, and the RGB-trained detector then finds
          // nobody (rawPoses=0 even on the full frame). Neutralise such a cast
          // before detection. Self-gating: near-neutral frames are left untouched,
          // so footage that already works is unaffected.
          const frame = cctx.getImageData(0, 0, reg.width, reg.height);
          if (neutralizeColorCast(frame.data)) cctx.putImageData(frame, 0, 0);

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

        /**
         * Capture a Panning Capture **Keyframe**: extract Wall Crop ORB from the
         * frame currently drawn on `ctx` (full-frame coords), tagged with `ts`.
         * Applies the same ORB preprocessing as the frame-0 reference. Per-frame
         * climber masking is intentionally omitted (ADR scope) — the Wall Crop
         * plus Lowe/RANSAC drop climber features when matched to the photo.
         */
        const captureKeyframe = (ts: number): void => {
          if (!keyframeWallBox) return;
          const full = ctx.getImageData(0, 0, videoWidth, videoHeight);
          let processed = full;
          const kfCtx = kfOrbCanvas?.getContext("2d");
          if (kfCtx && currentAnalysis) {
            kfCtx.putImageData(full, 0, 0);
            applyOrbPreprocessing(cv, kfOrbCanvas!, currentAnalysis);
            processed = kfCtx.getImageData(0, 0, videoWidth, videoHeight);
          }
          const cropped = cropImageData(processed, keyframeWallBox);
          // normalizePixels only when ORB preprocessing did not already run.
          const feats = extractFeatures(cv, cropped, !currentAnalysis);
          const adjusted: OrbFeatures = {
            ...feats,
            keypoints: feats.keypoints.map(kp => ({
              ...kp,
              pt: { x: kp.pt.x + keyframeWallBox.x, y: kp.pt.y + keyframeWallBox.y },
            })),
            cropBox: keyframeWallBox,
          };
          keyframes.push({ timestamp: ts, features: adjusted });
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
            // Snapshot the frame-0 conditions for diagnostics before currentAnalysis
            // is re-assigned by the periodic re-analysis below.
            referenceFrameAnalysis = currentAnalysis;

            // Snapshot the pristine first frame to a File now, for the Detection
            // Preview background. Drawing to a dedicated canvas avoids a toBlob
            // race against the main canvas being overwritten by later frames, and
            // removes the fragile second video decode the review step used to do.
            const previewCanvas = document.createElement("canvas");
            previewCanvas.width = videoWidth;
            previewCanvas.height = videoHeight;
            previewCanvas.getContext("2d")?.putImageData(referenceImageData, 0, 0);
            previewCanvas.toBlob((blob) => {
              if (blob && mountedRef.current) {
                setFirstFrameFile(new File([blob], "first-frame.png", { type: "image/png" }));
              }
            }, "image/png");
          }

          if (i === middleIndex) {
            middleFrameImageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
          }

          // Panning Capture keyframe sampling (fixed ~KEYFRAME_INTERVAL_SEC
          // spacing). Runs after the i===0 lighting seed so currentAnalysis is
          // available for the first keyframe's ORB preprocessing.
          if (panning && video.currentTime >= nextKeyframeTime) {
            captureKeyframe(video.currentTime);
            nextKeyframeTime = video.currentTime + KEYFRAME_INTERVAL_SEC;
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

            let avgConfidence = 0;
            let keypointCount = 0;
            if (chosen) {
              chosen.timestamp = video.currentTime;
              detected.push(chosen);
              keypointCount = chosen.keypoints.length;
              avgConfidence = keypointCount > 0
                ? chosen.keypoints.reduce((s, kp) => s + kp.score, 0) / keypointCount
                : 0;
              const c = poseCentroid(chosen.keypoints);
              if (c) history.push(c);
              const box = deriveClimberCrop(chosen.keypoints, videoWidth, videoHeight);
              if (box) {
                lastClimberBox = box;
                coverageSamples.push((box.width * box.height) / (videoWidth * videoHeight));
              }
            }

            // Diagnostics: one row per pose-detection frame (wasFlip filled in
            // after the flip pass below).
            sampledStatus.push({
              timestamp: video.currentTime,
              frameIndex: i,
              detected: !!chosen,
              avgConfidence,
              keypointCount,
              wasFlip: false,
            });

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

        if (detected.length >= 2) {
          detected.sort((a, b) => a.timestamp - b.timestamp);
        }

        // ---------------------------------------------------------------
        // Landmark-flip pass (always-on)
        // ---------------------------------------------------------------
        // Discard Climber frames whose left/right labels glitched, comparing
        // each to the last accepted frame. The teleport threshold scales with
        // frameStep — sparser sampling legitimately allows more real motion
        // between detected frames. Discarded frames become gaps that Adaptive
        // Refinement re-probes below.
        const flipTeleportBase = detection.flipTeleportBase ?? DEFAULT_TELEPORT_THRESHOLD;
        const flipScan = detectFlips(detected, {
          teleportThreshold: flipTeleportBase * Math.max(1, frameStep / DEFAULT_FRAME_STEP),
        });
        const kept = flipScan.kept;
        const flippedIdx = new Set<number>();

        // Diagnostics: mark the sampled rows the flip pass discarded.
        const flippedTsSet = new Set(flipScan.flippedTimestamps);
        for (const row of sampledStatus) {
          if (flippedTsSet.has(row.timestamp)) row.wasFlip = true;
        }

        // ---------------------------------------------------------------
        // Adaptive Refinement pass
        // ---------------------------------------------------------------
        // Densely re-detect only the segments that need it — fast inter-anchor
        // motion, large tracking-loss gaps, or frames discarded as flips —
        // stepping frame-by-frame and accepting identity- + flip-gated poses up
        // to a per-gap budget. Static segments stay sparse. Reuses the seek
        // loop; the budget / motion threshold come from the quality tier.
        const GAP_RECOVERY_THRESHOLD = 3 * frameStep;
        const MAX_RECOVERY_FRAMES = detection.maxRecoveryFrames ?? 30;
        const MOTION_THRESHOLD = detection.motionThreshold ?? Infinity; // off by default
        const REFINE_STRIDE = Math.max(1, detection.refineStride ?? 1);
        // Refinement re-probes consecutive frames, so the flip gate there uses
        // the tight (un-scaled) base threshold.
        const refineFlipOptions = { teleportThreshold: flipTeleportBase };

        if (kept.length >= 2 && MAX_RECOVERY_FRAMES > 0 && !abortRef.current) {
          const tsToIdx = new Map<number, number>();
          allTimestamps.forEach((ts, idx) => tsToIdx.set(ts, idx));
          for (const ts of flipScan.flippedTimestamps) {
            const fi = tsToIdx.get(ts);
            if (fi !== undefined) flippedIdx.add(fi);
          }

          const gaps: Array<{ gapStart: number; gapEnd: number; leftFrame: PoseFrame }> = [];
          for (let d = 1; d < kept.length; d++) {
            const prevFrame = kept[d - 1];
            const currFrame = kept[d];
            const prevIdx = tsToIdx.get(prevFrame.timestamp) ?? 0;
            const currIdx = tsToIdx.get(currFrame.timestamp) ?? 0;
            if (currIdx - prevIdx <= 1) continue; // adjacent samples — nothing to refine

            // Trigger 1: large gap (tracking loss / discarded flip run).
            const largeGap = currIdx - prevIdx > GAP_RECOVERY_THRESHOLD;
            // Trigger 2: a flip was discarded inside this gap.
            let hasFlip = false;
            for (const fi of flippedIdx) {
              if (fi > prevIdx && fi < currIdx) { hasFlip = true; break; }
            }
            // Trigger 3: fast motion between the two anchors (centroid jump).
            const pc = poseCentroid(prevFrame.keypoints);
            const cc = poseCentroid(currFrame.keypoints);
            const fastMotion = pc && cc
              ? Math.hypot(cc.x - pc.x, cc.y - pc.y) > MOTION_THRESHOLD
              : false;

            if (largeGap || hasFlip || fastMotion) {
              gaps.push({ gapStart: prevIdx + 1, gapEnd: currIdx - 1, leftFrame: prevFrame });
            }
          }
          gapsRefined = gaps.length;

          for (const gap of gaps) {
            if (abortRef.current) break;
            let prevAccepted: PoseFrame = gap.leftFrame;
            let prevCentroid: Point | null = poseCentroid(gap.leftFrame.keypoints);
            let budget = MAX_RECOVERY_FRAMES;

            for (let tsIdx = gap.gapStart; tsIdx <= gap.gapEnd && budget > 0; tsIdx += REFINE_STRIDE) {
              if (abortRef.current) break;
              if (tsIdx >= allTimestamps.length) break;
              const seekTime = allTimestamps[tsIdx];

              try {
                await seekVideo(video, Math.min(seekTime, duration), { signal: seekController.signal });
              } catch (seekErr) {
                // User cancel → stop refinement entirely.
                if (seekErr instanceof SeekAbortedError) { abortRef.current = true; break; }
                // Decoder stall → skip this candidate, try the next.
                if (seekErr instanceof SeekTimeoutError) {
                  console.warn(`[useVideoProcessor] refinement ${seekErr.message} — skipping`);
                  continue;
                }
                throw seekErr;
              }

              ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

              // Full-frame re-detection, selected by identity against the last
              // accepted position so bystanders are rejected.
              const candidate = detectClimber(null, prevCentroid, REACQUIRE_GATE);
              if (!candidate) continue;
              candidate.timestamp = video.currentTime;

              // Flip gate: don't accept a re-detected frame that is itself a
              // glitch flip relative to the last accepted pose.
              if (isLandmarkFlip(prevAccepted, candidate, refineFlipOptions)) continue;

              kept.push(candidate);
              recoveryFramesUsed++;
              const c = poseCentroid(candidate.keypoints);
              if (c) { history.push(c); prevCentroid = c; }
              prevAccepted = candidate;
              budget--;
            }
          }

          kept.sort((a, b) => a.timestamp - b.timestamp);
        }

        // Pipeline: filter → interpolate → estimate missing landmarks → smooth.
        // Filtering is climbing-weighted; tolerance comes from the quality tier
        // (undefined → filterLandmarks' built-in default).
        const goodFrames   = filterLandmarks(kept, 0.3, detection.filterTolerance);
        const interpolated = interpolatePoseFrames(goodFrames, allTimestamps);
        const estimated    = estimateMissingLandmarks(interpolated, 10, 5, backend);
        const frames       = smoothPoseFrames(estimated);

        saveAttempt({
          id,
          videoMeta,
          frames,
          orbFeatures: null,
          keyframes: panning ? keyframes : null,
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
          `[useVideoProcessor] Done. attempt=${id} backend=${backend} detected=${detected.length} ` +
            `flips=${flipScan.flippedTimestamps.length} kept=${kept.length} good=${goodFrames.length} frames=${frames.length}` +
            (panning ? ` keyframes=${keyframes.length}` : ""),
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

            // Reference Frame Metadata — the frame-0 conditions + ORB keypoint
            // count, stored in S3 so the conditions travel with the reference
            // features (read back at match time for a Match Diagnostics record).
            const referenceFrameMeta = referenceFrameAnalysis
              ? buildReferenceFrameMeta(
                  referenceFrameAnalysis,
                  orbFeatures.keypoints.length,
                  videoWidth,
                  videoHeight,
                )
              : undefined;

            // Detection diagnostics are dev-local only — never compute them (or
            // the video content hash they need) for real users. Reference Frame
            // Metadata above is always written: it rides on the S3 artifact so a
            // dev Match Diagnostics record can read back the reference conditions.
            // Content hash of the source video — stored on the attempt so a later
            // Match Diagnostics record stays keyed to the video, and reused below
            // for this scan's diagnostics (hashFile caches per File).
            const videoHash = DIAGNOSTICS_ENABLED ? await hashFile(file) : undefined;

            saveAttempt({
              id,
              videoMeta,
              frames,
              orbFeatures,
              keyframes: panning ? keyframes : null,
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
              referenceFrameMeta,
              videoHash,
            });
            referenceImageData = null;
            setOrbStatus("ready");
            console.info(
              `[useVideoProcessor] ORB reference ready. keypoints=${orbFeatures.keypoints.length}`,
            );

            // ── Assemble + ship the Scan Diagnostics record ──────────────────
            // Self-contained: full input conditions, resolved config, appVersion,
            // and result, keyed by the video's content hash. Shipped to the
            // dev-only sink and surfaced to the DiagnosticsPanel.
            if (DIAGNOSTICS_ENABLED && referenceFrameAnalysis && videoHash) {
              try {
                const detectedRows = sampledStatus.filter(r => r.detected);
                // Average centroid displacement between consecutive detected
                // anchors (normalised units, like MOTION_THRESHOLD).
                let motionSum = 0;
                let motionCount = 0;
                let prevCentroid: Point | null = null;
                for (const f of kept) {
                  const c = poseCentroid(f.keypoints);
                  if (c && prevCentroid) {
                    motionSum += Math.hypot(c.x - prevCentroid.x, c.y - prevCentroid.y);
                    motionCount++;
                  }
                  if (c) prevCentroid = c;
                }
                const motionMagnitude = motionCount > 0 ? motionSum / motionCount : 0;

                const coverage = summarizeMinAvgMax(coverageSamples);

                const diagnostics = buildScanDiagnostics({
                  scanId: id,
                  videoHash,
                  appVersion: APP_VERSION,
                  video: {
                    width: videoWidth,
                    height: videoHeight,
                    durationSec: duration,
                    frameCount,
                    fileType: file.type,
                    source: file.name.startsWith("recording-") ? "recorded" : "uploaded",
                  },
                  captureMode: panning ? "panning" : "fixed",
                  referenceAnalysis: referenceFrameAnalysis,
                  climberFrameCoverage: { min: coverage.min, avg: coverage.avg },
                  motionMagnitude,
                  config: {
                    frameStep,
                    frameIntervalMs,
                    minScore: MIN_KEYPOINT_SCORE,
                    maxRecoveryFrames: MAX_RECOVERY_FRAMES,
                    motionThreshold: MOTION_THRESHOLD,
                    filterTolerance: detection.filterTolerance ?? null,
                    flipTeleportBase,
                    refineStride: REFINE_STRIDE,
                  },
                  pose: {
                    sampledFrames: sampledStatus.length,
                    detectedFrames: detected.length,
                    detectionRate: sampledStatus.length > 0 ? detected.length / sampledStatus.length : 0,
                    flippedFrames: flipScan.flippedTimestamps.length,
                    keptFrames: kept.length,
                    goodFrames: goodFrames.length,
                    confidence: summarizeMinAvgMax(detectedRows.map(r => r.avgConfidence)),
                    avgKeypointCount: detectedRows.length > 0
                      ? detectedRows.reduce((s, r) => s + r.keypointCount, 0) / detectedRows.length
                      : 0,
                    refinement: { gapsRefined, recoveryFramesUsed },
                  },
                  orb: {
                    refKeypointCount: orbFeatures.keypoints.length,
                    keyframeCount: keyframes.length,
                    keyframeKeypoints: summarizeMinAvgMax(keyframes.map(kf => kf.features.keypoints.length)),
                  },
                  badStretches: detectBadStretches(sampledStatus, GAP_RECOVERY_THRESHOLD),
                });

                if (mountedRef.current) setScanDiagnostics(diagnostics);
                shipDiagnostics(diagnostics);
              } catch (diagErr) {
                console.warn("[useVideoProcessor] diagnostics assembly failed:", diagErr);
              }
            }
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
      setFirstFrameFile(null);
      setErrorMessage(null);
      setScanDiagnostics(null);
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

  return { process, reset, status, orbStatus, currentFrame, totalFrames, attemptId, firstFrameFile, errorMessage, scanDiagnostics };
}
