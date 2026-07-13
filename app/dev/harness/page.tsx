"use client";

/**
 * Dev-only detection eval harness — manual calibration pass.
 *
 * Lists the external downloader's Test Video corpus (via /api/dev/corpus) and
 * lets you calibrate each video's Scan Setup — Climber Crop, Wall Crop, tap,
 * panning, Quality Tier — by reusing the production StepSetDetection UI.
 * Confirming (Scan) saves setup.json AND runs one throwaway detection scaffold
 * for authoring Ground Truth, then shows a Detection Preview (the same
 * FramePlayer skeleton overlay + DiagnosticsPanel as the scan flow) to review
 * detection quality and correct landmarks. The scaffold run stays in memory only
 * — calibration never posts a scored run to the downloader (that comes from the
 * separate scoring pass, issue 08). "Save setup only" persists the Setup without
 * running. Dev views (ORB feature points, diagnostics) are open by default here,
 * without touching the app-wide Developer-view preference. Rendered only in
 * development. See docs/adr/0017 and docs/adr/0018.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenCV } from "@/hooks/useOpenCV";
import { usePoseModel, type MediaPipeVariant } from "@/hooks/usePoseModel";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import { getAttempt, type RouteAttempt } from "@/storage/sessionStore";
import StepSetDetection from "@/components/scan/process-flow/StepSetDetection";
import ScanLoadingBar from "@/components/scan/process-flow/ScanLoadingBar";
import FramePlayer, { type FramePlayerHandle } from "@/components/skeleton/FramePlayer";
import DetectionFrameStepper from "@/components/dev/DetectionFrameStepper";
import DiagnosticsPanel from "@/components/dev/DiagnosticsPanel";
import MetadataEditorPanel from "@/components/dev/MetadataEditorPanel";
import LandmarkEditor from "@/components/dev/LandmarkEditor";
import Modal from "@/components/ui/Modal";
import {
  buildGroundTruthScaffold,
  contextKeypointsAt,
} from "@/utils/harnessGroundTruthScaffold";
import {
  loadGroundTruth,
  saveGroundTruth,
  type GroundTruthFrame,
  type GroundTruthInput,
} from "@/utils/harnessGroundTruth";
import { type CropFraction, DEFAULT_CROP } from "@/utils/cropFraction";
import { deriveTapCrop } from "@/pipeline/tracking/tapCropDetection";
import { frameClampCrop, defaultRouteAroundClimber } from "@/utils/cropContainment";
import { DEFAULT_TIER, getTierConfig, type QualityTier } from "@/utils/poseTiers";
import { getTopology } from "@/utils/poseConstants";
import { type SkeletonStyle } from "@/pipeline/overlay/skeletonOverlay";
import type { RenderedSkeletonFrame } from "@/pipeline/overlay/skeletonRenderer";
import type { ScanDiagnostics } from "@/pipeline/analysis/diagnostics";

const IS_DEV = process.env.NODE_ENV === "development";

/** One Test Video bundle, mirroring the /api/dev/corpus response shape. */
interface CorpusItem {
  key: string;
  routeFolder: string;
  videoKey: string;
  title: string | null;
  videoPath: string;
  hasSetup: boolean;
  runCount: number;
  analysisInputs: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

interface FirstFrameSkeleton {
  frames: RenderedSkeletonFrame[];
  duration: number;
  fps: number;
  startOffsetSec: number;
}

/**
 * Build the video-space skeleton animation for the Detection Preview, mirroring
 * the app/scan firstFrameSkeletonData memo: start playback at the first detected
 * frame and map normalised keypoints into video-pixel space.
 */
function buildFirstFrameSkeleton(attempt: RouteAttempt | null): FirstFrameSkeleton | null {
  if (!attempt) return null;
  const { frames, videoMeta } = attempt;
  if (!frames.length) return null;
  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
  const firstDetected = sorted.find((f) => f.keypoints.length > 0);
  if (!firstDetected) return null;
  const firstTs = firstDetected.timestamp;
  const lastTs = sorted[sorted.length - 1].timestamp;
  const duration = Math.max(lastTs - firstTs, 0.1);
  const rendered: RenderedSkeletonFrame[] = sorted
    .filter((f) => f.timestamp >= firstTs)
    .map((f) => ({
      timestamp: f.timestamp - firstTs,
      keypoints: Object.fromEntries(
        f.keypoints.map((kp) => [
          kp.name,
          { x: kp.x * videoMeta.width, y: kp.y * videoMeta.height },
        ]),
      ),
    }));
  return { frames: rendered, duration, fps: videoMeta.fps ?? 30, startOffsetSec: firstTs };
}

/** Soft fallback Climber box centred on the tap when no pose is found. */
function defaultClimberBox(point: { x: number; y: number }): CropFraction {
  const w = 0.25;
  const h = 0.55;
  return {
    x: clamp01(point.x - w / 2),
    y: clamp01(point.y - h / 2),
    w: Math.min(w, 1 - clamp01(point.x - w / 2)),
    h: Math.min(h, 1 - clamp01(point.y - h / 2)),
  };
}

function findFrameIndexByTime(frames: { timestamp: number }[], time: number): number {
  if (frames.length === 0) return 0;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].timestamp <= time) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo].timestamp <= time ? lo : 0;
}

export default function HarnessPage() {
  const { cv } = useOpenCV();

  const [items, setItems] = useState<CorpusItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CorpusItem | null>(null);

  const refreshList = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch("/api/dev/corpus");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load corpus.");
      setItems(body.items as CorpusItem[]);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (IS_DEV) void refreshList();
  }, [refreshList]);

  if (!IS_DEV) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-fg-muted">
          The detection eval harness is only available in development.
        </p>
      </main>
    );
  }

  if (selected) {
    return (
      <Calibrator
        item={selected}
        cv={cv}
        cvReady={!!cv}
        onBack={() => setSelected(null)}
        onDone={async () => {
          await refreshList();
          setSelected(null);
        }}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-fg">Detection eval harness</h1>
          <p className="text-sm text-fg-muted">
            Calibrate each Test Video&apos;s Scan Setup, then re-run detection in batch.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshList()}
          className="rounded-md bg-surface-alt px-3 py-1.5 text-sm text-fg"
        >
          Refresh
        </button>
      </header>

      {listError && (
        <p className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
          {listError}
        </p>
      )}

      {items === null ? (
        <p className="text-sm text-fg-muted">Loading corpus…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No Test Videos found. Check that HARNESS_ANALYSIS_ROOT points at the downloader&apos;s
          analysis folder.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge/40 text-left text-fg-muted">
                <th className="py-2 pr-3 font-medium">route / video</th>
                <th className="py-2 pr-3 font-medium">title</th>
                <th className="py-2 pr-3 font-medium">setup</th>
                <th className="py-2 pr-3 font-medium tabular-nums">runs</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} className="border-b border-edge/20 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-fg">{it.routeFolder}</div>
                    <div className="font-mono text-xs text-fg-muted">{it.videoKey}</div>
                  </td>
                  <td className="max-w-xs py-2 pr-3 text-fg-muted">{it.title ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {it.hasSetup ? (
                      <span className="rounded bg-send-surface px-1.5 py-0.5 text-xs text-send">
                        calibrated
                      </span>
                    ) : (
                      <span className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution">
                        pending
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-fg">{it.runCount}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(it)}
                      className="rounded-md bg-send/80 px-3 py-1.5 text-xs font-medium text-fg-inverse"
                    >
                      {it.hasSetup ? "Re-calibrate" : "Calibrate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Calibrator — loads a Test Video + its Setup, reuses StepSetDetection to
// author the Scan Setup, and on confirm saves it and runs one throwaway
// detection scaffold used only to author Ground Truth. No scored run is posted.
// ---------------------------------------------------------------------------

type RunPhase = "idle" | "saving" | "running" | "preview" | "done" | "error";

function Calibrator({
  item,
  cv,
  cvReady,
  onBack,
  onDone,
}: {
  item: CorpusItem;
  cv: CV;
  cvReady: boolean;
  onBack: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [phaseError, setPhaseError] = useState<string | null>(null);

  // Post-scan review state (Detection Preview).
  const [previewAttempt, setPreviewAttempt] = useState<RouteAttempt | null>(null);
  const [previewDiag, setPreviewDiag] = useState<ScanDiagnostics | null>(null);
  const previewPlayerRef = useRef<FramePlayerHandle>(null);
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0);

  const [tier, setTier] = useState<QualityTier>(DEFAULT_TIER);
  const [modelVariant, setModelVariant] = useState<MediaPipeVariant>(
    getTierConfig(DEFAULT_TIER).variant,
  );
  const [maxPoses, setMaxPoses] = useState(getTierConfig(DEFAULT_TIER).maxPoses);
  const [frameStep, setFrameStep] = useState(getTierConfig(DEFAULT_TIER).frameStep);
  const [climberCrop, setClimberCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [wallCrop, setWallCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [climberPoint, setClimberPoint] = useState<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const wallTouchedRef = useRef(false);

  // Editable video metadata (analysis_inputs) — seeded from the corpus passthrough.
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [analysisInputs, setAnalysisInputs] = useState<unknown>(item.analysisInputs);

  // Ground Truth authoring (issue 04): the pure scaffold seed (drift baseline),
  // the working GT being edited, and any previously-saved GT preserved across a
  // re-scan. `gtMode` swaps the Detection Preview for the landmark editor.
  const existingGtRef = useRef<GroundTruthInput | null>(null);
  const [gtSeed, setGtSeed] = useState<GroundTruthInput | null>(null);
  const [gtInput, setGtInput] = useState<GroundTruthInput | null>(null);
  const [gtMode, setGtMode] = useState(false);
  const [gtSave, setGtSave] = useState<{ ok: boolean; message: string } | null>(null);
  const [gtSaving, setGtSaving] = useState(false);

  const poseModelConfig = useMemo(
    () => ({ backend: "mediapipe" as const, variant: modelVariant, maxPoses }),
    [modelVariant, maxPoses],
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

  // Detection Preview: show the per-frame Adaptive Crop overlay (default on).
  const [showCrops, setShowCrops] = useState(true);
  const previewFrames = useMemo(() => detectionFrames ?? [], [detectionFrames]);

  useEffect(() => {
    if (phase !== "preview") return;
    setPreviewPlaying(true);
    setPreviewFrameIndex(0);
  }, [phase, previewFrames]);

  useEffect(() => {
    // In GT edit mode the FramePlayer is unmounted; the stepper drives the index
    // directly, so skip the player-time sync (which would force the index to 0).
    if (phase !== "preview" || gtMode || previewFrames.length === 0) return;
    let raf = 0;

    const syncCurrentFrame = () => {
      const playerTime = previewPlayerRef.current?.getCurrentTime() ?? 0;
      const nextIndex = findFrameIndexByTime(previewFrames, playerTime);
      setPreviewFrameIndex((prev) => (prev === nextIndex ? prev : nextIndex));
      raf = requestAnimationFrame(syncCurrentFrame);
    };

    raf = requestAnimationFrame(syncCurrentFrame);
    return () => cancelAnimationFrame(raf);
  }, [phase, gtMode, previewFrames]);

  const handlePreviewSeek = useCallback(
    (index: number) => {
      const frame = previewFrames[index];
      if (!frame) return;
      setPreviewPlaying(false);
      setPreviewFrameIndex(index);
      previewPlayerRef.current?.pause();
      previewPlayerRef.current?.seek(frame.timestamp);
    },
    [previewFrames],
  );

  const handlePreviewTogglePlay = useCallback(() => {
    setPreviewPlaying((playing) => {
      const next = !playing;
      if (next) previewPlayerRef.current?.play();
      else previewPlayerRef.current?.pause();
      return next;
    });
  }, []);

  function handleTierChange(t: QualityTier) {
    setTier(t);
    const cfg = getTierConfig(t);
    setModelVariant(cfg.variant);
    setFrameStep(cfg.frameStep);
    setMaxPoses(cfg.maxPoses);
  }

  // Load the video bytes + any existing Scan Setup for this bundle.
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

        const { setup } = await setupRes.json();
        if (setup && !revoked) {
          setClimberCrop(setup.climberCrop ?? DEFAULT_CROP);
          setWallCrop(setup.wallCrop ?? DEFAULT_CROP);
          setClimberPoint(setup.climberPoint ?? null);
          setPanning(!!setup.panning);
          if (typeof setup.qualityTier === "string")
            handleTierChange(setup.qualityTier as QualityTier);
          wallTouchedRef.current = true; // preserve the saved wall crop across a re-tap
        }

        // Any previously-authored Ground Truth is preserved across the next scan.
        try {
          const gt = await loadGroundTruth(item.key);
          if (!revoked) existingGtRef.current = gt;
        } catch {
          if (!revoked) existingGtRef.current = null;
        }
      } catch (err) {
        if (!revoked) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.key, item.videoKey]);

  const handleClimberTapDetect = useCallback(
    (frame: ImageData, point: { x: number; y: number }, timestampSec: number): boolean => {
      const derived = model ? deriveTapCrop(model, frame, point, timestampSec) : null;
      const climber = derived ?? defaultClimberBox(point);
      setClimberCrop(climber);
      setWallCrop((prev) => (wallTouchedRef.current ? prev : defaultRouteAroundClimber(climber)));
      return derived != null;
    },
    [model],
  );

  const handleClimberPointChange = useCallback((p: { x: number; y: number } | null) => {
    if (p === null) wallTouchedRef.current = false;
    setClimberPoint(p);
  }, []);

  const handleWallCropChange = useCallback((c: CropFraction) => {
    wallTouchedRef.current = true;
    setWallCrop(frameClampCrop(c));
  }, []);

  /** PUT setup.json; returns the authoritative setupHash, or null on failure. */
  const saveSetup = useCallback(async (): Promise<string | null> => {
    const res = await fetch(`/api/dev/corpus/setup?key=${encodeURIComponent(item.key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ climberCrop, wallCrop, climberPoint, panning, qualityTier: tier }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Failed to save setup.");
    return body.setup?.setupHash ?? null;
  }, [item.key, climberCrop, wallCrop, climberPoint, panning, tier]);

  // Save the Setup only, without a baseline run (quick calibration).
  async function handleSaveOnly() {
    setPhase("saving");
    setPhaseError(null);
    try {
      await saveSetup();
      setPhase("done");
      await onDone();
    } catch (err) {
      setPhase("error");
      setPhaseError(err instanceof Error ? err.message : String(err));
    }
  }

  // Confirm: save the Setup, then run one throwaway detection scaffold (the
  // effect below hands the result to the Ground Truth editor once the pipeline
  // finishes). Nothing is posted as a scored run.
  async function handleConfirmAndRun() {
    if (!videoFile || !model || !cv) return;
    setPhase("saving");
    setPhaseError(null);
    try {
      await saveSetup();
      setPhase("running");
      const cfg = getTierConfig(tier);
      await process(
        videoFile,
        model,
        cv,
        frameStep,
        { state: "", area: "", route: item.routeFolder },
        { climberCrop, wallCrop, climberPoint: climberPoint ?? undefined, panning },
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
          frameOutput: "detected",
          detectHolds: false,
          generateThumbnail: false,
        },
      );
    } catch (err) {
      setPhase("error");
      setPhaseError(err instanceof Error ? err.message : String(err));
    }
  }

  // Hand the scaffold run to the Detection Preview once the pipeline has produced
  // diagnostics (assembled only after ORB extraction completes). The run lives in
  // memory for Ground Truth authoring; calibration never posts a scored run.
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

    const attempt = attemptId ? (getAttempt(attemptId) ?? null) : null;
    setPreviewAttempt(attempt);
    setPreviewDiag(scanDiagnostics);
    setPhase("preview");
  }, [phase, status, orbStatus, scanDiagnostics, attemptId, errorMessage]);

  // On entering the preview, seed Ground Truth from the scaffold detection: a pure
  // scaffold (the drift baseline) and a working copy that preserves any previously
  // authored GT. Both key one record per Detection Frame.
  useEffect(() => {
    if (phase !== "preview" || !previewAttempt) return;
    const pureScaffold = buildGroundTruthScaffold(previewFrames, previewAttempt.frames, null);
    const working = buildGroundTruthScaffold(
      previewFrames,
      previewAttempt.frames,
      existingGtRef.current,
    );
    setGtSeed(pureScaffold);
    setGtInput(working);
    setGtSave(null);
  }, [phase, previewAttempt, previewFrames]);

  // Update the current Detection Frame's Ground Truth (marks it verified).
  const editGtFrame = useCallback((index: number, patch: Partial<GroundTruthFrame>) => {
    setGtInput((prev) => {
      if (!prev) return prev;
      return {
        frames: prev.frames.map((f) =>
          f.frameIndex === index ? { ...f, ...patch, verified: true } : f,
        ),
      };
    });
    setGtSave(null);
  }, []);

  const handleSaveGt = useCallback(async () => {
    if (!gtInput) return;
    setGtSaving(true);
    setGtSave(null);
    try {
      await saveGroundTruth(item.key, gtInput);
      existingGtRef.current = gtInput;
      setGtSave({ ok: true, message: "Ground Truth saved." });
    } catch (err) {
      setGtSave({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setGtSaving(false);
    }
  }, [gtInput, item.key]);

  // Return to calibration from the preview, keeping the current Setup in place.
  function handleRescan() {
    setPreviewAttempt(null);
    setPreviewDiag(null);
    setPhaseError(null);
    setGtMode(false);
    setPhase("idle");
  }

  // Abort an in-flight scan from the progress view and return to calibration.
  function handleCancelRun() {
    resetProcessor();
    setPhaseError(null);
    setPhase("idle");
  }

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-danger">{loadError}</p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md bg-surface-alt px-3 py-1.5 text-sm text-fg"
        >
          Back to corpus
        </button>
      </main>
    );
  }

  if (!videoUrl) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-fg-muted">Loading {item.videoKey}…</p>
      </main>
    );
  }

  // ── In-scan progress: harness uses a low-overhead progress shell only ──
  if (phase === "running") {
    const pct = totalFrames > 0 ? Math.min(100, Math.round((currentFrame / totalFrames) * 100)) : 0;
    const finishing = status === "done" || (totalFrames > 0 && currentFrame >= totalFrames);
    return (
      <div className="relative flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
        <div className="absolute inset-x-0 top-0 z-10">
          <ScanLoadingBar progressPct={pct} finishing={finishing} />
        </div>
        <section className="flex h-full min-h-0 flex-col" aria-label="Scanning Test Video">
          <header className="shrink-0 border-b border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
            <div className="mx-auto flex h-7 w-full max-w-5xl items-center gap-3">
              <span className="text-sm font-medium text-fg">Scanning Test Video</span>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 items-center justify-center bg-surface px-6">
            <div className="flex w-full max-w-md flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-fg-secondary">
                  {finishing ? "Preparing results" : "Detecting frames"}
                </span>
                <span className="text-sm font-semibold tabular-nums text-fg">{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-edge/30" aria-hidden="true">
                <div
                  className="h-full bg-send transition-[width] duration-200"
                  style={{ width: `${finishing ? 100 : pct}%` }}
                />
              </div>
              <p className="font-mono text-xs text-fg-muted">
                {currentFrame} / {totalFrames || "?"} sampled frames
              </p>
            </div>
          </div>

          <footer className="shrink-0 border-t border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-start">
              <button
                type="button"
                onClick={handleCancelRun}
                className="rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
              >
                Cancel scan
              </button>
            </div>
          </footer>
        </section>
      </div>
    );
  }

  // ── Post-scan Detection Preview (review only; the run is already posted) ──
  if (phase === "preview") {
    const skel = buildFirstFrameSkeleton(previewAttempt);
    const topo = getTopology(previewAttempt?.poseBackend ?? "mediapipe");
    const topoStyle: SkeletonStyle = {
      skeletonEdges: topo.skeletonEdges,
      keypointNames: topo.keypointNames,
    };
    const orbKeypoints = previewAttempt?.orbFeatures?.keypoints.map((kp) => kp.pt);
    const gtFrame = gtInput?.frames.find((f) => f.frameIndex === previewFrameIndex) ?? null;
    const gtSeedFrame = gtSeed?.frames.find((f) => f.frameIndex === previewFrameIndex) ?? null;

    return (
      <div className="flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-fg">{item.routeFolder}</div>
            <div className="truncate font-mono text-xs text-fg-muted">{item.videoKey}</div>
          </div>
          <div className="flex items-center gap-2">
            {gtMode && gtSave && (
              <span
                className={`max-w-xs truncate text-xs ${gtSave.ok ? "text-send" : "text-danger"}`}
              >
                {gtSave.message}
              </span>
            )}
            {!gtMode && (
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={showCrops}
                  onChange={(e) => setShowCrops(e.target.checked)}
                  className="accent-accent"
                />
                Crops
              </label>
            )}
            <button
              type="button"
              onClick={() => setGtMode((v) => !v)}
              disabled={!gtInput}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                gtMode ? "bg-accent text-fg-inverse" : "bg-surface-alt text-fg"
              }`}
            >
              {gtMode ? "Editing GT" : "Edit Ground Truth"}
            </button>
            {gtMode && (
              <button
                type="button"
                onClick={() => void handleSaveGt()}
                disabled={gtSaving || !gtInput}
                className="shrink-0 rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse disabled:opacity-50"
              >
                {gtSaving ? "Saving…" : "Save Ground Truth"}
              </button>
            )}
            <button
              type="button"
              onClick={handleRescan}
              className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
            >
              Re-scan
            </button>
            <button
              type="button"
              onClick={() => void onDone()}
              className="shrink-0 rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse"
            >
              Back to corpus
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 bg-surface p-3">
          <DetectionFrameStepper
            frames={previewFrames}
            currentIndex={previewFrameIndex}
            onSeek={handlePreviewSeek}
            onTogglePlay={handlePreviewTogglePlay}
            isPlaying={previewPlaying}
            className="shrink-0"
          />
          {gtMode && gtFrame && previewAttempt ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-edge/30 bg-surface p-3">
              <LandmarkEditor
                videoSrc={videoUrl}
                videoWidth={previewAttempt.videoMeta.width}
                videoHeight={previewAttempt.videoMeta.height}
                frame={gtFrame}
                seedJoints={gtSeedFrame?.joints ?? {}}
                contextKeypoints={contextKeypointsAt(previewAttempt.frames, gtFrame.timestamp)}
                onEditJoints={(joints) =>
                  editGtFrame(gtFrame.frameIndex, { joints, state: "present" })
                }
                onAccept={() => editGtFrame(gtFrame.frameIndex, {})}
              />
            </div>
          ) : (
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-edge/30 bg-surface">
              {firstFrameFile && skel ? (
                <FramePlayer
                  ref={previewPlayerRef}
                  imageFile={firstFrameFile}
                  videoSrc={videoUrl}
                  videoTimeOffset={skel.startOffsetSec}
                  layers={[{ frames: skel.frames, style: topoStyle }]}
                  duration={skel.duration}
                  autoPlay
                  hidePlayButton
                  orbKeypoints={orbKeypoints}
                  cropTrace={showCrops ? cropTrace : undefined}
                  fit="contain"
                  bare
                  className="min-h-0 flex-1 rounded-none"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-center text-sm text-fg-muted">
                  No climber detected — the Detection Preview has nothing to show. See the
                  diagnostics for why.
                </div>
              )}
              <DiagnosticsPanel record={previewDiag} defaultOpen />
            </div>
          )}
        </div>
      </div>
    );
  }

  // running / preview return earlier, so only "saving" is busy here.
  const busy = phase === "saving";
  const phaseLabel: Record<RunPhase, string> = {
    idle: "",
    saving: "Saving setup…",
    running: "Running detection…",
    preview: "",
    done: "Setup saved",
    error: phaseError ?? "Error",
  };

  return (
    <div className="flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{item.routeFolder}</div>
          <div className="truncate font-mono text-xs text-fg-muted">{item.videoKey}</div>
        </div>
        <div className="flex items-center gap-2">
          {phase !== "idle" && (
            <span className={`text-xs ${phase === "error" ? "text-danger" : "text-fg-muted"}`}>
              {phaseLabel[phase]}
            </span>
          )}
          <button
            type="button"
            onClick={() => setMetadataOpen(true)}
            className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
          >
            Metadata
          </button>
          <button
            type="button"
            onClick={() => void handleSaveOnly()}
            disabled={busy}
            className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:opacity-50"
          >
            Save setup only
          </button>
        </div>
      </div>

      <Modal
        open={metadataOpen}
        onClose={() => setMetadataOpen(false)}
        ariaLabel="Edit video metadata"
        panelClassName=""
      >
        <MetadataEditorPanel
          bundleKey={item.key}
          initial={analysisInputs}
          onClose={() => setMetadataOpen(false)}
          onSaved={setAnalysisInputs}
        />
      </Modal>

      <div className="min-h-0 flex-1">
        <StepSetDetection
          videoPreviewUrl={videoUrl}
          climberCrop={climberCrop}
          wallCrop={wallCrop}
          onClimberCropChange={setClimberCrop}
          onWallCropChange={handleWallCropChange}
          climberPoint={climberPoint}
          onClimberPointChange={handleClimberPointChange}
          onClimberTapDetect={handleClimberTapDetect}
          tier={tier}
          onTierChange={handleTierChange}
          modelVariant={modelVariant}
          onModelVariantChange={setModelVariant}
          frameStep={frameStep}
          onFrameStepChange={setFrameStep}
          panning={panning}
          onPanningChange={setPanning}
          canScan={!!model && cvReady && !busy}
          onScan={() => void handleConfirmAndRun()}
          onBack={onBack}
        />
      </div>
    </div>
  );
}
