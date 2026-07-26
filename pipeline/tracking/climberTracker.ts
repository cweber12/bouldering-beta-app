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

import type { Keypoint, PoseFrame } from "@/pipeline/pose/poseDetection";
import type { CropBox } from "@/pipeline/tracking/cropDetector";

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
const CENTROID_KEYPOINTS = new Set(["left_hip", "right_hip", "left_shoulder", "right_shoulder"]);

/**
 * Maximum normalised distance a candidate's centroid may be from the predicted
 * climber position to still be accepted as the climber. ~0.18 of the frame.
 */
export const DEFAULT_GATE = 0.18;

/** Wider gate used when re-acquiring after a loss. */
export const REACQUIRE_GATE = 0.35;

/**
 * Consecutive missed detection frames after which the Adaptive Crop is cleared
 * and acquisition falls back to the **Climber Crop** seed (ADR 0024).
 *
 * Two, not more: the corpus measured crop containment at 31.4% on truth-present
 * misses with a median IoU of 0.000, so a box that has failed twice in a row —
 * on frames the reacquire ladder already searched outward from — is pointed at
 * the wrong place, and every further frame spends an initial MediaPipe pass on
 * it. One miss is kept as slack because a single blur/occlusion frame can miss
 * while the box is still correct.
 *
 * The reset goes to the **seed**, never to the full frame: the seed is what
 * keeps a small or distant Climber above MediaPipe's size floor (ADR 0013).
 */
export const MISS_RESET_RUN = 2;

/**
 * Scale factors for the tight-first reacquire ladder, applied to the last
 * confident climber box and walked in order (ADR 0024).
 *
 * Sized against the miss population, not the frame. Truth-present
 * `no-candidates` misses sit at a median truth-bbox area of 0.0242 of the frame
 * — about half the 0.0473 the detector accepts — and the climber box built from
 * such a pose is ≈2.8× that area ({@link DEFAULT_CROP_PAD} laterally,
 * {@link CROP_PAD_V_BIAS} vertically), so ≈0.068. A rung of scale `s` searches
 * `s²` × that box, leaving the Climber occupying:
 *
 * - `×1.5` → ~15.9% of the searched pixels (6.6× their full-frame share);
 * - `×2.5` → ~5.7%, still above the 4.73% share the detector demonstrably
 *   accepts on a full frame.
 *
 * The ladder stops there because a wider rung would drop the Climber below that
 * accepted share — back into the regime where the full frame already returned
 * no candidates on these very frames.
 */
export const REACQUIRE_LADDER_SCALES: readonly number[] = [1.5, 2.5];

/**
 * How much the identity gate widens per consecutive miss (ADR 0024).
 *
 * One {@link DEFAULT_GATE} per miss: that constant is already "how far the
 * Climber may plausibly be from the prediction after one detection step", and a
 * missed frame adds exactly one more step of unobserved motion to the stale
 * prediction's error. Ageing is what the evidence asks for — gated misses carry
 * a median best-unselected-candidate score of 0.878, so the gate is rejecting
 * high-confidence poses, which is the signature of a stale predicted centroid
 * rather than of a bystander.
 */
export const IDENTITY_GATE_AGE_STEP = DEFAULT_GATE;

/**
 * Saturation point of the aged gate. Past a normalised centroid distance of 1.0
 * the gate no longer excludes anything meaningful on a single frame, so
 * selection has effectively reduced to "nearest candidate to the prediction";
 * widening further would only add arithmetic. Issue 04's stale-track acceptance
 * bar is the counterweight that keeps this from admitting hallucinations.
 */
export const MAX_IDENTITY_GATE = 1.0;

/**
 * Base padding around the Adaptive Crop, as a fraction of the pose bbox added
 * across the full width/height (box ≈ (1 + PAD) × bbox). Proportional to the
 * **Climber**, not the frame, so the crop holds the same share of the body at
 * any scale. Generous on purpose: the crop is also the next frame's detection
 * region, so a reaching limb must stay inside it (ADR 0013).
 */
export const DEFAULT_CROP_PAD = 0.6;

/**
 * Extra multiplier on the *vertical* pad — the next move is most often a reach
 * upward, so the crop leaves more head-room than side-room.
 */
export const CROP_PAD_V_BIAS = 1.25;

/**
 * Absolute minimum crop extent, as a fraction of each frame dimension. Only a
 * degenerate-pose guard (a collapsed / partial pose whose bbox is near-zero) —
 * **not** the normal size, which is fully climber-proportional. Replaces the old
 * frame-proportional `MIN_CROP_FRAC` floor.
 */
export const ABS_MIN_CROP_FRAC = 0.06;

/** Detection-region margin per unit of per-step velocity (× the move in px). */
export const MOTION_MARGIN_K = 1.0;

/** Residual symmetric slack folded into the detection region (× box extent). */
export const REGION_BASE_SLACK = 0.1;

/**
 * Reach-disk sizing for a **missing limb** (its endpoint keypoint absent from the
 * pose). A missing limb is not in the bbox, so the crop is tight on that side —
 * and since the crop is also the next frame's detection region, the limb stays
 * outside it and is never recovered (the clipping feedback loop, ADR 0014). For
 * each missing limb we grow the crop to contain a disk of plausible endpoint
 * positions, centred on the limb's anchor joint (shoulder / hip) with a radius of
 * the limb's full reach. The radius is taken from the contralateral (mirror) limb
 * when it is detected (segment sum, so a *bent* mirror limb still gives full
 * reach); otherwise it falls back to the torso (shoulder↔hip) length × the ratio
 * below.
 */
export const ARM_REACH_TORSO_RATIO = 1.4;
export const LEG_REACH_TORSO_RATIO = 1.6;

/**
 * Small margin added around a missing limb's reach disk (× radius) so a
 * re-entering endpoint lands *inside* the region rather than exactly on its edge.
 */
export const REACH_DISK_MARGIN = 0.08;

/**
 * Cap on how far the reach disks may grow the crop, as a multiple of the normal
 * padded half-extent on each dimension (measured from the box centre). Backstop
 * against a balloon when several limbs are missing at once; the frame clamp is
 * the final outer bound.
 */
export const REACH_MAX_EXPANSION = 2.0;

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

/**
 * Score a PoseFrame for ranking competing detection results when identity is
 * not yet seeded. Higher is better: keypoint count × average confidence, so a
 * fuller, more-confident pose wins. Returns 0 for a null or empty frame.
 *
 * Lives here because seeding Climber Identity is its only consumer
 * ({@link selectClimberPose}).
 */
export function scorePoseFrame(frame: PoseFrame | null): number {
  if (!frame || frame.keypoints.length === 0) return 0;
  const avgScore = frame.keypoints.reduce((s, kp) => s + kp.score, 0) / frame.keypoints.length;
  return frame.keypoints.length * avgScore;
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
 * The identity gate to use after `consecutiveMisses` missed detection frames.
 *
 * The gate in {@link selectClimberPose} is measured against a predicted
 * centroid that stops updating the moment the track is lost, so on a long miss
 * run a frozen prediction vetoes candidates that are really the Climber. Age the
 * gate instead: it grows by {@link IDENTITY_GATE_AGE_STEP} per consecutive miss
 * — one detection step of unobserved motion each — and saturates at
 * {@link MAX_IDENTITY_GATE}.
 *
 * With zero consecutive misses the result is exactly `base`, so a **fresh**
 * prediction keeps today's tight gate and still rejects bystanders (ADR 0024).
 */
export function agedIdentityGate(consecutiveMisses: number, base: number = REACQUIRE_GATE): number {
  const misses = Math.max(0, Math.floor(consecutiveMisses));
  // max(base, …) so a base already above the ceiling is never *tightened*.
  return Math.max(base, Math.min(MAX_IDENTITY_GATE, base + misses * IDENTITY_GATE_AGE_STEP));
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

// ---------------------------------------------------------------------------
// Missing-limb reach disks (ADR 0014)
// ---------------------------------------------------------------------------

/** The four limbs whose reach can fall outside a bbox built from detected joints. */
export type LimbId = "left_arm" | "right_arm" | "left_leg" | "right_leg";

interface LimbSpec {
  /** Endpoint keypoint whose absence means the limb is "missing" (reaches furthest). */
  endpoint: string;
  /** Anchor joint the reach disk is centred on (shoulder / hip). */
  anchor: string;
  /** Contralateral limb chain, measured (segment sum) for the reach radius. */
  mirror: { anchor: string; mid: string; endpoint: string };
  /** Torso-length multiplier used when the mirror limb is unavailable. */
  ratio: number;
}

const LIMBS: Record<LimbId, LimbSpec> = {
  left_arm: {
    endpoint: "left_wrist",
    anchor: "left_shoulder",
    mirror: { anchor: "right_shoulder", mid: "right_elbow", endpoint: "right_wrist" },
    ratio: ARM_REACH_TORSO_RATIO,
  },
  right_arm: {
    endpoint: "right_wrist",
    anchor: "right_shoulder",
    mirror: { anchor: "left_shoulder", mid: "left_elbow", endpoint: "left_wrist" },
    ratio: ARM_REACH_TORSO_RATIO,
  },
  left_leg: {
    endpoint: "left_ankle",
    anchor: "left_hip",
    mirror: { anchor: "right_hip", mid: "right_knee", endpoint: "right_ankle" },
    ratio: LEG_REACH_TORSO_RATIO,
  },
  right_leg: {
    endpoint: "right_ankle",
    anchor: "right_hip",
    mirror: { anchor: "left_hip", mid: "left_knee", endpoint: "left_ankle" },
    ratio: LEG_REACH_TORSO_RATIO,
  },
};

const LIMB_IDS: LimbId[] = ["left_arm", "right_arm", "left_leg", "right_leg"];

/** Index a pose by keypoint name for O(1) lookups. */
function byName(keypoints: Keypoint[]): Map<string, Keypoint> {
  const m = new Map<string, Keypoint>();
  for (const kp of keypoints) m.set(kp.name, kp);
  return m;
}

/**
 * The limbs that are **missing yet actionable**: the limb's endpoint keypoint is
 * absent (so it is not in the bbox) but its anchor joint *is* detected (so we can
 * place a reach disk and trust the pose enough to act). Anchor-gating skips the
 * most degenerate poses, where the disk centre would be unknown anyway.
 *
 * Exported so the per-frame loop can count expansion frames for Scan Diagnostics
 * without recomputing the disk geometry.
 */
export function findMissingLimbs(keypoints: Keypoint[]): LimbId[] {
  const names = new Set(keypoints.map((kp) => kp.name));
  const out: LimbId[] = [];
  for (const id of LIMB_IDS) {
    const spec = LIMBS[id];
    if (!names.has(spec.endpoint) && names.has(spec.anchor)) out.push(id);
  }
  return out;
}

/**
 * The endpoint joint names of every missing-yet-actionable limb — i.e. the
 * joints the detector did not return and the interpolation pipeline therefore
 * has to synthesize. Same population as {@link findMissingLimbs}, named in the
 * keypoint vocabulary so the harness can score synthesized joints separately
 * from measured ones.
 */
export function missingLimbEndpoints(keypoints: Keypoint[]): string[] {
  return findMissingLimbs(keypoints).map((id) => LIMBS[id].endpoint);
}

/** Mean shoulder↔hip length, the stable torso scale for the reach fallback. */
function torsoLength(map: Map<string, Keypoint>): number {
  const lens: number[] = [];
  for (const [s, h] of [
    ["left_shoulder", "left_hip"],
    ["right_shoulder", "right_hip"],
  ] as const) {
    const sp = map.get(s);
    const hp = map.get(h);
    if (sp && hp) lens.push(Math.hypot(sp.x - hp.x, sp.y - hp.y));
  }
  if (lens.length === 0) return 0;
  return lens.reduce((a, b) => a + b, 0) / lens.length;
}

/** Full reach of a limb: mirror-limb segment sum, else torso × ratio. */
function limbReachRadius(map: Map<string, Keypoint>, spec: LimbSpec, torsoLen: number): number {
  const a = map.get(spec.mirror.anchor);
  const m = map.get(spec.mirror.mid);
  const e = map.get(spec.mirror.endpoint);
  if (a && m && e) {
    return Math.hypot(a.x - m.x, a.y - m.y) + Math.hypot(m.x - e.x, m.y - e.y);
  }
  return torsoLen * spec.ratio;
}

interface ReachDisk {
  cx: number;
  cy: number;
  r: number;
}

/** Reach disks (normalised) for every missing-yet-actionable limb in the pose. */
function computeReachDisks(keypoints: Keypoint[]): ReachDisk[] {
  const missing = findMissingLimbs(keypoints);
  if (missing.length === 0) return [];
  const map = byName(keypoints);
  const torso = torsoLength(map);
  const disks: ReachDisk[] = [];
  for (const id of missing) {
    const spec = LIMBS[id];
    const anchor = map.get(spec.anchor);
    if (!anchor) continue; // anchor-gated (findMissingLimbs already ensures this)
    const reach = limbReachRadius(map, spec, torso);
    if (reach <= 0) continue; // no mirror + no torso → nothing to size against
    disks.push({ cx: anchor.x, cy: anchor.y, r: reach * (1 + REACH_DISK_MARGIN) });
  }
  return disks;
}

/**
 * Derive a generous, climber-proportional crop box around a pose, in **pixel**
 * coordinates, clamped to the frame. The box tracks the Climber's actual extent
 * (so it stays right as they move and change scale) plus padding sized to hold
 * the **next move** — the pad is a fraction of the pose bbox, biased taller for
 * upward reaches ({@link CROP_PAD_V_BIAS}). The {@link ABS_MIN_CROP_FRAC} floor
 * is only a degenerate-pose guard, not the normal size.
 *
 * On top of the symmetric pad, a **missing limb** (endpoint absent, anchor
 * present) grows the box on its side via a reach disk so the limb can re-enter
 * the detection region and be recovered (ADR 0014). The disk extent is composed
 * by per-edge max with the normal padded box — the box only grows where a limb
 * could reach, never tightens — and is capped at {@link REACH_MAX_EXPANSION}×
 * the normal half-extent so several missing limbs can't balloon the crop.
 *
 * Overflow past a frame edge pins that side to 0 / max rather than shrinking the
 * opposite side. Returns null when the pose has no keypoints.
 */
export function deriveClimberCrop(
  keypoints: Keypoint[],
  frameW: number,
  frameH: number,
  padFactor: number = DEFAULT_CROP_PAD,
  minFrac: number = ABS_MIN_CROP_FRAC,
): CropBox | null {
  const bb = poseBBox(keypoints);
  if (!bb) return null;

  const cx = bb.x + bb.w / 2;
  const cy = bb.y + bb.h / 2;
  const halfW = Math.max((bb.w / 2) * (1 + padFactor), minFrac / 2);
  const halfH = Math.max((bb.h / 2) * (1 + padFactor * CROP_PAD_V_BIAS), minFrac / 2);

  let x0 = cx - halfW;
  let y0 = cy - halfH;
  let x1 = cx + halfW;
  let y1 = cy + halfH;

  // Grow each edge to contain a missing limb's reach disk, capped relative to the
  // normal box so a multi-limb-missing pose can't balloon toward the full frame.
  const disks = computeReachDisks(keypoints);
  if (disks.length > 0) {
    const maxHalfW = halfW * REACH_MAX_EXPANSION;
    const maxHalfH = halfH * REACH_MAX_EXPANSION;
    for (const d of disks) {
      x0 = Math.min(x0, Math.max(cx - maxHalfW, d.cx - d.r));
      x1 = Math.max(x1, Math.min(cx + maxHalfW, d.cx + d.r));
      y0 = Math.min(y0, Math.max(cy - maxHalfH, d.cy - d.r));
      y1 = Math.max(y1, Math.min(cy + maxHalfH, d.cy + d.r));
    }
  }

  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(1, x1);
  y1 = Math.min(1, y1);

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
 * Build the next frame's detection region from the last climber box by
 * translating it toward the predicted centroid and adding a motion margin, so a
 * reaching limb that lands ahead of the Climber in the next frame stays inside
 * the region (and is detected rather than clipped — ADR 0013).
 *
 * The shift and the margin are driven by the **per-step velocity**
 * (`predicted − last`), which is itself proportional to `frameStep`: sparser
 * sampling moves the Climber further between detections, so the region grows to
 * match without an explicit `frameStep` term. Overflow past a frame edge pins
 * that side to 0 / max rather than shrinking the opposite side.
 */
export function predictDetectionRegion(
  box: CropBox,
  predicted: Point,
  last: Point,
  frameW: number,
  frameH: number,
  slack = REGION_BASE_SLACK,
): CropBox {
  const shiftX = (predicted.x - last.x) * frameW;
  const shiftY = (predicted.y - last.y) * frameH;
  const cx = box.x + box.width / 2 + shiftX;
  const cy = box.y + box.height / 2 + shiftY;
  const mv = Math.hypot(shiftX, shiftY);
  const halfW = box.width / 2 + MOTION_MARGIN_K * mv + slack * box.width;
  const halfH = box.height / 2 + MOTION_MARGIN_K * mv + slack * box.height;

  const x0 = Math.max(0, Math.round(cx - halfW));
  const y0 = Math.max(0, Math.round(cy - halfH));
  const x1 = Math.min(frameW, Math.round(cx + halfW));
  const y1 = Math.min(frameH, Math.round(cy + halfH));
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/**
 * Choose the detection region for the next frame, in priority order:
 *
 *   1. An established track → the last climber box, grown into a forward-looking
 *      region. With `motion` (the predicted + last centroids) the region is
 *      translated toward where the Climber is heading and given a velocity-sized
 *      margin ({@link predictDetectionRegion}); without it, the box is simply
 *      slack-expanded. Either way the crop follows the climber frame-to-frame.
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
  motion?: { predicted: Point; last: Point } | null,
  slack = REGION_BASE_SLACK,
): CropBox | null {
  if (lastClimberBox) {
    return motion
      ? predictDetectionRegion(lastClimberBox, motion.predicted, motion.last, frameW, frameH, slack)
      : expandCropBox(lastClimberBox, frameW, frameH, slack);
  }
  if (climberCropPx) return climberCropPx;
  return null;
}

// ---------------------------------------------------------------------------
// Reacquire ladder (ADR 0024)
// ---------------------------------------------------------------------------

/** True when a box already spans the whole frame, so searching it *is* the full frame. */
function coversFrame(box: CropBox, frameW: number, frameH: number): boolean {
  return box.x <= 0 && box.y <= 0 && box.width >= frameW && box.height >= frameH;
}

function sameBox(a: CropBox, b: CropBox): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Build the ordered regions a lost track should re-search, **tightest first**.
 *
 * Each rung is the last confident climber box scaled by one of `scales`,
 * recentred by `velocity` (the per-step normalised centroid displacement, so the
 * ladder is thrown ahead along the track rather than pinned to where the Climber
 * stopped being seen) and clamped to the frame. The full frame is appended as
 * the **last** rung.
 *
 * Tight-first, with the full frame demoted, is the whole point (ADR 0024):
 * 88% of misses are `no-candidates` on a frame that was already searched at
 * full-frame scale, and the missing Climber is typically half the size of an
 * accepted one — so re-running the scale that just failed cannot help, while a
 * correctly-placed tight crop lifts them back over MediaPipe's size floor. The
 * full-frame rung is retained only as a bounded fallback and so its own rescue
 * yield stays measurable in `reacquireSteps[]`.
 *
 * A scaled rung that already covers the frame ends the tight part of the ladder
 * — it and every wider rung after it would duplicate the final full-frame rung,
 * and each duplicate costs a MediaPipe pass. With no last box (nothing has ever
 * been tracked) the ladder is the full frame alone.
 *
 * Pixel coordinates in, pixel coordinates out.
 */
export function buildReacquireLadder(
  lastBox: CropBox | null,
  velocity: Point | null,
  frameW: number,
  frameH: number,
  scales: readonly number[] = REACQUIRE_LADDER_SCALES,
): CropBox[] {
  const fullFrame: CropBox = { x: 0, y: 0, width: frameW, height: frameH };
  if (!lastBox) return [fullFrame];

  const cx = lastBox.x + lastBox.width / 2 + (velocity?.x ?? 0) * frameW;
  const cy = lastBox.y + lastBox.height / 2 + (velocity?.y ?? 0) * frameH;

  const rungs: CropBox[] = [];
  for (const scale of scales) {
    const halfW = (lastBox.width * scale) / 2;
    const halfH = (lastBox.height * scale) / 2;
    // Overflow pins the offending side to the frame edge rather than shrinking
    // the opposite one, matching predictDetectionRegion / deriveClimberCrop.
    const x0 = Math.max(0, Math.round(cx - halfW));
    const y0 = Math.max(0, Math.round(cy - halfH));
    const x1 = Math.min(frameW, Math.round(cx + halfW));
    const y1 = Math.min(frameH, Math.round(cy + halfH));
    const rung: CropBox = {
      x: x0,
      y: y0,
      width: Math.max(1, x1 - x0),
      height: Math.max(1, y1 - y0),
    };
    if (coversFrame(rung, frameW, frameH)) break;
    if (rungs.some((prev) => sameBox(prev, rung))) continue;
    rungs.push(rung);
  }

  rungs.push(fullFrame);
  return rungs;
}
