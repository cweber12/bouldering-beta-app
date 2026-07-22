"use client";

import { useEffect, useMemo, useState } from "react";
import type { Ref } from "react";
import FramePlayer, { type FramePlayerHandle } from "@/components/skeleton/FramePlayer";
import type { CropFraction } from "@/components/capture/CropBoxOverlay";
import { cn } from "@/utils/cn";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import type { ImageMatchResult, MatchStatus } from "@/hooks/useImageMatcher";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { useHolds } from "@/hooks/useHolds";
import { renderPoseVideo } from "@/pipeline/render/poseVideoRenderer";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { SkeletonStyle } from "@/pipeline/overlay/skeletonOverlay";
import type { ContrastAdjust } from "@/pipeline/overlay/contrastAdapter";
import RunStatusDot from "@/components/run/RunStatusDot";
import { formatRunTimestamp } from "@/utils/formatRunTimestamp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

const JOINT_COLOR = "rgba(255,255,255,0.9)";

/** Format seconds as M:SS for the start-anchor label. */
function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

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
  /** This climb's identity colour — drives the Silhouette and Skeleton lines. */
  limbColor: string;
  /**
   * Owner attribution shown in the slot header ("You" / a climber's displayName).
   * Set in cross-user comparison so each side-by-side card names whose run it is;
   * omit for a single-owner comparison where every run is the viewer's own.
   */
  ownerLabel?: string;
  /**
   * When set, the overlay colours are nudged (lightness only, hue-locked) for
   * legibility against the sampled route photo. Omit to render the exact identity
   * colours. Threaded into the live player layer and the exported WebM so the
   * download carries the same adapted look. The white joint anchor is exempt.
   */
  contrastAdjust?: ContrastAdjust;
  /** When true, the FramePlayer + download are hidden (overlay mode). */
  hidePlayer?: boolean;
  /** When true, the FramePlayer's built-in play button is hidden. */
  hidePlayButton?: boolean;
  /**
   * When true, the slot fills its parent's height and the player shrinks to
   * fit (viewport-fit) instead of growing with the frame. Used in side-by-side.
   */
  fillHeight?: boolean;
  /** Playback anchor in seconds — where this climb's sequence starts. */
  startOffset?: number;
  /** Ref forwarded to the inner FramePlayer for external play control. */
  playerRef?: Ref<FramePlayerHandle>;
  onMatchResult: (idx: number, result: ImageMatchResult | null) => void;
  /**
   * Report this slot's match lifecycle (idle/matching/done/error). The overlay
   * result is null both while matching and on a failed alignment, so the console
   * needs the status to distinguish "still matching" from "couldn't align" and
   * trigger the side-by-side fallback.
   */
  onMatchStatus?: (idx: number, status: MatchStatus) => void;
  /** Edit this climb's identity colour inline (omit to hide the swatch). */
  onColorChange?: (idx: number, hex: string) => void;
  /** Flag the current scrub position as this climb's start (omit to hide). */
  onSetStart?: (idx: number) => void;
  /** Clear this climb's start anchor (omit to hide). */
  onClearStart?: (idx: number) => void;
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
  ownerLabel,
  contrastAdjust,
  hidePlayer = false,
  hidePlayButton = false,
  fillHeight = false,
  startOffset = 0,
  playerRef,
  onMatchResult,
  onMatchStatus,
  onColorChange,
  onSetStart,
  onClearStart,
}: CompareSlotProps) {
  const {
    matchImage,
    status: matchStatus,
    result: matchResult,
    errorMessage: matchError,
  } = useImageMatcher();

  const { data: skeletonData, status: skeletonStatus } = useSkeletonFrames(
    cv,
    attempt?.id ?? null,
    matchResult,
  );

  // Holds overlay — derived on the fly from the same frames + match result.
  const { holds } = useHolds(cv, attempt?.id ?? null, matchResult);

  // Notify parent when match result changes
  useEffect(() => {
    onMatchResult(slotIndex, matchResult);
  }, [matchResult, slotIndex, onMatchResult]);

  // Report the match lifecycle so the console can drive the side-by-side fallback.
  useEffect(() => {
    onMatchStatus?.(slotIndex, matchStatus);
  }, [matchStatus, slotIndex, onMatchStatus]);

  // Re-run matching when the user triggers a match (via "Apply & Match" button).
  useEffect(() => {
    if (!attempt || !imageFile || !cv || matchTrigger === 0) return;
    matchImage(imageFile, attempt.id, cv, imageCrop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchTrigger, attempt?.id, imageFile, cv]);

  // On-demand video export for download.
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);

  // This climb's styled overlay — identity-coloured Silhouette + Skeleton, with
  // white joints for contrast. Derived once and reused for both the live player
  // layer and the download/export render path.
  const skeletonStyle = useMemo<SkeletonStyle>(
    () => ({
      silhouetteColor: limbColor,
      lineColor: limbColor,
      jointColor: JOINT_COLOR,
      contrastAdjust,
    }),
    [limbColor, contrastAdjust],
  );

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
        skeletonStyle,
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

  // Single styled layer for this climb — identity-coloured Silhouette + Skeleton.
  const playerLayers = skeletonData ? [{ frames: skeletonData.frames, style: skeletonStyle }] : [];

  return (
    <div className={cn("flex flex-col gap-2", fillHeight && "h-full min-h-0 w-full")}>
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

          {/* Owner (cross-user) · date · time — attribution first when set, then
              the date/time that distinguishes a single climber's own runs. */}
          {(() => {
            const ts = formatRunTimestamp(attempt.id);
            return (
              <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
                {ownerLabel && <span className="truncate font-medium text-fg">{ownerLabel}</span>}
                {ts && (
                  <>
                    <span className={cn("truncate text-fg", !ownerLabel && "font-medium")}>
                      {ts.date}
                    </span>
                    <span className="shrink-0 text-fg-muted">{ts.time}</span>
                  </>
                )}
              </span>
            );
          })()}

          {/* Send / attempt indicator — small dot at the end. */}
          <RunStatusDot runType={attempt.runType} className="ml-auto" />
        </div>
      )}

      {!attempt && <p className="text-xs text-fg-muted italic">No climb loaded</p>}

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
            holds={holds}
            holdsTimeOffset={startOffset}
            hidePlayButton={hidePlayButton}
            fit={fillHeight ? "contain" : "width"}
            bare={fillHeight}
            className={fillHeight ? "min-h-0 flex-1" : undefined}
            startOffset={startOffset}
            autoPlay
          />

          {/* Align the start: scrub the bar above, then flag this frame as the
              climb's start so master play runs all climbs from their starts. */}
          {onSetStart && (
            <div className="flex shrink-0 items-center justify-center gap-2">
              <button
                onClick={() => onSetStart(slotIndex)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition",
                  startOffset > 0
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-edge/60 text-fg-secondary hover:border-edge-hover hover:text-fg",
                )}
                title="Set this frame as the climb's start"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 3v18M3 4h13l-2 4 2 4H3"
                  />
                </svg>
                {startOffset > 0 ? `Start ${fmtClock(startOffset)}` : "Set start"}
              </button>
              {startOffset > 0 && onClearStart && (
                <button
                  onClick={() => onClearStart(slotIndex)}
                  className="text-xs text-fg-muted transition hover:text-fg"
                >
                  Clear
                </button>
              )}
            </div>
          )}

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

      {isError && <p className="text-xs text-danger">{matchError ?? "Render failed."}</p>}
    </div>
  );
}
