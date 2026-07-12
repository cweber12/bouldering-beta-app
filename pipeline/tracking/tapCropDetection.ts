/**
 * Click-time Climber crop derivation.
 *
 * When the User taps the Climber in scan setup, run MediaPipe **once** on a
 * zoomed window around the tap, pick the pose containing the tap, and derive the
 * Adaptive Crop seed from its landmarks. This makes the Step 2 Climber box
 * landmark-derived (climber-proportional, tight to the actual body) the instant
 * the User taps, instead of a fixed frame-proportional box that is far too large
 * for a small / distant climber (ADR 0013).
 *
 * Detecting in a zoomed window — not the whole frame — keeps a small climber
 * large enough in the detection input for MediaPipe's person detector to find
 * them, the same reason the per-frame Adaptive Crop zooms.
 *
 * Returns null when no pose is found at the tap; the caller falls back to a
 * default box around the tap and still proceeds (the scan re-acquires).
 *
 * Framework-agnostic apart from a transient DOM canvas to rasterise the frame
 * (the same pattern other pipeline modules use). No React imports — keep it that
 * way.
 */

import { estimateFramesMediaPipe } from "@/pipeline/pose/mediapipePoseDetection";
import { mapKeypointsToFullFrame, type CropBox } from "@/pipeline/tracking/cropDetector";
import {
  selectClimberByPoint,
  deriveClimberCrop,
  type Point,
} from "@/pipeline/tracking/climberTracker";
import type { CropFraction } from "@/utils/cropFraction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;

/**
 * Zoomed detection window around the tap, as a fraction of the frame. Portrait —
 * ascents are recorded vertically, so the window is taller than wide and tends
 * to contain the whole climber from one tap.
 */
export const TAP_WINDOW: { w: number; h: number } = { w: 0.45, h: 0.75 };

/**
 * Padding for the **initial** tap-derived Climber box — slightly more generous
 * than the per-frame in-scan default (`DEFAULT_CROP_PAD = 0.6`) so the seed box
 * the User sees and adjusts comfortably surrounds the climber. Only the seed is
 * widened; the in-scan adaptive crop keeps its tuned padding (ADR 0013/0014).
 */
export const SEED_CROP_PAD = 0.85;

/**
 * Derive the Climber crop from a tap, in **frame fractions** (so it feeds the
 * crop overlay and the processor seed directly).
 *
 * @param detector     - Loaded MediaPipe PoseLandmarker (VIDEO mode). The
 *                       per-instance monotonic-timestamp guard means a one-shot
 *                       call here does not desync the later scan.
 * @param frame        - The displayed frame the User tapped (full resolution).
 * @param point        - Tap, in frame fractions [0, 1].
 * @param timestampSec - The tapped frame's video time, for the detector's clock.
 * @param windowFrac   - Override the zoom window (defaults to {@link TAP_WINDOW}).
 * @param padFactor    - Padding for the derived box (defaults to {@link SEED_CROP_PAD}).
 */
export function deriveTapCrop(
  detector: PoseDetector,
  frame: ImageData,
  point: Point,
  timestampSec: number,
  windowFrac: { w: number; h: number } = TAP_WINDOW,
  padFactor: number = SEED_CROP_PAD,
): CropFraction | null {
  const frameW = frame.width;
  const frameH = frame.height;
  if (!(frameW > 0) || !(frameH > 0)) return null;

  // Zoomed window around the tap, clamped to the frame (px).
  const halfW = (windowFrac.w / 2) * frameW;
  const halfH = (windowFrac.h / 2) * frameH;
  const rx = Math.max(0, Math.round(point.x * frameW - halfW));
  const ry = Math.max(0, Math.round(point.y * frameH - halfH));
  const rw = Math.min(frameW - rx, Math.round(halfW * 2));
  const rh = Math.min(frameH - ry, Math.round(halfH * 2));
  if (rw < 1 || rh < 1) return null;

  // Rasterise the frame, then crop the window onto the detection canvas.
  const full = document.createElement("canvas");
  full.width = frameW;
  full.height = frameH;
  const fctx = full.getContext("2d");
  if (!fctx) return null;
  fctx.putImageData(frame, 0, 0);

  const win = document.createElement("canvas");
  win.width = rw;
  win.height = rh;
  const wctx = win.getContext("2d");
  if (!wctx) return null;
  wctx.drawImage(full, rx, ry, rw, rh, 0, 0, rw, rh);

  const posesLocal = estimateFramesMediaPipe(detector, win, timestampSec);
  if (posesLocal.length === 0) return null;

  // Map window-local landmarks back to full-frame fractions, then pick the pose
  // the tap landed on.
  const region: CropBox = { x: rx, y: ry, width: rw, height: rh };
  const posesFull = posesLocal.map((p) => ({
    timestamp: p.timestamp,
    keypoints: mapKeypointsToFullFrame(p.keypoints, region, frameW, frameH),
  }));

  const chosen = selectClimberByPoint(posesFull, point);
  if (!chosen) return null;

  const box = deriveClimberCrop(chosen.keypoints, frameW, frameH, padFactor);
  if (!box) return null;
  return {
    x: box.x / frameW,
    y: box.y / frameH,
    w: box.width / frameW,
    h: box.height / frameH,
  };
}
