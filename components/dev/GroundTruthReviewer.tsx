"use client";

/**
 * Dev-only read-only Ground Truth reviewer.
 *
 * Shows the paused video frame with the scaffold seed skeleton being attested.
 * The author can zoom/pan for inspection and plant an Auto / Wrong control point
 * on the frame (forward-fill review model), but cannot edit joints, translate
 * poses, or toggle occlusion. The Wrong control is disabled on a zero-joint
 * (seeded-absent) frame — a Wrong stretch bridges across it rather than landing
 * on it.
 *
 * The seek / canvas / zoom machinery lives in {@link FrameStage}, shared with
 * the run reviewer; this component is the single-skeleton painter plus the
 * review controls on top of it.
 */

import { useCallback, useMemo } from "react";
import FrameStage, { type FrameStagePainter, type NormalizedPoint } from "@/components/dev/FrameStage";
import { cn } from "@/utils/cn";
import { dark } from "@/utils/theme";
import { getTopology } from "@/utils/poseConstants";
import { type ReviewFlag } from "@/utils/harnessGroundTruthScaffold";
import type { GroundTruthFrame, GroundTruthJoint } from "@/utils/harnessGroundTruth";

type Pos = NormalizedPoint;

export interface GroundTruthReviewerProps {
  videoSrc: string;
  /** Native video dimensions; the canvas draws at this resolution. */
  videoWidth: number;
  videoHeight: number;
  /** The immutable seed frame shown on the canvas; its timestamp drives the seek. */
  seedFrame: GroundTruthFrame;
  /** The current frame's effective flag, derived from the working control points. */
  flag: ReviewFlag;
  /**
   * When the current frame is *derived* (inheriting its flag from an earlier
   * control point rather than carrying one itself), the timestamp of that
   * governing boundary — surfaced as an "inherited from mm:ss.s" caption so the
   * author can find the boundary to move. `null` on a control-point frame or a
   * default-auto frame (nothing inherited).
   */
  inheritedFrom?: number | null;
  /** Non-core scaffold keypoints (video-normalized) drawn faintly for context. */
  contextKeypoints: Record<string, Pos>;
  onFlagChange: (flag: ReviewFlag) => void;
  className?: string;
}

const REVIEW_OPTIONS: readonly { value: ReviewFlag; label: string; hint: string }[] = [
  {
    value: "auto",
    label: "Auto",
    hint: "Accept the seed forward from this frame until the next control point",
  },
  {
    value: "wrong",
    label: "Wrong",
    hint: "Wrong person tracked — paint every following frame Wrong until the next Auto",
  },
];

const { keypointNames, skeletonEdges } = getTopology("mediapipe");
const NAME_BY_INDEX = keypointNames;

/** A boundary timestamp as mm:ss.s (tenths) for the inherited-source caption. */
function formatBoundary(seconds: number): string {
  const total = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

export default function GroundTruthReviewer({
  videoSrc,
  videoWidth,
  videoHeight,
  seedFrame,
  flag,
  inheritedFrom = null,
  contextKeypoints,
  onFlagChange,
  className,
}: GroundTruthReviewerProps) {
  const joints = seedFrame.joints;
  const occludedCount = Object.values(joints).filter((j) => j.occluded).length;
  const jointCount = Object.keys(joints).length;
  // Wrong can't land on a seeded-absent frame — a Wrong stretch bridges across it.
  const wrongDisabled = jointCount === 0;

  const posOf = useCallback(
    (name: string): Pos | null => joints[name] ?? contextKeypoints[name] ?? null,
    [joints, contextKeypoints],
  );

  const paint = useMemo<FrameStagePainter>(
    () => (ctx, { unit, px }) => {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = Math.max(1.5, unit * 0.0035);
      for (const [a, b] of skeletonEdges) {
        const pa = posOf(NAME_BY_INDEX[a]);
        const pb = posOf(NAME_BY_INDEX[b]);
        if (!pa || !pb) continue;
        const A = px(pa);
        const B = px(pb);
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }
      ctx.restore();

      const coreNames = new Set(Object.keys(joints));
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (const name of Object.keys(contextKeypoints)) {
        if (coreNames.has(name)) continue;
        const p = px(contextKeypoints[name]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1.5, unit * 0.004), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      const rHandle = Math.max(5, unit * 0.012);
      for (const name of Object.keys(joints)) {
        const j: GroundTruthJoint = joints[name];
        const p = px(j);
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, rHandle, 0, Math.PI * 2);
        ctx.fillStyle = j.occluded ? "transparent" : dark.accent;
        ctx.strokeStyle = j.occluded ? dark.caution : "rgba(255,255,255,0.9)";
        ctx.lineWidth = Math.max(2, unit * 0.004);
        if (!j.occluded) ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    },
    [joints, contextKeypoints, posOf],
  );

  return (
    <FrameStage
      videoSrc={videoSrc}
      videoWidth={videoWidth}
      videoHeight={videoHeight}
      timestamp={seedFrame.timestamp}
      paint={paint}
      canvasLabel="Read-only Ground Truth seed skeleton"
      className={className}
      controls={
        <div
          role="group"
          aria-label="Frame review"
          className="flex items-center gap-0.5 rounded-md bg-surface-alt p-0.5"
        >
          {REVIEW_OPTIONS.map((opt) => {
            const active = flag === opt.value;
            const disabled = opt.value === "wrong" && wrongDisabled;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                title={disabled ? "No seed pose on this frame — nothing to flag Wrong" : opt.hint}
                onClick={() => onFlagChange(opt.value)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition disabled:opacity-40",
                  active ? "bg-accent text-fg-inverse" : "text-fg-muted hover:text-fg",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      }
      status={
        <>
          <span>{jointCount} seed joints</span>
          {occludedCount > 0 && <span className="text-caution">{occludedCount} occluded</span>}
        </>
      }
      caption={
        inheritedFrom !== null ? (
          <span data-testid="inherited-hint">
            Flag <span className="font-medium text-fg">{flag}</span> inherited from{" "}
            <span className="tabular-nums">{formatBoundary(inheritedFrom)}</span> — move that
            boundary to change this frame.
          </span>
        ) : (
          "Review the seed skeleton for this frame. Occluded seed joints are hollow."
        )
      }
    />
  );
}
