"use client";

/**
 * Dev-only Setup editor — the Setup act of the three-act harness flow.
 *
 * Reuses the production StepSetDetection UI to author a Test Video's Scan Setup
 * (Climber Crop + analysis tap + Wall Crop + Quality Tier + panning) alongside a
 * persistent condition-label panel, so the video stays reviewable while the
 * labels are entered. The single Save setup action writes setup.json (crops) and
 * its analysisInputs (labels) together, re-POSTs video-stats to re-stamp the
 * artifact, and returns to the corpus. It runs no detection and seeds no Ground
 * Truth: the ViTPose seed and the flag review live in the separate Calibrate act
 * (see Calibrator).
 *
 * When a setup already exists on disk the harness suggestions are fetched in the
 * background on open (video-stats handoff) and prefill still-unlabelled fields in
 * place — never blocking the panel. Rendered only in development.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import StepSetDetection from "@/components/scan/process-flow/StepSetDetection";
import MetadataEditorPanel from "@/components/dev/MetadataEditorPanel";
import { probeHarnessContract, videoStatsGate } from "@/utils/harnessContract";
import { requestVideoStats, loadCameraAngleHint, applySuggestions } from "@/utils/harnessVideoStats";
import {
  normalizeAnalysisInputs,
  computeProvenance,
  type AnalysisInputsValues,
  type EditableField,
} from "@/utils/harnessMetadata";
import { saveSetupLabels } from "@/utils/harnessSetup";
import { probeVideoMeta, type VideoMeta } from "@/utils/probeVideoMeta";
import { buildDetectionGrid } from "@/utils/harnessDetectionGrid";
import { type CropFraction, DEFAULT_CROP } from "@/utils/cropFraction";
import { frameClampCrop, defaultRouteAroundClimber } from "@/utils/cropContainment";
import { DEFAULT_TIER, getTierConfig, type QualityTier } from "@/utils/poseTiers";
import type { MediaPipeVariant } from "@/hooks/usePoseModel";
import type { CorpusItem } from "@/utils/harnessCorpus";

type SavePhase = "idle" | "saving" | "done" | "error";

export default function SetupEditor({
  item,
  onBack,
  onDone,
}: {
  item: CorpusItem;
  onBack: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [phaseError, setPhaseError] = useState<string | null>(null);

  const [tier, setTier] = useState<QualityTier>(DEFAULT_TIER);
  const [modelVariant, setModelVariant] = useState<MediaPipeVariant>(
    getTierConfig(DEFAULT_TIER).variant,
  );
  const [frameStep, setFrameStep] = useState(getTierConfig(DEFAULT_TIER).frameStep);
  const [climberCrop, setClimberCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [wallCrop, setWallCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [climberPoint, setClimberPoint] = useState<{ x: number; y: number; t?: number } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);
  const wallTouchedRef = useRef(false);

  // Condition labels live here (controlled), so the single Save setup can persist
  // crops and labels together. Seeded from the legacy metadata passthrough at
  // mount, then overridden by setup.json.analysisInputs once the Setup loads.
  const [labelValues, setLabelValues] = useState<AnalysisInputsValues>(() =>
    normalizeAnalysisInputs(item.analysisInputs),
  );
  // The loaded-from-disk baseline, used to compute per-label provenance on save.
  const seededRef = useRef<AnalysisInputsValues>(labelValues);
  // The harness suggestions actually prefilled — drives the "suggested" affordance
  // and the provenance split (auto-accepted vs human-overridden).
  const [applied, setApplied] = useState<Partial<Record<EditableField, string>>>({});
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Degraded-state note (video-stats gate) and the async ViTPose camera-angle hint.
  const [statsNote, setStatsNote] = useState<string | null>(null);
  const [cameraAngleHint, setCameraAngleHint] = useState<string | null>(null);

  // Surface the degraded state before any save (probe is module-cached).
  useEffect(() => {
    let cancelled = false;
    void probeHarnessContract().then((contract) => {
      if (!cancelled) setStatsNote(videoStatsGate(contract).degradedReason);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The ViTPose camera-angle estimate lands asynchronously in video-stats.json —
  // read it on load now that the metadata panel is always visible (display-only).
  useEffect(() => {
    let cancelled = false;
    void loadCameraAngleHint(item.key).then((hint) => {
      if (!cancelled) setCameraAngleHint(hint);
    });
    return () => {
      cancelled = true;
    };
  }, [item.key]);

  function handleTierChange(t: QualityTier) {
    setTier(t);
    const cfg = getTierConfig(t);
    setModelVariant(cfg.variant);
    setFrameStep(cfg.frameStep);
  }

  const handleLabelChange = useCallback((field: EditableField, value: string) => {
    setLabelValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Load the video bytes + any existing Scan Setup, then — when a setup exists —
  // fetch harness suggestions in the background and prefill unlabelled fields.
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
        const meta = await probeVideoMeta(url);
        if (revoked) return;
        setVideoMeta(meta);

        const { setup } = await setupRes.json();
        if (setup && !revoked) {
          setClimberCrop(setup.climberCrop ?? DEFAULT_CROP);
          setWallCrop(setup.wallCrop ?? DEFAULT_CROP);
          setClimberPoint(setup.climberPoint ?? null);
          setPanning(!!setup.panning);
          if (typeof setup.qualityTier === "string")
            handleTierChange(setup.qualityTier as QualityTier);
          if (setup.analysisInputs) {
            const normalized = normalizeAnalysisInputs(setup.analysisInputs);
            seededRef.current = normalized;
            setLabelValues(normalized);
          }
          wallTouchedRef.current = true; // preserve the saved wall crop across a re-tap
        }

        // Auto, non-blocking suggestions — only when a setup.json exists on disk
        // (the harness computes them from the saved crops). Prefills only
        // still-unlabelled fields, so user edits made while it runs survive.
        if (item.hasSetup && !revoked) {
          setSuggestionsLoading(true);
          try {
            const gate = videoStatsGate(await probeHarnessContract());
            if (revoked) return;
            setStatsNote(gate.degradedReason);
            if (gate.statsEnabled) {
              const { suggestions } = await requestVideoStats(item.key);
              if (revoked) return;
              if (gate.prefillEnabled) {
                setLabelValues((prev) => applySuggestions(prev, suggestions).values);
                setApplied(applySuggestions(seededRef.current, suggestions).applied);
              }
            }
          } catch (err) {
            if (!revoked)
              setStatsNote(
                `Video stats failed — labels are manual. (${err instanceof Error ? err.message : String(err)})`,
              );
          } finally {
            if (!revoked) setSuggestionsLoading(false);
          }
        }
      } catch (err) {
        if (!revoked) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.key, item.hasSetup]);

  // The Climber Crop is drawn by hand here: the editor loads no pose model, so
  // there is nothing to derive a box from the tap with. The Wall Crop still
  // auto-follows the Climber Crop until the author moves it themselves.
  const handleClimberCropChange = useCallback((c: CropFraction) => {
    setClimberCrop(c);
    setWallCrop((prev) => (wallTouchedRef.current ? prev : defaultRouteAroundClimber(c)));
  }, []);

  const handleClimberPointChange = useCallback((p: { x: number; y: number; t?: number } | null) => {
    if (p === null) wallTouchedRef.current = false;
    setClimberPoint(p);
  }, []);

  const handleWallCropChange = useCallback((c: CropFraction) => {
    wallTouchedRef.current = true;
    setWallCrop(frameClampCrop(c));
  }, []);

  const handlePanningChange = useCallback((b: boolean) => {
    setPanning(b);
  }, []);

  /** PUT setup.json (crops only); returns the authoritative setupHash, or null. */
  const saveSetup = useCallback(async (): Promise<string | null> => {
    const res = await fetch(`/api/dev/corpus/setup?key=${encodeURIComponent(item.key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ climberCrop, wallCrop, climberPoint, panning, qualityTier: tier }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Failed to save setup.");
    return typeof body.setup?.setupHash === "string" ? body.setup.setupHash : null;
  }, [item.key, climberCrop, wallCrop, climberPoint, panning, tier]);

  // Re-POST video-stats so the harness artifact tracks the just-saved crops
  // (handoff item 4). Fire-and-forget on save — the flow returns to the corpus
  // rather than waiting on the recompute, and any degraded state is already shown.
  const restampStats = useCallback(
    (setupHash: string | null) => {
      void (async () => {
        try {
          const gate = videoStatsGate(await probeHarnessContract());
          if (gate.statsEnabled) await requestVideoStats(item.key, setupHash ?? undefined);
        } catch {
          // Background re-stamp — never gates the save.
        }
      })();
    },
    [item.key],
  );

  // The single Save setup: persist crops + labels together, re-stamp the stats
  // artifact in the background, then return to the corpus.
  const handleSaveSetup = useCallback(async () => {
    setPhase("saving");
    setPhaseError(null);
    try {
      const setupHash = await saveSetup();
      await saveSetupLabels(
        item.key,
        labelValues,
        computeProvenance(labelValues, seededRef.current, applied),
      );
      restampStats(setupHash);
      setPhase("done");
      await onDone();
    } catch (err) {
      setPhase("error");
      setPhaseError(err instanceof Error ? err.message : String(err));
    }
  }, [saveSetup, item.key, labelValues, applied, restampStats, onDone]);

  // The Detection Frame grid is only used here as the "video is usable" gate for
  // the confirm CTA.
  const canConfirm = videoMeta ? buildDetectionGrid(videoMeta.duration).length > 0 : false;
  const busy = phase === "saving";

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

  if (!videoUrl || !videoMeta) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-fg-muted">Loading {item.videoKey}…</p>
      </main>
    );
  }

  const phaseLabel: Record<SavePhase, string> = {
    idle: "",
    saving: "Saving setup…",
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
        {phase !== "idle" && (
          <span className={`shrink-0 text-xs ${phase === "error" ? "text-danger" : "text-fg-muted"}`}>
            {phaseLabel[phase]}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          <StepSetDetection
            videoPreviewUrl={videoUrl}
            climberCrop={climberCrop}
            wallCrop={wallCrop}
            onClimberCropChange={handleClimberCropChange}
            onWallCropChange={handleWallCropChange}
            climberPoint={climberPoint}
            onClimberPointChange={handleClimberPointChange}
            tier={tier}
            onTierChange={handleTierChange}
            modelVariant={modelVariant}
            onModelVariantChange={setModelVariant}
            frameStep={frameStep}
            onFrameStepChange={setFrameStep}
            panning={panning}
            onPanningChange={handlePanningChange}
            canScan={canConfirm && !busy}
            onScan={() => void handleSaveSetup()}
            onBack={onBack}
            scanLabel="Save setup"
            scanTitle="Write setup.json — crops, tap, wall, tier and panning — plus the labels"
            scanNudgeLabel="Save anyway"
          />
        </div>

        <aside className="w-md shrink-0 overflow-y-auto border-l border-edge/30 bg-surface">
          <MetadataEditorPanel
            values={labelValues}
            onChange={handleLabelChange}
            applied={applied}
            suggestionsLoading={suggestionsLoading}
            degradedNote={statsNote}
            cameraAngleHint={cameraAngleHint}
          />
        </aside>
      </div>
    </div>
  );
}
