"use client";

/**
 * Dev-only detection eval harness — manual calibration pass.
 *
 * Lists the external downloader's Test Video corpus (via /api/dev/corpus) and
 * lets you calibrate each video's Scan Setup — Climber Crop, Wall Crop, tap,
 * panning, Quality Tier — by reusing the production StepSetDetection UI. Saving
 * writes setup.json into the bundle. The baseline detection run is wired in a
 * later slice. Rendered only in development. See docs/adr/0017.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenCV } from "@/hooks/useOpenCV";
import { usePoseModel, type MediaPipeVariant } from "@/hooks/usePoseModel";
import StepSetDetection from "@/components/scan/process-flow/StepSetDetection";
import { type CropFraction, DEFAULT_CROP } from "@/utils/cropFraction";
import { deriveTapCrop } from "@/pipeline/tracking/tapCropDetection";
import { frameClampCrop, defaultRouteAroundClimber } from "@/utils/cropContainment";
import { DEFAULT_TIER, getTierConfig, type QualityTier } from "@/utils/poseTiers";

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
        cvReady={!!cv}
        onBack={() => setSelected(null)}
        onSaved={async () => {
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
// Calibrator — loads a Test Video + its existing Setup and reuses the
// production StepSetDetection UI to author the Scan Setup.
// ---------------------------------------------------------------------------

function Calibrator({
  item,
  cvReady,
  onBack,
  onSaved,
}: {
  item: CorpusItem;
  cvReady: boolean;
  onBack: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // Load the video bytes and any existing Scan Setup for this bundle.
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
        if (!revoked) setVideoUrl(url);

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
  }, [item.key]);

  function handleTierChange(t: QualityTier) {
    setTier(t);
    const cfg = getTierConfig(t);
    setModelVariant(cfg.variant);
    setFrameStep(cfg.frameStep);
    setMaxPoses(cfg.maxPoses);
  }

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

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/dev/corpus/setup?key=${encodeURIComponent(item.key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ climberCrop, wallCrop, climberPoint, panning, qualityTier: tier }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save setup.");
      await onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

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

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{item.routeFolder}</div>
          <div className="truncate font-mono text-xs text-fg-muted">{item.videoKey}</div>
        </div>
        {saveError && <span className="truncate text-xs text-danger">{saveError}</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save setup"}
        </button>
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
        canScan={!!model && cvReady}
        onScan={() => void handleSave()}
        onBack={onBack}
      />
    </div>
  );
}
