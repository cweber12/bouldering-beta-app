/**
 * Generate a scaled thumbnail image with ORB keypoints drawn as green dots.
 *
 * Framework-agnostic — no React imports. Uses the browser Canvas API only.
 */

import type { OrbKeypoint } from "@/pipeline/orbDetector";

/** Maximum thumbnail width in pixels. Height is scaled proportionally. */
const THUMB_MAX_WIDTH = 320;

/**
 * Draw ORB keypoints onto an ImageData and return a scaled-down PNG data URL.
 *
 * @param imageData - Source frame (full resolution).
 * @param keypoints - ORB keypoints in full-frame pixel coordinates.
 * @returns `data:image/png;base64,...` string of the scaled thumbnail.
 */
/** Fixed dot radius drawn on the thumbnail canvas (pixels). */
const DOT_RADIUS = 2.5;

export function generateOrbThumbnail(
  imageData: ImageData,
  keypoints: OrbKeypoint[],
): string {
  // Draw the source frame at full resolution onto a temporary canvas.
  const full = document.createElement("canvas");
  full.width = imageData.width;
  full.height = imageData.height;
  const fCtx = full.getContext("2d");
  if (!fCtx) return "";
  fCtx.putImageData(imageData, 0, 0);

  // Scale down to thumbnail size.
  const scale = Math.min(1, THUMB_MAX_WIDTH / imageData.width);
  const thumbW = Math.round(imageData.width * scale);
  const thumbH = Math.round(imageData.height * scale);

  const thumb = document.createElement("canvas");
  thumb.width = thumbW;
  thumb.height = thumbH;
  const tCtx = thumb.getContext("2d");
  if (!tCtx) return "";

  // Draw the scaled frame first.
  tCtx.drawImage(full, 0, 0, thumbW, thumbH);

  // Draw each keypoint at its scaled position with a fixed, visible radius so
  // dots remain prominent regardless of source resolution.
  tCtx.fillStyle = "#00ff44";
  for (const kp of keypoints) {
    tCtx.beginPath();
    tCtx.arc(kp.pt.x * scale, kp.pt.y * scale, DOT_RADIUS, 0, Math.PI * 2);
    tCtx.fill();
  }

  return thumb.toDataURL("image/png");
}
