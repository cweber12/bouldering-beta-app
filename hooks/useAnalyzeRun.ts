"use client";

/**
 * The Analyze run lifecycle, shared by the per-video Analyze view and the batch
 * sweep so both post byte-identical runs: load the Test Video bytes + Scan
 * Setup + any accepted Ground Truth, run the production scan path with the
 * saved Setup (dev-output toggles only — every detection knob comes from the
 * tier, exactly as the user-facing flow resolves it), score the completed run
 * over the probed-frame domain, and post it append-only through the detections
 * relay stamped with `appVersion` + `setupHash` + `groundTruthHash`.
 *
 * The hook owns the load / run / score / post state machine; presentation
 * (players, filmstrips, verdict panels) stays in the components on top of it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenCV } from "@/hooks/useOpenCV";
import { usePoseModel } from "@/hooks/usePoseModel";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import { getAttempt, type RouteAttempt } from "@/storage/sessionStore";
import { buildHarnessPayloads, postDetectionRun } from "@/utils/harnessPayloads";
import { loadGroundTruth, type GroundTruth } from "@/utils/harnessGroundTruth";
import { truthIsStale } from "@/utils/harnessFreshness";
import {
  detectorEvidenceFrames,
  scoreRunAgainstGroundTruth,
  type DetectionScoring,
} from "@/utils/harnessScoring";
import { type CropFraction, DEFAULT_CROP } from "@/utils/cropFraction";
import { DEFAULT_TIER, getTierConfig, type QualityTier } from "@/utils/poseTiers";
import type { ScanDiagnostics } from "@/pipeline/analysis/diagnostics";
import type { CropTrace } from "@/utils/cropTrace";

/** The corpus fields an Analyze run needs. */
export interface AnalyzeRunItem {
  key: string;
  routeFolder: string;
  videoKey: string;
  videoPath: string;
}

/** The Scan Setup the run replays, as loaded from `setup.json`. */
export interface LoadedSetup {
  climberCrop: CropFraction;
  wallCrop: CropFraction;
  climberPoint: { x: number; y: number; t?: number } | null;
  panning: boolean;
  tier: QualityTier;
  setupHash: string;
}

export type AnalyzePhase = "idle" | "running" | "result" | "error";

export interface AnalyzePostState {
  status: "idle" | "posting" | "posted" | "failed";
  message: string;
}

export interface AnalyzeRun {
  /** Loading the video / Setup / Ground Truth trio. */
  loading: boolean;
  loadError: string | null;
  videoUrl: string | null;
  setup: LoadedSetup | null;
  groundTruth: GroundTruth | null;
  /**
   * The saved truth stamps an older calibration's setupHash than the Setup this
   * run replays — the run cannot pair with it, so it renders and posts unscored
   * (matching the harness's evaluate pairing rule).
   */
  truthStale: boolean;
  /** Everything needed to start a run is in hand. */
  ready: boolean;
  phase: AnalyzePhase;
  phaseError: string | null;
  post: AnalyzePostState;
  /** The completed run (null before `phase === "result"`). */
  runAttempt: RouteAttempt | null;
  runDiag: ScanDiagnostics | null;
  /** Probed-frame scoring vs Ground Truth; null when the video has no truth. */
  scoring: DetectionScoring | null;
  /** The base-stride detection-frame timeline (the filmstrip's rows). */
  runFrames: { timestamp: number; status: "detected" | "weak" | "missing" | "flip" }[];
  cropTrace: CropTrace | null;
  firstFrameFile: File | null;
  currentFrame: number;
  totalFrames: number;
  processorStatus: "idle" | "processing" | "done" | "error";
  /** Start (or restart) a run. No-op until `ready`. */
  run: () => Promise<void>;
  /** Abort an in-flight run and return to idle. */
  cancel: () => void;
}

/**
 * Drive one Test Video's Analyze run. `onPosted` fires after each successful
 * post (the corpus run count changed); it is held in a ref so callers may pass
 * a fresh closure every render without re-triggering the post effect.
 */
export function useAnalyzeRun(
  item: AnalyzeRunItem,
  onPosted?: () => void | Promise<void>,
): AnalyzeRun {
  const { cv } = useOpenCV();

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [setup, setSetup] = useState<LoadedSetup | null>(null);
  const [groundTruth, setGroundTruth] = useState<GroundTruth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [phase, setPhase] = useState<AnalyzePhase>("idle");
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [post, setPost] = useState<AnalyzePostState>({ status: "idle", message: "" });

  const [runAttempt, setRunAttempt] = useState<RouteAttempt | null>(null);
  const [runDiag, setRunDiag] = useState<ScanDiagnostics | null>(null);
  // Each run posts exactly once: the effect that posts watches state that keeps
  // changing after the run lands, so the posted run's id is what gates it.
  const postedRunRef = useRef<string | null>(null);
  const onPostedRef = useRef(onPosted);
  onPostedRef.current = onPosted;

  const tierConfig = getTierConfig(setup?.tier ?? DEFAULT_TIER);
  const poseModelConfig = useMemo(
    () => ({
      backend: "mediapipe" as const,
      variant: tierConfig.variant,
      maxPoses: tierConfig.maxPoses,
    }),
    [tierConfig.variant, tierConfig.maxPoses],
  );
  const { model } = usePoseModel(poseModelConfig);
  const {
    process,
    reset: resetProcessor,
    status,
    orbStatus,
    scanDiagnostics,
    attemptId,
    errorMessage,
    firstFrameFile,
    currentFrame,
    totalFrames,
    cropTrace,
    detectionFrames,
  } = useVideoProcessor(100);

  const runFrames = useMemo(() => detectionFrames ?? [], [detectionFrames]);

  // The truth pairs with this run only when its stamped hash matches the Setup
  // being replayed (legacy truth without a hash falls back to the Setup). Stale
  // truth must not be scored against: the harness would skip the pair anyway,
  // and a local score would fabricate evidence the evaluation never sees.
  const truthStale =
    !!groundTruth && !!setup && truthIsStale(groundTruth.setupHash, setup.setupHash);

  // Scoring vs Ground Truth over the probed-frame domain: the base-timeline
  // probes (missing / flip-discarded included) plus raw detector-evidence frames
  // from Adaptive Refinement. The posted payload may be dense/interpolated for
  // corpus diagnostics, but scoring must not let inferred continuity widen the
  // probed domain or count as detector evidence.
  const scoring = useMemo(() => {
    if (!groundTruth || !runAttempt || truthStale) return null;
    return scoreRunAgainstGroundTruth({
      groundTruth,
      run: { probes: runFrames, frames: detectorEvidenceFrames(runAttempt.frames) },
    });
  }, [groundTruth, runAttempt, runFrames, truthStale]);

  // Load the video bytes + the Scan Setup the run will replay + any truth.
  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    (async () => {
      setLoadError(null);
      try {
        const [vidRes, setupRes] = await Promise.all([
          fetch(`/api/dev/corpus/video?key=${encodeURIComponent(item.key)}`),
          fetch(`/api/dev/corpus/setup?key=${encodeURIComponent(item.key)}`),
        ]);
        if (!vidRes.ok) throw new Error("Failed to load video.");
        const blob = await vidRes.blob();
        url = URL.createObjectURL(blob);
        if (revoked) return;
        setVideoUrl(url);
        setVideoFile(new File([blob], `${item.videoKey}.mp4`, { type: "video/mp4" }));

        // Accepted truth is optional: without it the run renders + posts
        // unscored, so a truth-load failure must never block Analyze.
        try {
          const truth = await loadGroundTruth(item.key);
          if (!revoked) setGroundTruth(truth);
        } catch {
          if (!revoked) setGroundTruth(null);
        }

        const { setup: saved } = await setupRes.json();
        if (revoked) return;
        if (saved) {
          setSetup({
            climberCrop: saved.climberCrop ?? DEFAULT_CROP,
            wallCrop: saved.wallCrop ?? DEFAULT_CROP,
            climberPoint: saved.climberPoint ?? null,
            panning: !!saved.panning,
            tier: (saved.qualityTier as QualityTier) ?? DEFAULT_TIER,
            setupHash: typeof saved.setupHash === "string" ? saved.setupHash : "",
          });
        }
      } catch (err) {
        if (!revoked) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!revoked) setLoading(false);
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.key, item.videoKey]);

  // Run the production scan path against the saved Setup. The only options
  // passed are dev-output toggles; every detection knob comes from the tier the
  // Setup was calibrated with, exactly as the user-facing flow resolves it.
  const run = useCallback(async () => {
    if (!videoFile || !model || !cv || !setup) return;
    setPhase("running");
    setPhaseError(null);
    setRunAttempt(null);
    setRunDiag(null);
    setPost({ status: "idle", message: "" });
    postedRunRef.current = null;
    try {
      const cfg = getTierConfig(setup.tier);
      await process(
        videoFile,
        model,
        cv,
        cfg.frameStep,
        { state: "", area: "", route: item.routeFolder },
        {
          climberCrop: setup.climberCrop,
          wallCrop: setup.wallCrop,
          climberPoint: setup.climberPoint ?? undefined,
          panning: setup.panning,
        },
        0,
        "mediapipe",
        {
          maxRecoveryFrames: cfg.maxRecoveryFrames,
          filterTolerance: cfg.filterTolerance,
          motionThreshold: cfg.motionThreshold,
          refineStride: cfg.refineStride,
        },
        {
          emitLivePreview: false,
          frameOutput: "interpolated",
          detectHolds: false,
          generateThumbnail: false,
        },
      );
    } catch (err) {
      setPhase("error");
      setPhaseError(err instanceof Error ? err.message : String(err));
    }
  }, [videoFile, model, cv, setup, process, item.routeFolder]);

  // Hand the completed run to the result phase once the pipeline has produced
  // diagnostics (assembled only after ORB extraction completes).
  useEffect(() => {
    if (phase !== "running") return;
    if (status === "error") {
      setPhase("error");
      setPhaseError(errorMessage ?? "Detection failed.");
      return;
    }
    if (status !== "done") return;
    if (!scanDiagnostics) {
      // "done" fires before ORB/diagnostics; only treat as failure once ORB has.
      if (orbStatus === "failed") {
        setPhase("error");
        setPhaseError("ORB extraction failed — no diagnostics produced.");
      }
      return;
    }
    setRunAttempt(attemptId ? (getAttempt(attemptId) ?? null) : null);
    setRunDiag(scanDiagnostics);
    setPhase("result");
  }, [phase, status, orbStatus, scanDiagnostics, attemptId, errorMessage]);

  // Post the completed run append-only, stamped with the setupHash it replayed
  // and the groundTruthHash it was scored against (appVersion rides inside the
  // diagnostics record). One POST per run.
  useEffect(() => {
    if (phase !== "result" || !runDiag || !setup) return;
    if (postedRunRef.current === runDiag.scanId) return;
    postedRunRef.current = runDiag.scanId;
    let cancelled = false;
    setPost({ status: "posting", message: "Posting run…" });
    void (async () => {
      try {
        const { pose, orb } = buildHarnessPayloads({
          diagnostics: runDiag,
          frames: runAttempt?.frames ?? [],
          referenceFrameMeta: runAttempt?.referenceFrameMeta ?? null,
          setupHash: setup.setupHash,
          scoring,
        });
        await postDetectionRun({ videoPath: item.videoPath, pose, orb });
        if (cancelled) return;
        setPost({ status: "posted", message: "Run posted." });
        await onPostedRef.current?.();
      } catch (err) {
        if (cancelled) return;
        setPost({
          status: "failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, runDiag, runAttempt, setup, scoring, item.videoPath]);

  const cancel = useCallback(() => {
    resetProcessor();
    setPhaseError(null);
    setPhase("idle");
  }, [resetProcessor]);

  return {
    loading,
    loadError,
    videoUrl,
    setup,
    groundTruth,
    truthStale,
    ready: !!model && !!cv && !!setup && !!videoFile,
    phase,
    phaseError,
    post,
    runAttempt,
    runDiag,
    scoring,
    runFrames,
    cropTrace,
    firstFrameFile,
    currentFrame,
    totalFrames,
    processorStatus: status,
    run,
    cancel,
  };
}
