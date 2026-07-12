"use client";

import type { NormalizedPoint } from "@/pipeline/matching/orbDetector";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import XrayStage from "@/components/skeleton/XrayStage";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { fitMediaStyle } from "@/utils/mediaContainerStyle";

// ---------------------------------------------------------------------------
// ScanProgress — the loading view shown while a scan runs. It mirrors the
// Step 2 (StepSetDetection) layout: the same top/bottom bars and the same
// measured, aspect-bounded media stage. The bars carry no controls — the top
// bar labels the step, the bottom bar shows the percentage and the cancel X.
//
// The stage itself is the reusable x-ray canvas (see XrayStage), fed live by
// useVideoProcessor: the ORB starfield plus the accented, gliding pose with its
// fading motion trail. The same XrayStage drives the landing-page demo replay.
// ---------------------------------------------------------------------------

export interface ScanProgressProps {
  /** Wall ORB feature field (full-frame normalised); null until ready. */
  orbPreview: NormalizedPoint[] | null;
  /** The pose detected on the current detection frame; null until first found. */
  currentPose: PoseFrame | null;
  /** Natural video dimensions, to shape the stage; defaults to portrait 9:16. */
  videoAspect: { w: number; h: number } | null;
  /** Seek-loop progress, 0–100. */
  progressPct: number;
  /** True once the seek loop is done and refinement / ORB are still running. */
  finishing: boolean;
  /** Abort the scan and return to the detection step. */
  onCancel: () => void;
}

export default function ScanProgress({
  orbPreview,
  currentPose,
  videoAspect,
  progressPct,
  finishing,
  onCancel,
}: ScanProgressProps) {
  const [stageRef, stageHeight] = useMeasuredHeight();

  const aspectW = videoAspect?.w ?? 9;
  const aspectH = videoAspect?.h ?? 16;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Scanning video">
      {/* Top bar — mirrors the Step 2 toolbar height; no controls. */}
      <header className="shrink-0 border-b border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex h-7 w-full max-w-5xl items-center gap-3">
          <span className="text-sm font-medium text-fg">Scanning video</span>
        </div>
      </header>

      {/* Media stage — same structure and sizing as StepSetDetection, but a
          plain always-dark backdrop carrying only the scan's findings. */}
      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        <div
          ref={stageRef}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        >
          <div
            className="relative overflow-hidden bg-scan-stage"
            style={fitMediaStyle(aspectW, aspectH, stageHeight)}
          >
            <XrayStage
              orbPreview={orbPreview}
              currentPose={currentPose}
              aspect={videoAspect}
              className="absolute inset-0 h-full w-full object-fill"
            />
          </div>
        </div>
      </div>

      {/* Bottom bar — mirrors the Step 2 footer; contents replaced by progress. */}
      <footer className="shrink-0 border-t border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel scan"
            title="Cancel scan"
            className="ui-control -ml-1 flex h-8 w-8 shrink-0 items-center justify-center p-0 text-fg-muted"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div
            className="flex flex-1 items-center justify-center gap-2"
            role="status"
            aria-live="polite"
          >
            {finishing ? (
              <span className="text-sm font-medium text-fg-secondary">Finishing up&#8230;</span>
            ) : (
              <>
                <span className="text-sm text-fg-secondary">Scanning</span>
                <span className="text-sm font-semibold tabular-nums text-fg">{progressPct}%</span>
              </>
            )}
          </div>

          {/* Spacer to keep the progress text optically centered against the X. */}
          <div className="h-8 w-8 shrink-0" aria-hidden="true" />
        </div>
      </footer>
    </section>
  );
}
