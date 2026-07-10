"use client";

/**
 * Dev-only detection eval harness — manual calibration pass.
 *
 * Lists the external downloader's Test Video corpus (via /api/dev/corpus) and
 * lets you calibrate each video's Scan Setup — Climber Crop, Wall Crop, tap,
 * panning, Quality Tier — by reusing the production StepSetDetection UI.
 * Confirming (Scan) saves setup.json AND runs one baseline detection, relaying
 * the pose + orb run to the downloader. "Save setup only" persists the Setup
 * without running. Rendered only in development. See docs/adr/0017.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenCV } from "@/hooks/useOpenCV";
import { usePoseModel, type MediaPipeVariant } from "@/hooks/usePoseModel";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import { getAttempt } from "@/storage/sessionStore";
import StepSetDetection from "@/components/scan/process-flow/StepSetDetection";
import { type CropFraction, DEFAULT_CROP } from "@/utils/cropFraction";
import { deriveTapCrop } from "@/pipeline/tracking/tapCropDetection";
import { frameClampCrop, defaultRouteAroundClimber } from "@/utils/cropContainment";
import { DEFAULT_TIER, getTierConfig, type QualityTier } from "@/utils/poseTiers";
import { buildHarnessPayloads } from "@/utils/harnessPayloads";

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
        <p className="text-fg-muted">The detection eval harness is only available in development.</p>
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
                      <span className="rounded bg-send-surface px-1.5 py-0.5 text-xs text-send">calibrated</span>
                    ) : (
                      <span className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution">pending</span>
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
// author the Scan Setup, and on confirm saves it and runs one baseline
// detection, relaying the run to the downloader.
// ---------------------------------------------------------------------------

type RunPhase = "idle" | "saving" | "running" | "posting" | "done" | "error";

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
  const setupHashRef = useRef<string | null>(null);

  const [tier, setTier] = useState<QualityTier>(DEFAULT_TIER);
  const [modelVariant, setModelVariant] = useState<MediaPipeVariant>(getTierConfig(DEFAULT_TIER).variant);
  const [maxPoses, setMaxPoses] = useState(getTierConfig(DEFAULT_TIER).maxPoses);
  const [frameStep, setFrameStep] = useState(getTierConfig(DEFAULT_TIER).frameStep);
  const [climberCrop, setClimberCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [wallCrop, setWallCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [climberPoint, setClimberPoint] = useState<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const wallTouchedRef = useRef(false);

  const poseModelConfig = useMemo(
    () => ({ backend: "mediapipe" as const, variant: modelVariant, maxPoses }),
    [modelVariant, maxPoses],
  );
  const { model } = usePoseModel(poseModelConfig);
  const { process, status, orbStatus, scanDiagnostics, attemptId, errorMessage } = useVideoProcessor(100);

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
          if (typeof setup.qualityTier === "string") handleTierChange(setup.qualityTier as QualityTier);
          wallTouchedRef.current = true; // preserve the saved wall crop across a re-tap
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

  // Confirm: save the Setup, then run one baseline detection (the effect below
  // relays the result once the pipeline finishes).
  async function handleConfirmAndRun() {
    if (!videoFile || !model || !cv) return;
    setPhase("saving");
    setPhaseError(null);
    try {
      setupHashRef.current = await saveSetup();
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
      );
    } catch (err) {
      setPhase("error");
      setPhaseError(err instanceof Error ? err.message : String(err));
    }
  }

  // Relay the run once the pipeline has produced diagnostics (which are assembled
  // only after ORB extraction completes).
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

    const attempt = attemptId ? getAttempt(attemptId) : undefined;
    const { pose, orb } = buildHarnessPayloads({
      diagnostics: scanDiagnostics,
      frames: attempt?.frames ?? [],
      referenceFrameMeta: attempt?.referenceFrameMeta ?? null,
      setupHash: setupHashRef.current ?? "",
    });

    setPhase("posting");
    (async () => {
      try {
        const res = await fetch("/api/dev/detections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ video_path: item.videoPath, pose, orb }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to relay detection run.");
        setPhase("done");
        await onDone();
      } catch (err) {
        setPhase("error");
        setPhaseError(err instanceof Error ? err.message : String(err));
      }
    })();
    // onDone is stable enough for a dev tool; exclude to avoid re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, status, orbStatus, scanDiagnostics, attemptId, errorMessage, item.videoPath]);

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-danger">{loadError}</p>
        <button type="button" onClick={onBack} className="rounded-md bg-surface-alt px-3 py-1.5 text-sm text-fg">
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

  const busy = phase === "saving" || phase === "running" || phase === "posting";
  const phaseLabel: Record<RunPhase, string> = {
    idle: "",
    saving: "Saving setup…",
    running: "Running detection…",
    posting: "Posting run…",
    done: "Saved + run posted",
    error: phaseError ?? "Error",
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
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
            onClick={() => void handleSaveOnly()}
            disabled={busy}
            className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:opacity-50"
          >
            Save setup only
          </button>
        </div>
      </div>

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
  );
}
