"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type PoseFrame, type PoseFrameSource } from "@/pipeline/pose/poseDetection";
import { estimateFramesMediaPipe } from "@/pipeline/pose/mediapipePoseDetection";
import {
  extractFeatures,
  extractFeaturesExcludingClimber,
  type NormalizedPoint,
  type OrbCropBox,
  type OrbFeatures,
  type KeyframeFeatures,
} from "@/pipeline/matching/orbDetector";
import { cropImageData } from "@/utils/cvHelpers";
import { neutralizeColorCast } from "@/utils/colorBalance";
import { generateOrbThumbnail } from "@/pipeline/matching/orbThumbnail";
import { analyzeFrame, type FrameAnalysis } from "@/pipeline/analysis/frameAnalyzer";
import { applyOrbPreprocessing } from "@/pipeline/analysis/framePreprocessor";
import { mapKeypointsToFullFrame, type CropBox } from "@/pipeline/tracking/cropDetector";
import {
  deriveClimberCrop,
  findMissingLimbs,
  pickAcquisitionRegion,
  poseCentroid,
  predictCentroid,
  selectClimberByPoint,
  selectClimberPose,
  REACQUIRE_GATE,
  type Point,
} from "@/pipeline/tracking/climberTracker";
import {
  filterLandmarks,
  interpolatePoseFrames,
  estimateMissingLandmarks,
  fillPersistentGaps,
  smoothPoseFrames,
  constrainSkeleton,
} from "@/pipeline/pose/poseInterpolator";
import {
  detectFlips,
  isLandmarkFlip,
  DEFAULT_TELEPORT_THRESHOLD,
} from "@/pipeline/pose/flipDetection";
import {
  saveAttempt,
  type VideoMeta,
  type FrameCapture,
  type RunType,
  type StoredHold,
} from "@/storage/sessionStore";
import { detectHoldsVideoSpace } from "@/pipeline/holds/holdDetection";
import { seekVideo, SeekAbortedError, SeekTimeoutError } from "@/utils/videoSeek";
import type { CropFraction } from "@/utils/cropFraction";
import type { CropTrace, CropTraceEntry } from "@/utils/cropTrace";
import type { PoseBackend } from "@/utils/poseConstants";
import {
  buildScanDiagnostics,
  buildReferenceFrameMeta,
  detectBadStretches,
  toFrameConditions,
  WEAK_CONFIDENCE_THRESHOLD,
  summarizeMinAvgMax,
  type ScanDiagnostics,
  type SampledFrameStatus,
} from "@/pipeline/analysis/diagnostics";
import { hashFile } from "@/utils/hashFile";
import { shipDiagnostics } from "@/utils/shipDiagnostics";
import { APP_VERSION } from "@/utils/appVersion";
import {
  DETECTOR_ATTEMPT_FULL_FRAME_REGION,
  type DetectorAttempt,
  type DetectorAttemptMissReason,
  type DetectorAttemptReacquireStep,
  type DetectorAttemptRegion,
  type DetectorAttemptSelectionMethod,
  type DetectorAttemptStatus,
} from "@/utils/harnessPayloads";

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
type DetectionFrameStatus = "detected" | "weak" | "missing" | "flip";

interface ClimberDetectionResult {
  selected: PoseFrame | null;
  candidateCount: number;
  rejectedCandidateCount: number;
  selectionMethod: DetectorAttemptSelectionMethod;
  /**
   * Highest mean keypoint confidence among the candidates this search returned
   * but did not select; null when there were none. Only computed while
   * detector-attempt collection is on.
   */
  bestUnselectedCandidateScore: number | null;
}

type DetectorAttemptDraft = {
  timestamp: number;
  status: DetectorAttemptStatus;
  initialSearchRegion: DetectorAttemptRegion;
  detectionRegion: DetectorAttemptRegion | null;
  reacquireAttempted: boolean;
  reacquired: boolean;
  reacquireSteps: DetectorAttemptReacquireStep[];
  bestUnselectedCandidateScore: number | null;
  missReason?: DetectorAttemptMissReason;
  rawKeypoints: PoseFrame["keypoints"];
  acceptedKeypoints?: PoseFrame["keypoints"];
  searchConditions: ReturnType<typeof toFrameConditions> | null;
  reacquireConditions: ReturnType<typeof toFrameConditions> | null;
  candidateCount: number;
  rejectedCandidateCount: number;
  selectionMethod: DetectorAttemptSelectionMethod;
};

interface ProcessingOptions {
  /** Emit live skeleton / ORB preview state for the animated scan loading view. */
  emitLivePreview?: boolean;
  /** Persist dense interpolated frames, or only accepted detector frames. */
  frameOutput?: "interpolated" | "detected";
  /** Compute scan-time Holds from output frames. */
  detectHolds?: boolean;
  /** Generate the ORB thumbnail stored with user-facing Runs. */
  generateThumbnail?: boolean;
  /** Collect analysis-only detector evidence for the dev harness payload. */
  collectDetectorAttempts?: boolean;
}

/**
 * Re-analyse lighting every N pose-detection frames so preprocessing adapts
 * to gradual changes in illumination as the climber moves through the scene.
 * At the default frameStep=5 and frameIntervalMs=100 ms this means roughly
 * every 10 seconds of video.
 */
const POSE_REANALYSIS_INTERVAL = 20;

/** Processed-time cadence (seconds) for loading-screen ORB preview refresh. */
export const ORB_PREVIEW_UPDATE_INTERVAL_SEC = 0.75;

/** Gate ORB preview refreshes to a bounded display cadence. */
export function shouldEmitOrbPreview(currentTimeSec: number, lastEmitTimeSec: number): boolean {
  return lastEmitTimeSec < 0 || currentTimeSec - lastEmitTimeSec >= ORB_PREVIEW_UPDATE_INTERVAL_SEC;
}

function detectorFrameSource(frame: PoseFrame): PoseFrameSource {
  return findMissingLimbs(frame.keypoints).length > 0 ? "limbExpanded" : "raw";
}

export function tagFlipDiscardedFrames(
  frames: PoseFrame[],
  flippedTimestamps: number[],
): PoseFrame[] {
  if (flippedTimestamps.length === 0) return frames;

  const flipped = new Set(flippedTimestamps);
  return frames.map((frame) => {
    if (!flipped.has(frame.timestamp)) return frame;
    if (frame.source === "raw" || frame.source === "limbExpanded") return frame;
    return { ...frame, source: "flipDiscarded" };
  });
}

function cloneKeypoints(keypoints: PoseFrame["keypoints"]): PoseFrame["keypoints"] {
  return keypoints.map((kp) => ({ ...kp }));
}

function timestampKey(timestamp: number): number {
  return Math.round(timestamp * 1000);
}

export function normalizeDetectorAttemptRegion(
  box: CropBox | null,
  videoWidth: number,
  videoHeight: number,
): DetectorAttemptRegion {
  if (!box) return { ...DETECTOR_ATTEMPT_FULL_FRAME_REGION };
  return {
    x: box.x / videoWidth,
    y: box.y / videoHeight,
    w: box.width / videoWidth,
    h: box.height / videoHeight,
  };
}

/**
 * Highest mean keypoint confidence among the candidates a single search
 * returned but did not select. Candidates with no keypoints have no mean and
 * are skipped, so an all-empty candidate set reads the same as an empty one:
 * `null`, meaning "there was no unselected candidate to score".
 *
 * Selection is compared by reference — the selector returns one of the very
 * pose objects it was handed.
 */
export function bestUnselectedCandidateScore(
  candidates: readonly PoseFrame[],
  selected: PoseFrame | null,
): number | null {
  let best: number | null = null;
  for (const candidate of candidates) {
    if (candidate === selected) continue;
    const count = candidate.keypoints.length;
    if (count === 0) continue;
    const mean = candidate.keypoints.reduce((sum, kp) => sum + kp.score, 0) / count;
    if (best === null || mean > best) best = mean;
  }
  return best;
}

/**
 * Fold the best-unselected score of one search into the attempt's running best,
 * so the attempt reports the strongest candidate it passed over across *every*
 * region it searched.
 */
export function mergeBestUnselectedScore(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Why a missing attempt selected nothing. Full-frame re-acquire already
 * searches every pixel, so a miss with candidates in hand was a gate rejection
 * in `selectClimberPose`, not a detector failure — that is the distinction the
 * harness cannot draw without this field.
 *
 * @param candidateCount Poses MediaPipe returned across every region searched.
 */
export function deriveMissReason(candidateCount: number): DetectorAttemptMissReason {
  return candidateCount === 0 ? "no-candidates" : "identity-gated";
}

export function finalizeDetectorAttempts(
  attempts: readonly DetectorAttempt[],
  flippedTimestamps: readonly number[],
  goodFrames: readonly PoseFrame[],
  flaggedTimestamps: readonly number[] = [],
): DetectorAttempt[] {
  const flipped = new Set(flippedTimestamps.map(timestampKey));
  const flagged = new Set(flaggedTimestamps.map(timestampKey));
  const good = new Set(goodFrames.map((frame) => timestampKey(frame.timestamp)));

  return attempts.map((attempt): DetectorAttempt => {
    if (attempt.status === "missing") return attempt;

    const key = timestampKey(attempt.timestamp);
    // Demotion strips both acceptance-only fields: a discarded frame is not
    // "accepted under suspicion", it is simply not accepted.
    if (flipped.has(key)) {
      const { acceptedKeypoints: _keypoints, flipFlagged: _flagged, ...rest } = attempt;
      return { ...rest, status: "flipRejected" };
    }
    if (!good.has(key)) {
      const { acceptedKeypoints: _keypoints, flipFlagged: _flagged, ...rest } = attempt;
      return { ...rest, status: "qualityRejected" };
    }
    // Tripped the flip verdict but survived the run cap: still accepted, with
    // the caveat attached rather than a fifth status.
    if (flagged.has(key) && attempt.status === "accepted") {
      return { ...attempt, flipFlagged: true };
    }
    return attempt;
  });
}

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
  const width = Math.min(frameW - x, Math.round(halfW * 2 * frameW));
  const height = Math.min(frameH - y, Math.round(halfH * 2 * frameH));
  return { x, y, width, height, srcWidth: frameW, srcHeight: frameH };
}

/**
 * Extract the wall ORB feature field from the reference frame as full-frame
 * normalised points, with the climber body masked out via the first pose. This
 * is a display-only pass for the scan loading view (the "x-ray" starfield) — it
 * mirrors the region/masking logic of the real matching extraction so the field
 * shown is the same wall texture the matcher relies on, but it does not feed
 * matching (that path runs unchanged at the end of the seek loop, so matching
 * quality is untouched). Returns points in [0, 1] relative to the frame.
 */
function extractWallFeaturePoints(
  cv: CV,
  referenceImageData: ImageData,
  firstPoseKeypoints: { x: number; y: number }[] | null,
  analysis: FrameAnalysis | null,
  cropOptions: { climberCrop?: CropFraction; wallCrop?: CropFraction },
  wallCropPx: OrbCropBox | undefined,
  videoWidth: number,
  videoHeight: number,
): NormalizedPoint[] {
  // Apply the same ORB preprocessing (retinex LCN + equalisation) as matching.
  let processed = referenceImageData;
  const orbCanvas = document.createElement("canvas");
  orbCanvas.width = videoWidth;
  orbCanvas.height = videoHeight;
  const orbCtx = orbCanvas.getContext("2d");
  if (orbCtx && analysis) {
    orbCtx.putImageData(referenceImageData, 0, 0);
    applyOrbPreprocessing(cv, orbCanvas, analysis);
    processed = orbCtx.getImageData(0, 0, videoWidth, videoHeight);
  }

  const poseLandmarks: NormalizedPoint[] = firstPoseKeypoints
    ? firstPoseKeypoints.map((kp) => ({ x: kp.x, y: kp.y }))
    : [];

  if (cropOptions.climberCrop || wallCropPx) {
    const wallBox =
      wallCropPx ?? deriveWallRegion(cropOptions.climberCrop!, videoWidth, videoHeight);
    const croppedData = cropImageData(processed, wallBox);
    const remapped: NormalizedPoint[] = poseLandmarks
      .map((lm) => ({
        x: (lm.x * videoWidth - wallBox.x) / wallBox.width,
        y: (lm.y * videoHeight - wallBox.y) / wallBox.height,
      }))
      .filter((lm) => lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1);
    const feats =
      remapped.length >= 3
        ? extractFeaturesExcludingClimber(cv, croppedData, remapped, false)
        : extractFeatures(cv, croppedData, false);
    return feats.keypoints.map((kp) => ({
      x: (kp.pt.x + wallBox.x) / videoWidth,
      y: (kp.pt.y + wallBox.y) / videoHeight,
    }));
  }

  const feats =
    poseLandmarks.length >= 3
      ? extractFeaturesExcludingClimber(cv, processed, poseLandmarks, false)
      : extractFeatures(cv, processed, false);
  return feats.keypoints.map((kp) => ({
    x: kp.pt.x / videoWidth,
    y: kp.pt.y / videoHeight,
  }));
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
   * @param options   - Optional processing toggles for dev-only harnesses.
   */
  process: (
    file: File,
    detector: PoseDetector,
    cv: CV,
    frameStep?: number,
    meta?: {
      state: string;
      area: string;
      route: string;
      runType?: RunType;
      rating?: string;
      notes?: string;
    },
    cropOptions?: {
      climberCrop?: CropFraction;
      wallCrop?: CropFraction;
      climberPoint?: Point;
      panning?: boolean;
    },
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
    options?: ProcessingOptions,
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
   * as a Detection Preview fallback poster while the source video is preparing.
   * Available shortly after processing starts; null before. Reusing the already-
   * decoded frame avoids a fragile second video decode on the review step.
   */
  firstFrameFile: File | null;
  errorMessage: string | null;
  /**
   * Dev-local detection diagnostics for the completed scan, assembled after ORB
   * extraction. Null until ready; consumed by the dev-only DiagnosticsPanel.
   */
  scanDiagnostics: ScanDiagnostics | null;
  /**
   * The wall ORB feature field from the reference frame, as full-frame
   * normalised points with the climber masked out. Emitted on a throttled
   * cadence while the seek loop runs so the loading "starfield" stays coherent
   * with camera motion. Null before the first emission.
   */
  orbPreview: NormalizedPoint[] | null;
  /**
   * The pose detected on the current detection frame (normalised keypoints),
   * refreshed as the seek loop advances. Drives the live (accented) skeleton in
   * the scan loading view; each prior pose becomes part of the muted trail. Null
   * before the first pose is detected.
   */
  currentPose: PoseFrame | null;
  /**
   * Dev-only per-frame crop trace for the detection eval harness: the Adaptive
   * Crop search region, the tight landmark box, and re-acquire / refinement
   * flags for each crop event. Populated only under {@link DIAGNOSTICS_ENABLED};
   * null otherwise. Never written to the attempt, so it never reaches S3.
   */
  cropTrace: CropTrace | null;
  /**
   * Dev-only detection-frame timeline for the harness filmstrip.
   */
  detectionFrames: { timestamp: number; status: DetectionFrameStatus }[] | null;
  /**
   * Analysis-only MediaPipe attempt evidence for dev Analyze. Null unless
   * `collectDetectorAttempts` was requested for this processor run.
   */
  detectorAttempts: DetectorAttempt[] | null;
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
  const [orbPreview, setOrbPreview] = useState<NormalizedPoint[] | null>(null);
  const [currentPose, setCurrentPose] = useState<PoseFrame | null>(null);
  const [cropTrace, setCropTrace] = useState<CropTrace | null>(null);
  const [detectionFrames, setDetectionFrames] = useState<
    { timestamp: number; status: DetectionFrameStatus }[] | null
  >(null);
  const [detectorAttempts, setDetectorAttempts] = useState<DetectorAttempt[] | null>(null);
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
      meta: {
        state: string;
        area: string;
        route: string;
        runType?: RunType;
        rating?: string;
        notes?: string;
      } = { state: "", area: "", route: "" },
      cropOptions: {
        climberCrop?: CropFraction;
        wallCrop?: CropFraction;
        climberPoint?: Point;
        panning?: boolean;
      } = {},
      startTime: number = 0,
      backend: PoseBackend = "mediapipe",
      detection: {
        maxRecoveryFrames?: number;
        filterTolerance?: number;
        flipTeleportBase?: number;
        motionThreshold?: number;
        refineStride?: number;
      } = {},
      options: ProcessingOptions = {},
    ) => {
      const emitLivePreview = options.emitLivePreview ?? true;
      const frameOutput = options.frameOutput ?? "interpolated";
      const shouldDetectHolds = options.detectHolds ?? true;
      const shouldGenerateThumbnail = options.generateThumbnail ?? true;
      const shouldCollectDetectorAttempts = options.collectDetectorAttempts ?? false;

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
      setOrbPreview(null);
      setCurrentPose(null);
      setCropTrace(null);
      setDetectionFrames(null);
      setDetectorAttempts(null);

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
        const climberCropPx = cropOptions.climberCrop
          ? {
              x: Math.round(cropOptions.climberCrop.x * videoWidth),
              y: Math.round(cropOptions.climberCrop.y * videoHeight),
              width: Math.round(cropOptions.climberCrop.w * videoWidth),
              height: Math.round(cropOptions.climberCrop.h * videoHeight),
            }
          : undefined;

        // Wall analysis region: prefer explicit user wall crop; otherwise
        // derive from climber crop with 35% padding.
        const wallCropPx = cropOptions.wallCrop
          ? {
              x: Math.round(cropOptions.wallCrop.x * videoWidth),
              y: Math.round(cropOptions.wallCrop.y * videoHeight),
              width: Math.round(cropOptions.wallCrop.w * videoWidth),
              height: Math.round(cropOptions.wallCrop.h * videoHeight),
              srcWidth: videoWidth,
              srcHeight: videoHeight,
            }
          : cropOptions.climberCrop
            ? deriveWallRegion(cropOptions.climberCrop, videoWidth, videoHeight)
            : undefined;

        // Panning Capture: sample Wall Crop ORB at fixed keyframe intervals so
        // each pan section anchors to the Route Photo independently. Zero-cost
        // for Fixed Capture (panning false → keyframeWallBox null, no captures).
        const panning = cropOptions.panning ?? false;
        const keyframeWallBox: OrbCropBox | null = panning
          ? (wallCropPx ?? {
              x: 0,
              y: 0,
              width: videoWidth,
              height: videoHeight,
              srcWidth: videoWidth,
              srcHeight: videoHeight,
            })
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
        // ORB preview emission state for the loading view. The starfield is
        // refreshed on a throttled cadence so it moves with camera motion.
        let lastOrbPreviewEmitSec = -Infinity;
        let latestPreviewFrameData: ImageData | null = null;

        // Lighting analysis — seeded from frame 0, adapted at intervals
        let currentAnalysis: FrameAnalysis | null = null;
        let detectionFrameCount = 0;

        // Diagnostics accumulators (dev-local detection diagnostics).
        let referenceFrameAnalysis: FrameAnalysis | null = null; // frame-0 conditions
        const sampledStatus: SampledFrameStatus[] = []; // one row per pose-detection frame
        const coverageSamples: number[] = []; // climber bbox area ÷ frame area
        let recoveryFramesUsed = 0; // frames accepted in Adaptive Refinement
        let gapsRefined = 0; // gaps the refinement pass re-probed
        let limbExpandedFrames = 0; // detection frames where a missing-limb reach disk was applied (ADR 0014)
        // Dev-only per-frame crop trace for the harness Detection Preview. Only
        // filled under DIAGNOSTICS_ENABLED; exposed via setCropTrace, never on
        // the attempt (so it never reaches S3). See utils/cropTrace.ts.
        const cropTraceEntries: CropTraceEntry[] = [];
        const detectorAttemptDrafts: DetectorAttempt[] = [];

        // Sparse detected frames + all timestamps for interpolation.
        const detected: PoseFrame[] = [];
        const allTimestamps: number[] = [];
        const frameCaptures: FrameCapture[] = [];
        // Climber-identity tracking state.
        const history: Point[] = []; // climber centroid trajectory (normalised, full frame)
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
        ): ClimberDetectionResult => {
          const selectionMethod: DetectorAttemptSelectionMethod =
            history.length === 0 ? (tappedPoint ? "tap" : "strongest") : "tracked";
          const reg = region ?? { x: 0, y: 0, width: videoWidth, height: videoHeight };
          cropCanvas.width = reg.width;
          cropCanvas.height = reg.height;
          const cctx = cropCanvas.getContext("2d", { willReadFrequently: true });
          if (!cctx) {
            return {
              selected: null,
              candidateCount: 0,
              rejectedCandidateCount: 0,
              selectionMethod,
              bestUnselectedCandidateScore: null,
            };
          }
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

          if (posesLocal.length === 0) {
            return {
              selected: null,
              candidateCount: 0,
              rejectedCandidateCount: 0,
              selectionMethod,
              bestUnselectedCandidateScore: null,
            };
          }

          const posesFull: PoseFrame[] = posesLocal.map((p) => ({
            timestamp: p.timestamp,
            keypoints: mapKeypointsToFullFrame(p.keypoints, reg, videoWidth, videoHeight),
          }));

          // First acquisition: seed identity from the tap, else the strongest pose.
          const selected =
            history.length === 0
              ? tappedPoint
                ? selectClimberByPoint(posesFull, tappedPoint)
                : selectClimberPose(posesFull, null)
              : selectClimberPose(posesFull, predicted, gate);
          return {
            selected,
            candidateCount: posesFull.length,
            rejectedCandidateCount: selected ? Math.max(0, posesFull.length - 1) : posesFull.length,
            selectionMethod,
            // Analysis-only evidence: never scored for user-facing scans.
            bestUnselectedCandidateScore: shouldCollectDetectorAttempts
              ? bestUnselectedCandidateScore(posesFull, selected)
              : null,
          };
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
            keypoints: feats.keypoints.map((kp) => ({
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
            if (emitLivePreview) latestPreviewFrameData = referenceImageData;
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

          if (shouldGenerateThumbnail && i === middleIndex) {
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
            const last = history.length > 0 ? history[history.length - 1] : null;

            // Region selection (pixels):
            //  • established track → a forward-looking region: the last climber
            //    box translated toward where the Climber is heading, with a
            //    velocity-sized margin, so a limb reaching between detection
            //    frames stays inside the detection input rather than being
            //    clipped out (ADR 0013).
            //  • no track yet but a climber crop is known → seed acquisition with
            //    it, even when the climber was tapped (the tap drives identity,
            //    not the search area). This keeps a small / distant climber large
            //    enough in the detection input for MediaPipe; searching the full
            //    frame leaves a climber at the base of a tall boulder undetectable
            //    until they climb large enough.
            //  • otherwise full frame.
            // A missed region still falls back to the full-frame re-acquire below.
            const region = pickAcquisitionRegion(
              lastClimberBox,
              climberCropPx ?? null,
              videoWidth,
              videoHeight,
              last && predicted ? { predicted, last } : undefined,
            );

            const initialDetection = detectClimber(region, predicted);
            let chosen = initialDetection.selected;
            let candidateCount = initialDetection.candidateCount;
            let rejectedCandidateCount = initialDetection.rejectedCandidateCount;
            let selectionMethod = initialDetection.selectionMethod;
            let bestUnselectedScore = initialDetection.bestUnselectedCandidateScore;
            const searchConditions =
              shouldCollectDetectorAttempts
                ? toFrameConditions(
                    analyzeFrame(
                      cv,
                      ctx.getImageData(0, 0, videoWidth, videoHeight),
                      region ?? { x: 0, y: 0, width: videoWidth, height: videoHeight },
                    ),
                  )
                : null;

            // Lost inside a crop → widen to the full frame and re-acquire by
            // identity rather than locking onto a bystander.
            let reacquired = false;
            let reacquireConditions: ReturnType<typeof toFrameConditions> | null = null;
            // The rungs the re-acquire walked, in search order. Today that is a
            // single full-frame rung; the ladder fills it out.
            const reacquireSteps: DetectorAttemptReacquireStep[] = [];
            if (!chosen && region) {
              const reacquireDetection = detectClimber(null, predicted, REACQUIRE_GATE);
              chosen = reacquireDetection.selected;
              candidateCount += reacquireDetection.candidateCount;
              rejectedCandidateCount += reacquireDetection.rejectedCandidateCount;
              selectionMethod = reacquireDetection.selectionMethod;
              bestUnselectedScore = mergeBestUnselectedScore(
                bestUnselectedScore,
                reacquireDetection.bestUnselectedCandidateScore,
              );
              reacquired = !!chosen;
              reacquireSteps.push({
                region: { ...DETECTOR_ATTEMPT_FULL_FRAME_REGION },
                found: reacquired,
              });
              reacquireConditions =
                shouldCollectDetectorAttempts
                  ? toFrameConditions(
                      analyzeFrame(cv, ctx.getImageData(0, 0, videoWidth, videoHeight), {
                        x: 0,
                        y: 0,
                        width: videoWidth,
                        height: videoHeight,
                      }),
                    )
                  : null;
            }

            let avgConfidence = 0;
            let keypointCount = 0;
            let landmarkBox: CropBox | null = null; // deriveClimberCrop, for the dev crop trace
            const rawKeypoints = chosen ? cloneKeypoints(chosen.keypoints) : [];
            if (chosen) {
              chosen.timestamp = video.currentTime;
              chosen.source = detectorFrameSource(chosen);
              detected.push(chosen);
              keypointCount = chosen.keypoints.length;
              avgConfidence =
                keypointCount > 0
                  ? chosen.keypoints.reduce((s, kp) => s + kp.score, 0) / keypointCount
                  : 0;
              const c = poseCentroid(chosen.keypoints);
              if (c) history.push(c);
              const box = deriveClimberCrop(chosen.keypoints, videoWidth, videoHeight);
              landmarkBox = box;
              if (box) {
                lastClimberBox = box;
                coverageSamples.push((box.width * box.height) / (videoWidth * videoHeight));
              }
              // ADR 0014: count frames where a missing limb pushed the crop out via
              // a reach disk, so the constants can be tuned against real Runs.
              if (chosen.source === "limbExpanded") limbExpandedFrames++;
            }

            if (shouldCollectDetectorAttempts) {
              const detectionRegion = chosen
                ? reacquired
                  ? normalizeDetectorAttemptRegion(null, videoWidth, videoHeight)
                  : normalizeDetectorAttemptRegion(region, videoWidth, videoHeight)
                : null;
              const baseAttempt = {
                timestamp: video.currentTime,
                initialSearchRegion: normalizeDetectorAttemptRegion(region, videoWidth, videoHeight),
                detectionRegion,
                reacquireAttempted: !initialDetection.selected && !!region,
                reacquired,
                reacquireSteps,
                bestUnselectedCandidateScore: bestUnselectedScore,
                rawKeypoints,
                searchConditions,
                reacquireConditions,
                candidateCount,
                rejectedCandidateCount,
                selectionMethod,
              } satisfies Omit<
                DetectorAttemptDraft,
                "status" | "acceptedKeypoints" | "missReason"
              >;
              detectorAttemptDrafts.push(
                chosen && detectionRegion
                  ? {
                      ...baseAttempt,
                      status: "accepted",
                      detectionRegion,
                      acceptedKeypoints: cloneKeypoints(chosen.keypoints),
                    }
                  : {
                      ...baseAttempt,
                      status: "missing",
                      detectionRegion: null,
                      rawKeypoints: [],
                      missReason: deriveMissReason(candidateCount),
                    },
              );
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

            // Dev crop trace: the Adaptive Crop search region fed to the detector,
            // the tight landmark box it found, and the re-acquire flag. Drawn on
            // the harness Detection Preview; never persisted to the attempt/S3.
            if (DIAGNOSTICS_ENABLED) {
              cropTraceEntries.push({
                timestamp: video.currentTime,
                frameIndex: i,
                detected: !!chosen,
                reacquired: reacquired || (!initialDetection.selected && !!region),
                refinement: false,
                searchRegion: region,
                landmarkBox,
              });
            }

            // Periodically re-analyse lighting to adapt to scene changes.
            detectionFrameCount++;
            if (detectionFrameCount % POSE_REANALYSIS_INTERVAL === 0) {
              const reData = ctx.getImageData(0, 0, videoWidth, videoHeight);
              if (emitLivePreview) latestPreviewFrameData = reData;
              currentAnalysis = analyzeFrame(cv, reData, climberCropPx, wallCropPx);
            }

            // Feed the scan loading view (the "x-ray"): the live detected pose
            // drives the accented skeleton. The ORB starfield is refreshed on a
            // throttled cadence so it scrolls with the wall while staying cheap.
            if (emitLivePreview && chosen && mountedRef.current) {
              setCurrentPose(chosen);
              if (shouldEmitOrbPreview(video.currentTime, lastOrbPreviewEmitSec)) {
                lastOrbPreviewEmitSec = video.currentTime;
                try {
                  if (panning && keyframes.length > 0) {
                    const latestKeyframe = keyframes[keyframes.length - 1];
                    setOrbPreview(
                      latestKeyframe.features.keypoints.map((kp) => ({
                        x: kp.pt.x / videoWidth,
                        y: kp.pt.y / videoHeight,
                      })),
                    );
                  } else {
                    const previewFrameData: ImageData =
                      latestPreviewFrameData ?? ctx.getImageData(0, 0, videoWidth, videoHeight);
                    latestPreviewFrameData = previewFrameData;
                    setOrbPreview(
                      extractWallFeaturePoints(
                        cv,
                        previewFrameData,
                        chosen.keypoints,
                        currentAnalysis,
                        cropOptions,
                        wallCropPx,
                        videoWidth,
                        videoHeight,
                      ),
                    );
                  }
                } catch (err) {
                  console.warn("[useVideoProcessor] ORB preview extraction failed", err);
                }
              }
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
              if (fi > prevIdx && fi < currIdx) {
                hasFlip = true;
                break;
              }
            }
            // Trigger 3: fast motion between the two anchors (centroid jump).
            const pc = poseCentroid(prevFrame.keypoints);
            const cc = poseCentroid(currFrame.keypoints);
            const fastMotion =
              pc && cc ? Math.hypot(cc.x - pc.x, cc.y - pc.y) > MOTION_THRESHOLD : false;

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

            for (
              let tsIdx = gap.gapStart;
              tsIdx <= gap.gapEnd && budget > 0;
              tsIdx += REFINE_STRIDE
            ) {
              if (abortRef.current) break;
              if (tsIdx >= allTimestamps.length) break;
              const seekTime = allTimestamps[tsIdx];

              try {
                await seekVideo(video, Math.min(seekTime, duration), {
                  signal: seekController.signal,
                });
              } catch (seekErr) {
                // User cancel → stop refinement entirely.
                if (seekErr instanceof SeekAbortedError) {
                  abortRef.current = true;
                  break;
                }
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
              const candidate = detectClimber(null, prevCentroid, REACQUIRE_GATE).selected;
              if (!candidate) continue;
              candidate.timestamp = video.currentTime;
              candidate.source = detectorFrameSource(candidate);

              // Flip gate: don't accept a re-detected frame that is itself a
              // glitch flip relative to the last accepted pose.
              if (isLandmarkFlip(prevAccepted, candidate, refineFlipOptions)) continue;

              kept.push(candidate);
              recoveryFramesUsed++;
              const c = poseCentroid(candidate.keypoints);
              if (c) {
                history.push(c);
                prevCentroid = c;
              }
              prevAccepted = candidate;
              budget--;

              // Dev crop trace: Refinement always re-detects on the full frame,
              // so there is no search region to draw — record it as a flag and
              // keep the landmark box it produced.
              if (DIAGNOSTICS_ENABLED) {
                cropTraceEntries.push({
                  timestamp: candidate.timestamp,
                  frameIndex: tsIdx,
                  detected: true,
                  reacquired: false,
                  refinement: true,
                  searchRegion: null,
                  landmarkBox: deriveClimberCrop(candidate.keypoints, videoWidth, videoHeight),
                });
              }
            }
          }

          kept.sort((a, b) => a.timestamp - b.timestamp);
        }

        // Publish the dev crop trace (main-loop rows + any Refinement rows),
        // sorted by video time so the preview can hold/step to the active crop.
        if (DIAGNOSTICS_ENABLED) {
          cropTraceEntries.sort((a, b) => a.timestamp - b.timestamp);
          if (mountedRef.current) setCropTrace(cropTraceEntries);
        }

        if (mountedRef.current) {
          setDetectionFrames(
            sampledStatus.map((row) => ({
              timestamp: row.timestamp,
              status: row.wasFlip
                ? "flip"
                : !row.detected
                  ? "missing"
                  : row.avgConfidence < WEAK_CONFIDENCE_THRESHOLD
                    ? "weak"
                    : "detected",
            })),
          );
        }

        // Pipeline: filter → interpolate → estimate → fill persistent gaps →
        // smooth → constrain. Filtering is climbing-weighted; tolerance comes
        // from the quality tier (undefined → filterLandmarks' built-in default).
        // The persistent-gap pass is the no-gap guarantee: any joint detected on
        // both temporal sides is always present (dimmed), so an occluded limb
        // cannot wink out mid-climb even across dropouts too long to bridge or
        // too degraded to estimate. The final constrain pass rebuilds each limb
        // joint in bone space (angle + length interpolated between the real
        // detections) so bones keep a rigid length and true orientation — the
        // earlier x/y passes move each joint independently of its parent, which
        // makes rotating limbs stretch/snap and occluded joints bend the wrong
        // way (see ADR 0015).
        const goodFrames = filterLandmarks(kept, 0.3, detection.filterTolerance);
        const finalizedDetectorAttempts = shouldCollectDetectorAttempts
          ? finalizeDetectorAttempts(
              detectorAttemptDrafts,
              flipScan.flippedTimestamps,
              goodFrames,
              flipScan.flaggedTimestamps,
            )
          : null;
        if (mountedRef.current) setDetectorAttempts(finalizedDetectorAttempts);
        const processedFrames =
          frameOutput === "detected"
            ? goodFrames
            : constrainSkeleton(
                smoothPoseFrames(
                  fillPersistentGaps(
                    estimateMissingLandmarks(
                      interpolatePoseFrames(goodFrames, allTimestamps),
                      10,
                      5,
                      backend,
                    ),
                    backend,
                  ),
                ),
                goodFrames,
                backend,
              );
        const frames = tagFlipDiscardedFrames(processedFrames, flipScan.flippedTimestamps);

        // Author Holds at scan time in the Run's own video space (Fixed Capture
        // only). The result is persisted with the Run and editable on the
        // Detection Preview; Panning Capture has no single whole-Route frame, so
        // it keeps undefined holds and falls back to the on-the-fly path (ADR 0009).
        const holds: StoredHold[] | undefined = !shouldDetectHolds || panning
          ? undefined
          : detectHoldsVideoSpace(frames, videoMeta.width, videoMeta.height);

        saveAttempt({
          id,
          videoMeta,
          frames,
          holds,
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

        await new Promise<void>((r) => setTimeout(r, 0));

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
            orbCanvas.width = videoWidth;
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
              ? firstPose.keypoints.map((kp) => ({ x: kp.x, y: kp.y }))
              : [];

            let orbFeatures;
            if (cropOptions.climberCrop || wallCropPx) {
              // Prefer user-specified wall crop; fallback to derived wall box.
              // Exclude climber body via pose landmarks remapped to crop-local space.
              const wallBox =
                wallCropPx ?? deriveWallRegion(cropOptions.climberCrop!, videoWidth, videoHeight);
              const croppedData = cropImageData(processedOrbImageData, wallBox);

              // Remap full-frame normalised landmarks into the crop-local space.
              const remapped: NormalizedPoint[] = poseLandmarks
                .map((lm) => ({
                  x: (lm.x * videoWidth - wallBox.x) / wallBox.width,
                  y: (lm.y * videoHeight - wallBox.y) / wallBox.height,
                }))
                .filter((lm) => lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1);

              const croppedFeatures =
                remapped.length >= 3
                  ? extractFeaturesExcludingClimber(cv, croppedData, remapped, false)
                  : extractFeatures(cv, croppedData, false);

              // Offset keypoints back to full-frame pixel coordinates.
              orbFeatures = {
                ...croppedFeatures,
                keypoints: croppedFeatures.keypoints.map((kp) => ({
                  ...kp,
                  pt: { x: kp.pt.x + wallBox.x, y: kp.pt.y + wallBox.y },
                })),
                cropBox: wallBox,
              };
            } else {
              orbFeatures =
                poseLandmarks.length >= 3
                  ? extractFeaturesExcludingClimber(cv, processedOrbImageData, poseLandmarks, false)
                  : extractFeatures(cv, processedOrbImageData, false);
            }

            const thumbSource = shouldGenerateThumbnail
              ? (middleFrameImageData ?? referenceImageData)
              : null;
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
              holds,
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
                const detectedRows = sampledStatus.filter((r) => r.detected);
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
                    detectionRate:
                      sampledStatus.length > 0 ? detected.length / sampledStatus.length : 0,
                    flippedFrames: flipScan.flippedTimestamps.length,
                    keptFrames: kept.length,
                    goodFrames: goodFrames.length,
                    confidence: summarizeMinAvgMax(detectedRows.map((r) => r.avgConfidence)),
                    avgKeypointCount:
                      detectedRows.length > 0
                        ? detectedRows.reduce((s, r) => s + r.keypointCount, 0) /
                          detectedRows.length
                        : 0,
                    limbExpandedFrames,
                    refinement: { gapsRefined, recoveryFramesUsed },
                  },
                  orb: {
                    refKeypointCount: orbFeatures.keypoints.length,
                    keyframeCount: keyframes.length,
                    keyframeKeypoints: summarizeMinAvgMax(
                      keyframes.map((kf) => kf.features.keypoints.length),
                    ),
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
      setOrbPreview(null);
      setCurrentPose(null);
      setCropTrace(null);
      setDetectionFrames(null);
      setDetectorAttempts(null);
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

  return {
    process,
    reset,
    status,
    orbStatus,
    currentFrame,
    totalFrames,
    attemptId,
    firstFrameFile,
    errorMessage,
    scanDiagnostics,
    orbPreview,
    currentPose,
    cropTrace,
    detectionFrames,
    detectorAttempts,
  };
}
