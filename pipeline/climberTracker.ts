/**
 * Climber-identity tracking for multi-person climbing video.
 *
 * MediaPipe has no notion of *who* the climber is — it just returns the most
 * prominent pose(s) per frame. When a bystander walks into the shot, naïve
 * single-pose detection can switch to them and never switch back.
 *
 * This module owns the "which detected pose is the climber" decision. The
 * caller seeds identity once (a tap on the first frame, or the strongest pose),
 * then on every subsequent frame selects the detected pose whose torso centroid
 * is closest to where the climber is predicted to be — rejecting any candidate
 * that is further away than `gate`. It also derives a tight, adaptive crop box
 * from the climber's landmarks so detection can run on a zoomed-in region
 * without the user drawing a box.
 *
 * This module is framework-agnostic — no React imports, no `cv`. All
 * coordinates are normalised to [0, 1] of the full frame unless a function
 * documents otherwise.
 */

import { scorePoseFrame, type Keypoint, type PoseFrame } from "@/pipeline/poseDetection";
import type { CropBox } from "@/pipeline/cropDetector";

// ---------------------------------------------------------------------------
// Types & tunables
// ---------------------------------------------------------------------------

export interface Point {
  /** Normalised x in [0, 1] relative to the full frame. */
  x: number;
  /** Normalised y in [0, 1] relative to the full frame. */
  y: number;
}

export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Torso keypoints used for the tracking centroid. Hips + shoulders form a
 * stable, roughly-central anchor that survives limb occlusion far better than
 * an all-keypoint average (which drifts toward whichever limbs are visible).
 */
const CENTROID_KEYPOINTS = new Set([
  "left_hip",
  "right_hip",
  "left_shoulder",
  "right_shoulder",
]);

/**
 * Maximum normalised distance a candidate's centroid may be from the predicted
 * climber position to still be accepted as the climber. ~0.18 of the frame.
 */
export const DEFAULT_GATE = 0.18;

/** Wider gate used when re-acquiring on the full frame after a loss. */
export const REACQUIRE_GATE = 0.35;

/** Default padding (fraction of bbox size) added around the adaptive crop. */
export const DEFAULT_CROP_PAD = 0.25;

/** Minimum crop size as a fraction of each frame dimension. */
export const MIN_CROP_FRAC = 0.18;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Torso-weighted centroid of a pose, normalised to the full frame.
 * Falls back to the mean of all keypoints when no torso keypoints survive.
 * Returns null for an empty keypoint set.
 */
export function poseCentroid(keypoints: Keypoint[]): Point | null {
  if (keypoints.length === 0) return null;
  const torso = keypoints.filter((kp) => CENTROID_KEYPOINTS.has(kp.name));
  const src = torso.length > 0 ? torso : keypoints;
  let sx = 0;
  let sy = 0;
  for (const kp of src) {
    sx += kp.x;
    sy += kp.y;
  }
  return { x: sx / src.length, y: sy / src.length };
}

/**
 * Axis-aligned bounding box of a pose in normalised coordinates.
 * Returns null for an empty keypoint set.
 */
export function poseBBox(keypoints: Keypoint[]): NormBox | null {
  if (keypoints.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const kp of keypoints) {
    if (kp.x < minX) minX = kp.x;
    if (kp.y < minY) minY = kp.y;
    if (kp.x > maxX) maxX = kp.x;
    if (kp.y > maxY) maxY = kp.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Predict the climber's next centroid from recent history via linear
 * extrapolation (last position + last velocity). Returns the last position
 * when only one sample exists, and null when history is empty.
 */
export function predictCentroid(history: Point[]): Point | null {
  if (history.length === 0) return null;
  const last = history[history.length - 1];
  if (history.length === 1) return last;
  const prev = history[history.length - 2];
  return { x: last.x + (last.x - prev.x), y: last.y + (last.y - prev.y) };
}

// ---------------------------------------------------------------------------
// Climber selection
// ---------------------------------------------------------------------------

/**
 * Choose the pose matching the tracked climber identity.
 *
 * - With no `predicted` position (identity not yet seeded), returns the
 *   strongest pose by {@link scorePoseFrame}.
 * - Otherwise returns the candidate whose centroid is nearest `predicted`,
 *   but only if that distance is within `gate`. Returns null when every
 *   candidate is further than `gate` (the climber is considered lost), so the
 *   caller can widen the search rather than lock onto a bystander.
 */
export function selectClimberPose(
  poses: PoseFrame[],
  predicted: Point | null,
  gate: number = DEFAULT_GATE,
): PoseFrame | null {
  const candidates = poses.filter((p) => p.keypoints.length > 0);
  if (candidates.length === 0) return null;

  if (!predicted) {
    let best = candidates[0];
    let bestScore = scorePoseFrame(best);
    for (let i = 1; i < candidates.length; i++) {
      const s = scorePoseFrame(candidates[i]);
      if (s > bestScore) {
        best = candidates[i];
        bestScore = s;
      }
    }
    return best;
  }

  let best: PoseFrame | null = null;
  let bestDist = Infinity;
  for (const p of candidates) {
    const c = poseCentroid(p.keypoints);
    if (!c) continue;
    const d = Math.hypot(c.x - predicted.x, c.y - predicted.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (!best || bestDist > gate) return null;
  return best;
}

/**
 * Seed climber identity from a tap. Prefers a pose whose bounding box contains
 * the tapped point; ties (and the no-containment case) are broken by centroid
 * proximity to the tap. Returns null when there are no candidate poses.
 */
export function selectClimberByPoint(poses: PoseFrame[], point: Point): PoseFrame | null {
  const candidates = poses.filter((p) => p.keypoints.length > 0);
  if (candidates.length === 0) return null;

  let best: PoseFrame | null = null;
  let bestDist = Infinity;
  let bestInside = false;

  for (const p of candidates) {
    const bb = poseBBox(p.keypoints);
    const c = poseCentroid(p.keypoints);
    if (!bb || !c) continue;
    const inside =
      point.x >= bb.x && point.x <= bb.x + bb.w && point.y >= bb.y && point.y <= bb.y + bb.h;
    const d = Math.hypot(c.x - point.x, c.y - point.y);

    // A pose containing the tap always beats one that doesn't.
    if (inside && !bestInside) {
      best = p;
      bestDist = d;
      bestInside = true;
      continue;
    }
    if (inside === bestInside && d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Adaptive crop
// ---------------------------------------------------------------------------

/**
 * Derive a tight, padded crop box around a pose, in **pixel** coordinates,
 * clamped to the frame. Replaces the old fixed-size hip-centred box: the box
 * now tracks the climber's actual extent, so it stays tight as they move and
 * change scale. Enforces {@link MIN_CROP_FRAC} so a collapsed/partial pose
 * never produces a degenerate crop.
 *
 * Returns null when the pose has no keypoints.
 */
export function deriveClimberCrop(
  keypoints: Keypoint[],
  frameW: number,
  frameH: number,
  padFactor: number = DEFAULT_CROP_PAD,
  minFrac: number = MIN_CROP_FRAC,
): CropBox | null {
  const bb = poseBBox(keypoints);
  if (!bb) return null;

  const cx = bb.x + bb.w / 2;
  const cy = bb.y + bb.h / 2;
  const halfW = Math.max((bb.w / 2) * (1 + padFactor), minFrac / 2);
  const halfH = Math.max((bb.h / 2) * (1 + padFactor), minFrac / 2);

  const x0 = Math.max(0, cx - halfW);
  const y0 = Math.max(0, cy - halfH);
  const x1 = Math.min(1, cx + halfW);
  const y1 = Math.min(1, cy + halfH);

  const x = Math.round(x0 * frameW);
  const y = Math.round(y0 * frameH);
  return {
    x,
    y,
    width: Math.max(1, Math.round(x1 * frameW) - x),
    height: Math.max(1, Math.round(y1 * frameH) - y),
  };
}

/**
 * Expand a pixel crop box outward by `factor` on each side, clamped to the
 * frame. Used to give the tracked crop a little slack frame-to-frame so a
 * fast move doesn't immediately fall outside the detection region.
 */
export function expandCropBox(
  box: CropBox,
  frameW: number,
  frameH: number,
  factor: number,
): CropBox {
  const dx = Math.round(box.width * factor);
  const dy = Math.round(box.height * factor);
  const x = Math.max(0, box.x - dx);
  const y = Math.max(0, box.y - dy);
  const x1 = Math.min(frameW, box.x + box.width + dx);
  const y1 = Math.min(frameH, box.y + box.height + dy);
  return { x, y, width: Math.max(1, x1 - x), height: Math.max(1, y1 - y) };
}

/**
 * Choose the detection region for the next frame, in priority order:
 *
 *   1. An established track → the last climber box, slack-expanded, so the
 *      crop follows the climber frame-to-frame.
 *   2. No track yet but a climber crop is known → that crop, used as the
 *      acquisition seed. **This holds even when the climber was tapped:** the
 *      tap drives identity selection (selectClimberByPoint), not the search
 *      area. Acquiring on the crop keeps a small / distant climber large enough
 *      in the detection input for MediaPipe's person detector to find them.
 *      Searching the whole frame instead leaves a climber at the base of a tall
 *      boulder below the detector's size floor, so no pose is acquired until
 *      they climb large enough — the "detection starts late" failure.
 *   3. Otherwise null → the caller searches the full frame.
 *
 * When the seed crop misses (e.g. the tap landed off the climber), the caller's
 * full-frame re-acquire fallback still recovers the pose, so seeding with the
 * crop is never worse than the full-frame search it replaces.
 */
export function pickAcquisitionRegion(
  lastClimberBox: CropBox | null,
  climberCropPx: CropBox | null,
  frameW: number,
  frameH: number,
  slack = 0.15,
): CropBox | null {
  if (lastClimberBox) return expandCropBox(lastClimberBox, frameW, frameH, slack);
  if (climberCropPx) return climberCropPx;
  return null;
}
