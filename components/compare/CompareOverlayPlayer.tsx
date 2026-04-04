"use client";

import { useMemo, useState } from "react";
import FramePlayer, { type FramePlayerLayer } from "@/components/shared/FramePlayer";
import { buildMultiSkeletonFrames } from "@/pipeline/skeletonRenderer";
import { renderMultiPoseVideo } from "@/pipeline/multiPoseVideoRenderer";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";
import { getTopology } from "@/utils/poseConstants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

const JOINT_COLOR = "rgba(255,255,255,0.9)";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CompareOverlayPlayerProps {
  cv: CV;
  imageFile: File;
  attempts: (RouteAttempt | null)[];
  matchResults: (ImageMatchResult | null)[];
  slotColors: string[];
  lineWidth: number;
  pointRadius: number;
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
  lineWidth,
  pointRadius,
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
        const topo = getTopology(attempts[i]?.poseBackend ?? "mediapipe");
        layers.push({
          frames: multiData.layers[layerIdx].frames,
          style: { limbColor: slotColors[i], jointColor: JOINT_COLOR, lineWidth, pointRadius, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames },
        });
        layerIdx++;
      }
    }
    return layers;
  }, [multiData, attempts, matchResults, slotColors, lineWidth, pointRadius]);

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
      const topo = getTopology(att.poseBackend ?? "mediapipe");
      layerInputs.push({
        frames: att.frames,
        videoMeta: att.videoMeta,
        orbFeatures: att.orbFeatures,
        queryOrb: mr.queryOrb,
        matches: mr.matches,
        skeletonStyle: { limbColor: slotColors[i], jointColor: JOINT_COLOR, lineWidth, pointRadius, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames },
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
    <div className="flex flex-col gap-2">
      <FramePlayer
        imageFile={imageFile}
        layers={playerLayers}
        duration={multiData.duration}
        autoPlay
      />
      {exportStatus === "rendering" ? (
        <div className="flex items-center justify-between text-xs text-fg-muted">
          <span>Exporting overlay&#8230;</span>
          <span>{exportProgress}%</span>
        </div>
      ) : (
        <button
          onClick={handleDownload}
          className="text-center text-xs text-fg-muted hover:text-fg transition"
        >
          Download .webm
        </button>
      )}
    </div>
  );
}
