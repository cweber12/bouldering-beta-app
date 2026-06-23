"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CropFraction } from "@/utils/cropFraction";

// ---------------------------------------------------------------------------
// ScanLoadingOverlay — full-bleed loading view shown while a scan runs. A
// portal (fixed inset-0 z-fullscreen) so it covers the NavBar and the step
// footer: only the frame being scanned, a green band, and the percentage show.
//
// The frame and the green band come from the same source — the scanner's own
// decoded frame and its per-frame Adaptive Crop (useVideoProcessor) — so they
// stay in sync as the scan reads up the wall. The band first grows from the
// frame bottom to the user-drawn Manual Crop top (the intro), then hands off to
// live Adaptive Crop tracking.
// ---------------------------------------------------------------------------

export interface ScanLoadingOverlayProps {
  /** Live downscaled snapshot of the frame currently being scanned; null until ready. */
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

export default function ScanLoadingOverlay({
  frameImage,
  manualCropTop,
  adaptiveCrop,
  progressPct,
  finishing,
  onCancel,
}: ScanLoadingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const ratio = (aspectW / aspectH).toFixed(6);
  // Reserve vertical room for the cancel row + the percentage block so the media
  // never crowds them. object-fill keeps crop fractions mapping 1:1.
  const maxH = "calc(100dvh - 11rem)";
  const mediaStyle = {
    width: `min(100%, calc(${maxH} * ${ratio}))`,
    maxHeight: maxH,
    aspectRatio: `${aspectW} / ${aspectH}`,
  };

  return createPortal(
    <div
      className="fixed inset-0 z-fullscreen flex flex-col bg-surface"
      role="dialog"
      aria-modal="true"
      aria-label="Scanning video"
    >
      {/* Cancel */}
      <div className="flex shrink-0 justify-end px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="ui-icon-btn p-1.5 text-fg-secondary"
          aria-label="Cancel scan"
          title="Cancel scan"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Media stage — the frame being scanned with the green band over it. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4">
        <div className="relative overflow-hidden" style={mediaStyle}>
          {frameImage ? (
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-fill" />
          ) : (
            <div className="absolute inset-0 bg-inset" />
          )}

          {/* Green scan band: frame bottom up to the crop top. */}
          <div
            className="absolute inset-x-0 bottom-0 bg-accent/20 border-t-2 border-accent/80"
            style={{ top: `${bandTop * 100}%`, transition: "top 700ms ease-out" }}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Percentage / finishing label */}
      <div className="flex shrink-0 flex-col items-center justify-center px-4 py-6" role="status" aria-live="polite">
        {finishing ? (
          <p className="text-lg font-medium text-fg-secondary">Finishing up&#8230;</p>
        ) : (
          <p className="leading-none">
            <span className="text-5xl font-bold tabular-nums tracking-tight text-fg">{progressPct}</span>
            <span className="ml-1 text-xl font-medium text-fg-secondary">%</span>
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
