// ---------------------------------------------------------------------------
// Backdrop luminance sampler — the thin DOM half of the adaptive-contrast model.
//
// Draws a backdrop image (optionally cropped to a fractional rect) onto a small
// offscreen canvas and reads it back, then hands the pixels to the pure
// `computeLumaStats`. Downscaling to a short long-edge keeps the read cheap and
// averages out fine texture; the mean/stdDev band the overlay colours adapt to
// is a coarse, static-per-surface statistic, so a ~64px thumbnail is plenty.
//
// Deliberately OpenCV-free: the overlay colour path must not wait on WASM
// readiness (FramePlayer is cv-free today), so this uses only a 2D canvas.
// ---------------------------------------------------------------------------

import { computeLumaStats, type LumaStats } from "@/pipeline/overlay/contrastAdapter";
import type { CropFraction } from "@/utils/cropFraction";

/** Longest edge (px) of the downscaled sampling canvas. */
const SAMPLE_LONG_EDGE = 64;

/**
 * Sample the mean/stdDev relative luminance of an image source, optionally
 * restricted to a fractional crop rectangle.
 *
 * @param source - Any canvas-drawable image (ImageBitmap, HTMLImageElement, …).
 * @param width  - Natural source width (px).
 * @param height - Natural source height (px).
 * @param crop   - Optional fractional rect; when omitted the whole source is used.
 * @returns Luminance stats, or null when a 2D context / pixels are unavailable.
 */
export function sampleBackdropLuma(
  source: CanvasImageSource,
  width: number,
  height: number,
  crop?: CropFraction,
): LumaStats | null {
  if (typeof document === "undefined" || width <= 0 || height <= 0) return null;

  // Source rect in pixels (whole image, or the crop window clamped in-bounds).
  const sx = crop ? Math.max(0, Math.min(width, crop.x * width)) : 0;
  const sy = crop ? Math.max(0, Math.min(height, crop.y * height)) : 0;
  const sw = crop ? Math.max(1, Math.min(width - sx, crop.w * width)) : width;
  const sh = crop ? Math.max(1, Math.min(height - sy, crop.h * height)) : height;

  // Downscaled target, preserving the sampled aspect ratio.
  const ratio = sw / sh;
  const dw = ratio >= 1 ? SAMPLE_LONG_EDGE : Math.max(1, Math.round(SAMPLE_LONG_EDGE * ratio));
  const dh = ratio >= 1 ? Math.max(1, Math.round(SAMPLE_LONG_EDGE / ratio)) : SAMPLE_LONG_EDGE;

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  try {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
    const img = ctx.getImageData(0, 0, dw, dh);
    return computeLumaStats(img);
  } catch {
    // Tainted canvas or a source that failed to draw — fall back to no adjustment.
    return null;
  }
}
