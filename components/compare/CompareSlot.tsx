"use client";

import { useEffect, useState } from "react";
import type { Ref } from "react";
import FramePlayer, { type FramePlayerHandle } from "@/components/shared/FramePlayer";
import type { CropFraction } from "@/components/shared/CropBoxOverlay";
import { cn } from "@/utils/cn";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { renderPoseVideo } from "@/pipeline/poseVideoRenderer";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import { getTopology } from "@/utils/poseConstants";
import RunStatusDot from "@/components/shared/RunStatusDot";
import { formatRunTimestamp } from "@/utils/formatRunTimestamp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

const JOINT_COLOR = "rgba(255,255,255,0.9)";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CompareSlotProps {
  slotIndex: number;
  attempt: RouteAttempt | null;
  imageFile: File | null;
  imageCrop: CropFraction;
  matchTrigger: number;
  cv: CV;
  limbColor: string;
  lineWidth: number;
  pointRadius: number;
  /** When true, the FramePlayer + download are hidden (overlay mode). */
  hidePlayer?: boolean;
  /** When true, the FramePlayer's built-in play button is hidden. */
  hidePlayButton?: boolean;
  /**
   * When true, the slot fills its parent's height and the player shrinks to
   * fit (viewport-fit) instead of growing with the frame. Used in side-by-side.
   */
  fillHeight?: boolean;
  /** Ref forwarded to the inner FramePlayer for external play control. */
  playerRef?: Ref<FramePlayerHandle>;
  onMatchResult: (idx: number, result: ImageMatchResult | null) => void;
  /** Edit this climb's identity colour inline (omit to hide the swatch). */
  onColorChange?: (idx: number, hex: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CompareSlot({
  slotIndex,
  attempt,
  imageFile,
  imageCrop,
  matchTrigger,
  cv,
  limbColor,
  lineWidth,
  pointRadius,
  hidePlayer = false,
  hidePlayButton = false,
  fillHeight = false,
  playerRef,
  onMatchResult,
  onColorChange,
}: CompareSlotProps) {
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();

  const { data: skeletonData, status: skeletonStatus } = useSkeletonFrames(
    cv,
    attempt?.id ?? null,
    matchResult,
  );

  // Notify parent when match result changes
  useEffect(() => {
    onMatchResult(slotIndex, matchResult);
  }, [matchResult, slotIndex, onMatchResult]);

  // Re-run matching when the user triggers a match (via "Apply & Match" button).
  useEffect(() => {
    if (!attempt || !imageFile || !cv || matchTrigger === 0) return;
    matchImage(imageFile, attempt.id, cv, imageCrop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchTrigger, attempt?.id, imageFile, cv]);

  // On-demand video export for download.
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);

  async function handleDownload() {
    if (!cv || !imageFile || !attempt || !matchResult) return;
    const att = getAttempt(attempt.id);
    if (!att?.orbFeatures) return;

    setExportStatus("rendering");
    setExportProgress(0);
    try {
      const url = await renderPoseVideo({
        cv,
        imageFile,
        frames: att.frames,
        videoMeta: att.videoMeta,
        orbFeatures: att.orbFeatures,
        queryOrb: matchResult.queryOrb,
        matches: matchResult.matches,
        skeletonStyle: (() => {
          const topo = getTopology(att.poseBackend ?? "mediapipe");
          return { limbColor, jointColor: JOINT_COLOR, lineWidth, pointRadius, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames };
        })(),
        targetFps: 60,
        onProgress: (r, t) => setExportProgress(Math.round((r / t) * 100)),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${attempt.id}-overlay.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus("done");
    } catch {
      setExportStatus("idle");
    }
  }

  const isReady = skeletonStatus === "ready" && !!skeletonData;
  const isError = skeletonStatus === "error" || matchStatus === "error";

  // Single styled layer for this climb (identity colour + shared skeleton sizing).
  const playerLayers = skeletonData
    ? [{
        frames: skeletonData.frames,
        style: (() => {
          const topo = getTopology(attempt?.poseBackend ?? "mediapipe");
          return { limbColor, jointColor: JOINT_COLOR, lineWidth, pointRadius, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames };
        })(),
      }]
    : [];

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        fillHeight && "h-full min-h-0 w-full",
      )}
    >
      {attempt && (
        <div className="flex w-full shrink-0 items-center gap-2">
          {/* Identity colour swatch — clean rounded swatch, editable inline. */}
          {onColorChange ? (
            <label
              className="relative inline-flex h-5 w-5 shrink-0 cursor-pointer rounded-md ring-1 ring-edge/60 transition hover:ring-edge-hover"
              style={{ backgroundColor: limbColor }}
              title="Climb colour"
            >
              <input
                type="color"
                value={limbColor}
                onChange={(e) => onColorChange(slotIndex, e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Climb colour"
              />
            </label>
          ) : (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: limbColor }}
            />
          )}

          {/* Date · time — the real distinguisher between a climber's own runs. */}
          {(() => {
            const ts = formatRunTimestamp(attempt.id);
            return ts ? (
              <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
                <span className="truncate font-medium text-fg">{ts.date}</span>
                <span className="shrink-0 text-fg-muted">{ts.time}</span>
              </span>
            ) : null;
          })()}

          {/* Send / attempt indicator — small dot at the end. */}
          <RunStatusDot runType={attempt.runType} className="ml-auto" />
        </div>
      )}

      {!attempt && (
        <p className="text-xs text-fg-muted italic">No climb loaded</p>
      )}

      {attempt && matchStatus === "matching" && (
        <p className="text-xs text-fg-secondary animate-pulse">Matching&#8230;</p>
      )}

      {isReady && imageFile && !hidePlayer && (
        <div className={cn("flex w-full flex-col gap-2", fillHeight && "min-h-0 flex-1")}>
          <FramePlayer
            ref={playerRef}
            imageFile={imageFile}
            layers={playerLayers}
            duration={skeletonData.duration}
            hidePlayButton={hidePlayButton}
            fit={fillHeight ? "contain" : "width"}
            bare={fillHeight}
            className={fillHeight ? "min-h-0 flex-1" : undefined}
            autoPlay
          />
          {exportStatus === "rendering" ? (
            <div className="flex shrink-0 items-center justify-between text-xs text-fg-muted">
              <span>Exporting&#8230;</span>
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
      )}

      {isError && (
        <p className="text-xs text-danger">{matchError ?? "Render failed."}</p>
      )}
    </div>
  );
}
