/**
 * Generate a scaled thumbnail image with the ORB detection bounding box drawn.
 *
 * Framework-agnostic — no React imports. Uses the browser Canvas API only.
 */

import type { OrbFeatures } from "@/pipeline/orbDetector";

/** Maximum thumbnail width in pixels. Height is scaled proportionally. */
const THUMB_MAX_WIDTH = 320;

/** Color and width for the ORB crop bounding box overlay. */
const BOX_COLOR = "#00ff44";
const BOX_LINE_WIDTH = 2;

/**
 * Draw the ORB detection bounding box onto an ImageData and return a
 * scaled-down PNG data URL.
 *
 * @param imageData - Source frame (full resolution).
 * @param features  - ORB features including optional cropBox.
 * @returns `data:image/png;base64,...` string of the scaled thumbnail.
 */
export function generateOrbThumbnail(
  imageData: ImageData,
  features: OrbFeatures,
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

  // Draw the scaled frame.
  tCtx.drawImage(full, 0, 0, thumbW, thumbH);

  // Draw the ORB detection crop region as a bounding box, if available.
  const crop = features.cropBox;
  if (crop) {
    tCtx.strokeStyle = BOX_COLOR;
    tCtx.lineWidth = BOX_LINE_WIDTH;
    tCtx.strokeRect(
      crop.x * scale,
      crop.y * scale,
      crop.width * scale,
      crop.height * scale,
    );
  }

  return thumb.toDataURL("image/png");
}
