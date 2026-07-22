"use client";

/**
 * Dev-only Setup editor — the Setup act of the three-act harness flow.
 *
 * Reuses the production StepSetDetection UI to author a Test Video's Scan Setup:
 * Climber Crop + analysis tap + Wall Crop + Quality Tier + panning, plus the
 * condition-label metadata modal. Confirming (or the emphasized Save affordance)
 * writes setup.json and re-POSTs video-stats — and nothing else. It runs no
 * detection and seeds no Ground Truth: the ViTPose seed and the flag review live
 * in the separate Calibrate act (see Calibrator). The Save affordance is
 * highlighted while the Setup is dirty so the quick set-up path is obvious.
 *
 * Rendered only in development.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import StepSetDetection from "@/components/scan/process-flow/StepSetDetection";
import MetadataEditorPanel from "@/components/dev/MetadataEditorPanel";
import Modal from "@/components/ui/Modal";
import { probeHarnessContract, videoStatsGate } from "@/utils/harnessContract";
import {
  requestVideoStats,
  loadCameraAngleHint,
  type SuggestedLabels,
} from "@/utils/harnessVideoStats";
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

  // Any edit since load/save flips this so the Save affordance is emphasized —
  // the quick-setup cue for rapidly calibrating many bundles.
  const [dirty, setDirty] = useState(false);

  // Editable condition labels — seeded from the legacy metadata.json passthrough
  // at mount, then overridden by setup.json.analysisInputs once the Setup loads.
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [analysisInputs, setAnalysisInputs] = useState<unknown>(item.analysisInputs);
  // Whether the metadata form was opened as the post-save verify step — closing
  // it then finishes the save flow (back to the corpus).
  const metadataAfterSaveRef = useRef(false);

  // Video-stats prefill (video-stats handoff): every Setup save re-POSTs
  // /api/video-stats so the harness artifact tracks the current crops, and the
  // synchronous response's suggested labels prefill the metadata form. Gated on
  // the /api/contract probe; every failure degrades visibly to manual labels.
  const [suggestions, setSuggestions] = useState<SuggestedLabels | null>(null);
  const [statsNote, setStatsNote] = useState<string | null>(null);
  const [cameraAngleHint, setCameraAngleHint] = useState<string | null>(null);
  const statsRefreshRef = useRef<Promise<void> | null>(null);

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

  // The ViTPose camera-angle estimate lands asynchronously in video-stats.json
  // — read it fresh each time the metadata form opens (display-only hint).
  useEffect(() => {
    if (!metadataOpen) return;
    let cancelled = false;
    void loadCameraAngleHint(item.key).then((hint) => {
      if (!cancelled) setCameraAngleHint(hint);
    });
    return () => {
      cancelled = true;
    };
  }, [metadataOpen, item.key]);

  const refreshVideoStats = useCallback(
    async (setupHash: string | null) => {
      const gate = videoStatsGate(await probeHarnessContract());
      setStatsNote(gate.degradedReason);
      if (!gate.statsEnabled) return;
      try {
        const { suggestions: fresh } = await requestVideoStats(item.key, setupHash ?? undefined);
        if (gate.prefillEnabled) setSuggestions(fresh);
      } catch (err) {
        // Never a gate on setup — fall back to manual labels, visibly.
        setSuggestions(null);
        setStatsNote(
          `Video stats failed — labels are manual. (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    },
    [item.key],
  );

  function handleTierChange(t: QualityTier) {
    setTier(t);
    const cfg = getTierConfig(t);
    setModelVariant(cfg.variant);
    setFrameStep(cfg.frameStep);
    setDirty(true);
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
          if (setup.analysisInputs) setAnalysisInputs(setup.analysisInputs);
          wallTouchedRef.current = true; // preserve the saved wall crop across a re-tap
          setDirty(false); // a freshly loaded setup is clean
        }
      } catch (err) {
        if (!revoked) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.key]);

  // The Climber Crop is drawn by hand here: the editor loads no pose model, so
  // there is nothing to derive a box from the tap with. The Wall Crop still
  // auto-follows the Climber Crop until the author moves it themselves.
  const handleClimberCropChange = useCallback((c: CropFraction) => {
    setClimberCrop(c);
    setWallCrop((prev) => (wallTouchedRef.current ? prev : defaultRouteAroundClimber(c)));
    setDirty(true);
  }, []);

  const handleClimberPointChange = useCallback((p: { x: number; y: number; t?: number } | null) => {
    if (p === null) wallTouchedRef.current = false;
    setClimberPoint(p);
    setDirty(true);
  }, []);

  const handleWallCropChange = useCallback((c: CropFraction) => {
    wallTouchedRef.current = true;
    setWallCrop(frameClampCrop(c));
    setDirty(true);
  }, []);

  const handlePanningChange = useCallback((b: boolean) => {
    setPanning(b);
    setDirty(true);
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
    const setupHash = typeof body.setup?.setupHash === "string" ? body.setup.setupHash : null;
    // Re-POST video-stats on every save so the harness artifact tracks the
    // current crops (handoff item 4). Background — never gates the save; the
    // flow awaits the held promise before opening the verify form.
    statsRefreshRef.current = refreshVideoStats(setupHash);
    return setupHash;
  }, [item.key, climberCrop, wallCrop, climberPoint, panning, tier, refreshVideoStats]);

  // Save the Setup (the whole point of this act — no seed). The flow order from
  // the video-stats handoff: save → stats POST → open the labels form prefilled
  // for verification; closing it returns to the corpus.
  const handleSave = useCallback(async () => {
    setPhase("saving");
    setPhaseError(null);
    try {
      await saveSetup();
      setDirty(false);
      // A few seconds while the harness decodes frames; on failure the form
      // still opens, manual, with the visible degraded note.
      await statsRefreshRef.current;
      setPhase("done");
      metadataAfterSaveRef.current = true;
      setMetadataOpen(true);
    } catch (err) {
      setPhase("error");
      setPhaseError(err instanceof Error ? err.message : String(err));
    }
  }, [saveSetup]);

  // Closing the metadata form ends the save flow; opened any other way it just
  // closes.
  const handleMetadataClose = useCallback(() => {
    setMetadataOpen(false);
    if (metadataAfterSaveRef.current) {
      metadataAfterSaveRef.current = false;
      void onDone();
    }
  }, [onDone]);

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
            onClick={() => void handleSave()}
            disabled={busy || !canConfirm}
            title="Write setup.json — crops, tap, wall, tier and panning — without seeding Ground Truth"
            className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
              dirty
                ? "bg-send text-fg-inverse"
                : "bg-surface-alt text-fg"
            }`}
          >
            {dirty ? "Save setup •" : "Save setup"}
          </button>
        </div>
      </div>

      <Modal
        open={metadataOpen}
        onClose={handleMetadataClose}
        ariaLabel="Edit video metadata"
        panelClassName=""
      >
        <MetadataEditorPanel
          // Re-seed the form each open so late-arriving suggestions and label
          // saves from this session are always reflected.
          key={metadataOpen ? "open" : "closed"}
          bundleKey={item.key}
          initial={analysisInputs}
          suggestions={suggestions}
          degradedNote={statsNote}
          cameraAngleHint={cameraAngleHint}
          onClose={handleMetadataClose}
          onSaved={setAnalysisInputs}
        />
      </Modal>

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
          onScan={() => void handleSave()}
          onBack={onBack}
        />
      </div>
    </div>
  );
}
