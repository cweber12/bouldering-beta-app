"use client";

import { useEffect, useState } from "react";
import type { Ref } from "react";
import FramePlayer, { type FramePlayerHandle } from "@/components/shared/FramePlayer";
import type { CropFraction } from "@/components/shared/CropBoxOverlay";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { renderPoseVideo } from "@/pipeline/poseVideoRenderer";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import { getTopology } from "@/utils/poseConstants";

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
  /** Ref forwarded to the inner FramePlayer for external play control. */
  playerRef?: Ref<FramePlayerHandle>;
  onMatchResult: (idx: number, result: ImageMatchResult | null) => void;
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
  playerRef,
  onMatchResult,
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

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-edge/50 bg-card/60 p-4"
      style={{ borderTopColor: limbColor, borderTopWidth: 2 }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: limbColor }}
        />
        <span className="text-xs font-medium text-fg">Climb {slotIndex + 1}</span>
        {attempt && (
          <span className={[
            "rounded px-1.5 py-0.5 text-xs font-medium capitalize",
            attempt.runType === "send"
              ? "bg-send-surface text-send"
              : "bg-attempt-surface text-attempt",
          ].join(" ")}>
            {attempt.runType ?? "attempt"}
          </span>
        )}
        {attempt?.rating && (
          <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-inset text-fg">
            {attempt.rating}
          </span>
        )}
        {attempt && (
          <span className="ml-auto text-xs text-fg-muted">
            {attempt.frames.length} frames
            {attempt.videoMeta?.duration != null && (
              <> &middot; {Math.floor(attempt.videoMeta.duration / 60)}m {Math.floor(attempt.videoMeta.duration % 60)}s</>
            )}
          </span>
        )}
      </div>

      {attempt?.notes && (
        <div className="rounded border border-edge bg-inset/50 px-3 py-1.5">
          <p className="text-xs text-fg-muted">{attempt.notes}</p>
        </div>
      )}

      {!attempt && (
        <p className="text-xs text-fg-muted italic">No climb loaded</p>
      )}

      {attempt && matchStatus === "matching" && (
        <p className="text-xs text-fg-secondary animate-pulse">Matching&#8230;</p>
      )}

      {isReady && imageFile && !hidePlayer && (
        <div className="flex flex-col gap-2">
          <FramePlayer
            ref={playerRef}
            imageFile={imageFile}
            layers={[{
              frames: skeletonData.frames,
              style: (() => {
                const topo = getTopology(attempt?.poseBackend ?? "mediapipe");
                return { limbColor, jointColor: JOINT_COLOR, lineWidth, pointRadius, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames };
              })(),
            }]}
            duration={skeletonData.duration}
            hidePlayButton={hidePlayButton}
            autoPlay
          />
          {exportStatus === "rendering" ? (
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>Exporting&#8230;</span>
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
      )}

      {isError && (
        <p className="text-xs text-danger">{matchError ?? "Render failed."}</p>
      )}
    </div>
  );
}
