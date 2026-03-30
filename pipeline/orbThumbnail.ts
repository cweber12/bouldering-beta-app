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
export function generateOrbThumbnail(
  imageData: ImageData,
  keypoints: OrbKeypoint[],
): string {
  // Draw the full-resolution frame + keypoints onto a temporary canvas.
  const full = document.createElement("canvas");
  full.width = imageData.width;
  full.height = imageData.height;
  const fCtx = full.getContext("2d");
  if (!fCtx) return "";
  fCtx.putImageData(imageData, 0, 0);

  // Draw each keypoint as a small green circle (0.5 px diameter → 0.25 radius).
  fCtx.fillStyle = "#00ff00";
  for (const kp of keypoints) {
    fCtx.beginPath();
    fCtx.arc(kp.pt.x, kp.pt.y, 0.25, 0, Math.PI * 2);
    fCtx.fill();
  }

  // Scale down to thumbnail size.
  const scale = Math.min(1, THUMB_MAX_WIDTH / imageData.width);
  const thumbW = Math.round(imageData.width * scale);
  const thumbH = Math.round(imageData.height * scale);

  const thumb = document.createElement("canvas");
  thumb.width = thumbW;
  thumb.height = thumbH;
  const tCtx = thumb.getContext("2d");
  if (!tCtx) return "";
  tCtx.drawImage(full, 0, 0, thumbW, thumbH);

  return thumb.toDataURL("image/png");
}
