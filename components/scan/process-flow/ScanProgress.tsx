"use client";

import { useEffect, useRef, useState } from "react";
import type { CropFraction } from "@/utils/cropFraction";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { fitMediaStyle } from "@/utils/mediaContainerStyle";

// ---------------------------------------------------------------------------
// ScanProgress — the loading view shown while a scan runs. It mirrors the
// Step 2 (StepSetDetection) layout exactly: the same top/bottom bars and the
// same measured, square-bounded media stage, so the frame window keeps its
// size and placement. The bars carry no controls — the top bar just labels the
// step and the bottom bar shows the percentage.
//
// The frame and the green band come from the same source — the scanner's own
// decoded frame and its per-frame Adaptive Crop (useVideoProcessor) — so they
// stay in sync as the scan reads up the wall. The band first grows from the
// frame bottom to the user-drawn Manual Crop top (the intro), then hands off to
// live Adaptive Crop tracking.
// ---------------------------------------------------------------------------

export interface ScanProgressProps {
  /** Live snapshot of the frame currently being scanned; null until ready. */
  frameImage: ImageData | null;
  /** Top edge (fraction [0,1]) of the user-drawn Manual Crop — the intro target. */
  manualCropTop: number;
  /** Per-frame Adaptive Crop (fraction); null until the Climber is first found. */
  adaptiveCrop: CropFraction | null;
  /** Seek-loop progress, 0–100. */
  progressPct: number;
  /** True once the seek loop is done and refinement / ORB are still running. */
  finishing: boolean;
  /** Abort the scan and return to the detection step. */
  onCancel: () => void;
}

/** Length of the one-time intro beat before the band tracks the Adaptive Crop. */
const INTRO_MS = 750;

export default function ScanProgress({
  frameImage,
  manualCropTop,
  adaptiveCrop,
  progressPct,
  finishing,
  onCancel,
}: ScanProgressProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Measures the media stage so the frame is square-bounded to the exact
  // available height — identical to StepSetDetection's stage.
  const [stageRef, stageHeight] = useMeasuredHeight();

  // Two-beat intro: the band grows from the frame bottom (top = 1) to the
  // Manual Crop top, then hands off to live Adaptive Crop tracking.
  const [animatedIn, setAnimatedIn] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimatedIn(true));
    const timer = setTimeout(() => setIntroDone(true), INTRO_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);

  // Paint the latest frame snapshot onto the canvas (1:1; CSS stretches it).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frameImage) return;
    if (canvas.width !== frameImage.width) canvas.width = frameImage.width;
    if (canvas.height !== frameImage.height) canvas.height = frameImage.height;
    canvas.getContext("2d")?.putImageData(frameImage, 0, 0);
  }, [frameImage]);

  // Band top edge (fraction): the frame bottom (1) before the intro, then the
  // Manual Crop top, then the live Adaptive Crop top once the intro has elapsed.
  const bandTop = !animatedIn
    ? 1
    : introDone && adaptiveCrop
      ? adaptiveCrop.y
      : manualCropTop;

  const aspectW = frameImage?.width ?? 9;
  const aspectH = frameImage?.height ?? 16;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Scanning video">
      {/* Top bar — mirrors the Step 2 toolbar height; no controls. */}
      <header className="shrink-0 border-b border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex h-7 w-full max-w-5xl items-center gap-3">
          <span className="text-sm font-medium text-fg">Scanning video</span>
        </div>
      </header>

      {/* Media stage — same structure and sizing as StepSetDetection. */}
      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        <div
          ref={stageRef}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        >
          <div
            className="relative overflow-hidden"
            style={fitMediaStyle(aspectW, aspectH, stageHeight)}
          >
            {frameImage ? (
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-fill" />
            ) : (
              <div className="absolute inset-0 bg-inset" />
            )}

            {/* Green scan band: frame bottom up to the crop top. */}
            <div
              className="absolute inset-x-0 bottom-0 border-t-2 border-accent/80 bg-accent/20"
              style={{ top: `${bandTop * 100}%`, transition: "top 700ms ease-out" }}
              aria-hidden="true"
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
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="flex flex-1 items-center justify-center gap-2" role="status" aria-live="polite">
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
