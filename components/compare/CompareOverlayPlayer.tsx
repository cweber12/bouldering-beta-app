"use client";

import { useMemo, useState } from "react";
import FramePlayer, { type FramePlayerLayer } from "@/components/skeleton/FramePlayer";
import { buildMultiSkeletonFrames } from "@/pipeline/skeletonRenderer";
import { renderMultiPoseVideo } from "@/pipeline/multiPoseVideoRenderer";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

const JOINT_COLOR = "rgba(255,255,255,0.9)";

/**
 * Overlay style for one climb in the multi-climb composite. The Silhouette is
 * disabled here — several overlapping translucent bodies would muddy into one
 * another, so each climb shows as its slot-coloured Skeleton instead.
 */
function overlayStyle(slotColor: string): SkeletonStyle {
  return { silhouetteVisible: false, lineColor: slotColor, jointColor: JOINT_COLOR };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CompareOverlayPlayerProps {
  cv: CV;
  imageFile: File;
  attempts: (RouteAttempt | null)[];
  matchResults: (ImageMatchResult | null)[];
  slotColors: string[];
  /** Per-slot start anchor (seconds) — aligns each climb to a common start. */
  slotOffsets?: number[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CompareOverlayPlayer({
  cv,
  imageFile,
  attempts,
  matchResults,
  slotColors,
  slotOffsets,
}: CompareOverlayPlayerProps) {
  // Pre-compute multi-layer skeleton frames (sync, instant).
  const multiData = useMemo(() => {
    if (!cv) return null;
    const layerInputs = [];
    for (let i = 0; i < attempts.length; i++) {
      const att = attempts[i];
      const mr = matchResults[i];
      if (!att?.orbFeatures || !mr) continue;
      layerInputs.push({
        frames: att.frames,
        videoMeta: att.videoMeta,
        orbFeatures: att.orbFeatures,
        queryOrb: mr.queryOrb,
        matches: mr.matches,
      });
    }
    if (layerInputs.length === 0) return null;
    try {
      return buildMultiSkeletonFrames({ cv, layers: layerInputs });
    } catch {
      return null;
    }
  }, [cv, attempts, matchResults]);

  // Assemble layers with styles (lightweight — just attaches references).
  const playerLayers = useMemo<FramePlayerLayer[]>(() => {
    if (!multiData) return [];
    const layers: FramePlayerLayer[] = [];
    let layerIdx = 0;
    for (let i = 0; i < attempts.length; i++) {
      if (attempts[i] && matchResults[i]) {
        layers.push({
          frames: multiData.layers[layerIdx].frames,
          timeOffset: slotOffsets?.[i] ?? 0,
          style: overlayStyle(slotColors[i]),
        });
        layerIdx++;
      }
    }
    return layers;
  }, [multiData, attempts, matchResults, slotColors, slotOffsets]);

  // On-demand video export.
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);

  async function handleDownload() {
    if (!cv || !imageFile) return;
    const layerInputs = [];
    for (let i = 0; i < attempts.length; i++) {
      const att = attempts[i];
      const mr = matchResults[i];
      if (!att?.orbFeatures || !mr) continue;
      layerInputs.push({
        frames: att.frames,
        videoMeta: att.videoMeta,
        orbFeatures: att.orbFeatures,
        queryOrb: mr.queryOrb,
        matches: mr.matches,
        skeletonStyle: overlayStyle(slotColors[i]),
      });
    }
    if (layerInputs.length === 0) return;
    setExportStatus("rendering");
    setExportProgress(0);
    try {
      const url = await renderMultiPoseVideo({
        cv,
        imageFile,
        layers: layerInputs,
        targetFps: 60,
        onProgress: (r, t) => setExportProgress(Math.round((r / t) * 100)),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = "overlay-composite.webm";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus("done");
    } catch {
      setExportStatus("idle");
    }
  }

  if (playerLayers.length === 0 || !multiData) {
    return (
      <p className="text-xs text-fg-muted italic">
        Overlay will appear here once at least one run has been matched.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <FramePlayer
        imageFile={imageFile}
        layers={playerLayers}
        duration={multiData.duration}
        fit="contain"
        className="min-h-0 flex-1"
        autoPlay
      />
      {exportStatus === "rendering" ? (
        <div className="flex shrink-0 items-center justify-between text-xs text-fg-muted">
          <span>Exporting overlay&#8230;</span>
          <span>{exportProgress}%</span>
        </div>
      ) : (
        <button
          onClick={handleDownload}
          className="shrink-0 text-center text-xs text-fg-muted hover:text-fg transition"
        >
          Download .webm
        </button>
      )}
    </div>
  );
}
