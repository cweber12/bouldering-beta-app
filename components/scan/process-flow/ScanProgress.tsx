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
// The stage is a spotlight on the scanner's own work. The frame currently being
// scanned is painted live (crossfaded between stills so the moving climber does
// not snap), and the Adaptive Crop is drawn over it as a green-tinted box — the
// same accent colours as the Step 2 detection band — while the rest of the
// frame is dimmed by a 25% black layer. The box starts on the tap-derived seed
// crop and glides onto the Climber once the first Adaptive Crop is found, then
// tracks it. Both the frame and its box come from the same source
// (useVideoProcessor) and are refreshed together, so the box always sits over
// the frame it was derived from.
// ---------------------------------------------------------------------------

export interface ScanProgressProps {
  /** Live snapshot of the frame currently being scanned; null until ready. */
  frameImage: ImageData | null;
  /** The tap-derived Climber seed crop — the spotlight's starting box. */
  seedCrop: CropFraction;
  /** Per-frame Adaptive Crop (fraction); null until the Climber is first found. */
  adaptiveCrop: CropFraction | null;
  /** Seek-loop progress, 0–100. */
  progressPct: number;
  /** True once the seek loop is done and refinement / ORB are still running. */
  finishing: boolean;
  /** Abort the scan and return to the detection step. */
  onCancel: () => void;
}

/** How long the spotlight box takes to glide to a new Adaptive Crop. */
const BOX_GLIDE_MS = 500;
/** Crossfade duration between consecutive frame stills (and the box fade-in). */
const FRAME_FADE_MS = 300;

export default function ScanProgress({
  frameImage,
  seedCrop,
  adaptiveCrop,
  progressPct,
  finishing,
  onCancel,
}: ScanProgressProps) {
  // Two stacked canvases ping-ponged for the still crossfade.
  const aRef = useRef<HTMLCanvasElement>(null);
  const bRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<"a" | "b">("a");
  // Measures the media stage so the frame is square-bounded to the exact
  // available height — identical to StepSetDetection's stage.
  const [stageRef, stageHeight] = useMeasuredHeight();
  // Fades the spotlight (box + dim) in once on mount.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Crossfade each new frame still over the previous one. The incoming frame is
  // painted onto whichever layer is currently underneath, then faded up above
  // the outgoing layer, so the moving climber dissolves between stills (which
  // arrive only on detection frames, ~2 fps) instead of snapping.
  useEffect(() => {
    if (!frameImage) return;
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    const incoming = topRef.current === "a" ? b : a;
    const outgoing = topRef.current === "a" ? a : b;

    if (incoming.width !== frameImage.width) incoming.width = frameImage.width;
    if (incoming.height !== frameImage.height) incoming.height = frameImage.height;
    incoming.getContext("2d")?.putImageData(frameImage, 0, 0);

    incoming.style.zIndex = "1";
    outgoing.style.zIndex = "0";
    outgoing.style.opacity = "1";

    // Restart the fade: commit opacity 0 (no transition), force a reflow, then
    // transition to 1 so the incoming still actually animates each time.
    incoming.style.transition = "none";
    incoming.style.opacity = "0";
    void incoming.offsetWidth;
    incoming.style.transition = `opacity ${FRAME_FADE_MS}ms ease`;
    incoming.style.opacity = "1";

    topRef.current = topRef.current === "a" ? "b" : "a";
  }, [frameImage]);

  // The spotlight box: the live Adaptive Crop once the Climber is found, else
  // the tap-derived seed crop. The geometry change is CSS-transitioned, so the
  // box glides from the seed crop onto the Climber and then tracks them.
  const box = adaptiveCrop ?? seedCrop;

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
            {/* Base layer behind the frame canvases. */}
            <div className="absolute inset-0 bg-inset" />

            {/* Two stacked canvases crossfaded on each new still (1:1; CSS
                stretches them to the stage). */}
            <canvas
              ref={aRef}
              className="absolute inset-0 h-full w-full object-fill"
              style={{ opacity: 0 }}
            />
            <canvas
              ref={bRef}
              className="absolute inset-0 h-full w-full object-fill"
              style={{ opacity: 0 }}
            />

            {/* Spotlight: green-tinted Adaptive Crop with the rest of the frame
                dimmed by the box's own 0.25 black outset shadow (clipped to the
                frame by the container's overflow-hidden). One element carries
                the border, tint, dim and glide so they stay in sync. */}
            {frameImage && (
              <div
                className="absolute border-2 border-accent/80 bg-accent/20"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                  borderRadius: "2px",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)",
                  opacity: mounted ? 1 : 0,
                  transition:
                    `left ${BOX_GLIDE_MS}ms ease-out, top ${BOX_GLIDE_MS}ms ease-out, ` +
                    `width ${BOX_GLIDE_MS}ms ease-out, height ${BOX_GLIDE_MS}ms ease-out, ` +
                    `opacity ${FRAME_FADE_MS}ms ease`,
                }}
                aria-hidden="true"
              />
            )}
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
