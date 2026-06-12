/**
 * Hold detection — infers where the Climber's hands and feet were used on the
 * wall (a **Hold**) from the pose track, in Route Photo space.
 *
 * A Hold is inferred from a **Dwell**: a stretch of time over which a single
 * limb's contact point stays within a small radius *in photo space* (after the
 * homography), long enough to be load-bearing. Measuring stationarity in wall
 * space — not raw video pixels — is what makes a held hand register even while
 * the camera pans in Panning Capture (see ADR 0007).
 *
 * This module consumes the **raw scored `PoseFrame[]`** (already smoothed,
 * normalized to [0,1]) plus a `project(normPt, t)` callback that the caller
 * builds from the match homography. It deliberately does *not* reuse the
 * rendered `SkeletonFrameData`, whose keypoint type drops the confidence score
 * the confidence guard needs (ADR 0007, option 3; plan "implementation wrinkle").
 *
 * All distances/margins are fractions of a photo-space `bodyScale` (shoulder
 * width), so detection is resolution-independent.
 *
 * This module is framework-agnostic — no React imports, no OpenCV, no async.
 * Keep it that way.
 */

import type { PoseFrame, Keypoint } from "@/pipeline/poseDetection";

// ---------------------------------------------------------------------------
// Balanced default constants (tune against real Runs — see ADR 0007)
// ---------------------------------------------------------------------------

/** Minimum time a limb must dwell to count as load-bearing. */
const DEFAULT_MIN_DWELL_SEC = 0.5;
/** Stationary radius: a Dwell holds within this fraction of body scale. */
const DEFAULT_STATIONARY_RADIUS_FACTOR = 0.18;
/** Same-kind Holds within this fraction of body scale merge into one. */
const DEFAULT_MERGE_RADIUS_FACTOR = 0.25;
/** A Hand Hold's hand point must sit this far above the wrist (× body scale). */
const DEFAULT_ABOVE_WRIST_FACTOR = 0.05;
/** Knee-straighten gate: interior hip–knee–ankle angle must increase ≥ this. */
const DEFAULT_KNEE_STRAIGHTEN_DEG = 20;
/** Braced gate: a knee angle below this (more bent than a straight dangle). */
const DEFAULT_BRACED_KNEE_MAX_DEG = 160;
/** Braced gate: ankle horizontally offset from the hip plumb by ≥ this (× scale). */
const DEFAULT_BRACED_OFFSET_FACTOR = 0.15;
/** The contact keypoint counts as "genuinely detected" at/above this score. */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.4;
/** A Dwell is valid only if detected for ≥ this fraction of its window (time-weighted). */
const DEFAULT_CONFIDENCE_MIN_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A 2-D point in normalized [0,1] (pose) or pixel (projected) space. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Projects a normalized [0,1] pose point at absolute video time `t` into Route
 * Photo pixel space. Built by the caller from the gated single homography
 * (Fixed Capture) or the per-keyframe `homographyAtTime` (Panning Capture).
 */
export type HoldProjector = (pt: Point, t: number) => Point;

/** An inferred place on the wall the Climber used with a hand or a foot. */
export interface Hold {
  /** Stable id derived from the assigned order (`hold-<order>`). */
  id: string;
  /** Which limb kind used it — drives the marker colour. */
  kind: "hand" | "foot";
  /** Location in Route Photo pixel space. */
  x: number;
  y: number;
  /** Absolute video time (seconds) the Climber first used this Hold. */
  firstUseTime: number;
  /** 1-based rank in the combined hand+foot first-use sequence. */
  order: number;
}

/** Overridable detection thresholds; unset fields fall back to Balanced. */
export interface HoldDetectionOptions {
  minDwellSec?: number;
  stationaryRadiusFactor?: number;
  mergeRadiusFactor?: number;
  aboveWristFactor?: number;
  kneeStraightenDeg?: number;
  bracedKneeMaxDeg?: number;
  bracedOffsetFactor?: number;
  confidenceThreshold?: number;
  confidenceMinFraction?: number;
}

// ---------------------------------------------------------------------------
// Limb definition — the four contact limbs and their landmark names
// ---------------------------------------------------------------------------

interface LimbSpec {
  kind: "hand" | "foot";
  side: "left" | "right";
  /** Primary contact landmarks, averaged when present (fingers / toes). */
  contact: [string, string];
  /** Proximal fallback when the primaries are missing (wrist / ankle). */
  fallback: string;
}

const LIMBS: LimbSpec[] = [
  { kind: "hand", side: "left",  contact: ["left_index", "left_pinky"],   fallback: "left_wrist" },
  { kind: "hand", side: "right", contact: ["right_index", "right_pinky"], fallback: "right_wrist" },
  { kind: "foot", side: "left",  contact: ["left_foot_index", "left_heel"],   fallback: "left_ankle" },
  { kind: "foot", side: "right", contact: ["right_foot_index", "right_heel"], fallback: "right_ankle" },
];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Interior angle (degrees) at `b` between b→a and b→c. NaN if any leg is zero. */
function angleAt(a: Point, b: Point, c: Point): number {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 === 0 || n2 === 0) return NaN;
  const cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

function nameMap(frame: PoseFrame): Map<string, Keypoint> {
  const m = new Map<string, Keypoint>();
  for (const kp of frame.keypoints) m.set(kp.name, kp);
  return m;
}

/** Normalized contact point + representative score for a limb at one frame. */
function contactOf(map: Map<string, Keypoint>, spec: LimbSpec): { pt: Point; score: number } | null {
  const a = map.get(spec.contact[0]);
  const b = map.get(spec.contact[1]);
  if (a && b) return { pt: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, score: (a.score + b.score) / 2 };
  if (a) return { pt: { x: a.x, y: a.y }, score: a.score };
  if (b) return { pt: { x: b.x, y: b.y }, score: b.score };
  const f = map.get(spec.fallback);
  if (f) return { pt: { x: f.x, y: f.y }, score: f.score };
  return null;
}

// ---------------------------------------------------------------------------
// Per-frame samples for one limb (projected into photo space)
// ---------------------------------------------------------------------------

interface LimbSample {
  t: number;
  /** Projected contact point (photo px), or null when the limb is absent. */
  contact: Point | null;
  score: number;
  // Auxiliary projected joints for the load-bearing gates (null when absent).
  wrist: Point | null;            // hand gate
  hip: Point | null;              // foot gate
  knee: Point | null;             // foot gate
  ankle: Point | null;            // foot gate
}

function projectMaybe(
  map: Map<string, Keypoint>,
  name: string,
  project: HoldProjector,
  t: number,
): Point | null {
  const kp = map.get(name);
  return kp ? project({ x: kp.x, y: kp.y }, t) : null;
}

function buildSamples(frames: PoseFrame[], spec: LimbSpec, project: HoldProjector): LimbSample[] {
  return frames.map((frame) => {
    const map = nameMap(frame);
    const c = contactOf(map, spec);
    return {
      t: frame.timestamp,
      contact: c ? project(c.pt, frame.timestamp) : null,
      score: c ? c.score : 0,
      wrist: spec.kind === "hand" ? projectMaybe(map, spec.fallback, project, frame.timestamp) : null,
      hip:   spec.kind === "foot" ? projectMaybe(map, `${spec.side}_hip`, project, frame.timestamp) : null,
      knee:  spec.kind === "foot" ? projectMaybe(map, `${spec.side}_knee`, project, frame.timestamp) : null,
      ankle: spec.kind === "foot" ? projectMaybe(map, `${spec.side}_ankle`, project, frame.timestamp) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

interface ResolvedOptions {
  minDwellSec: number;
  stationaryRadius: number;
  mergeRadius: number;
  aboveWristMargin: number;
  kneeStraightenDeg: number;
  bracedKneeMaxDeg: number;
  bracedOffset: number;
  confidenceThreshold: number;
  confidenceMinFraction: number;
}

/** Mean of a numeric series, or NaN when empty. */
function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** A Hand Hold needs the hand point to sit above the wrist (smaller y). */
function handAboveWrist(run: LimbSample[], opts: ResolvedOptions): boolean {
  const handYs: number[] = [];
  const wristYs: number[] = [];
  for (const s of run) {
    if (s.contact && s.wrist) {
      handYs.push(s.contact.y);
      wristYs.push(s.wrist.y);
    }
  }
  if (handYs.length === 0) return false;
  return mean(handYs) < mean(wristYs) - opts.aboveWristMargin;
}

/** A Foot Hold needs the leg load-bearing: knee straightens OR braced. */
function footLoadBearing(run: LimbSample[], opts: ResolvedOptions): boolean {
  // Knee-straighten: interior hip–knee–ankle angle increases across the dwell.
  const withLeg = run.filter((s) => s.hip && s.knee && s.ankle);
  if (withLeg.length >= 2) {
    const first = withLeg[0];
    const last = withLeg[withLeg.length - 1];
    const a0 = angleAt(first.hip!, first.knee!, first.ankle!);
    const a1 = angleAt(last.hip!, last.knee!, last.ankle!);
    if (Number.isFinite(a0) && Number.isFinite(a1) && a1 - a0 >= opts.kneeStraightenDeg) {
      return true;
    }
  }
  // Braced: bent knee, or ankle offset horizontally from the hip plumb line.
  const kneeAngles: number[] = [];
  const offsets: number[] = [];
  for (const s of withLeg) {
    const ang = angleAt(s.hip!, s.knee!, s.ankle!);
    if (Number.isFinite(ang)) kneeAngles.push(ang);
    offsets.push(Math.abs(s.ankle!.x - s.hip!.x));
  }
  if (kneeAngles.length > 0 && mean(kneeAngles) < opts.bracedKneeMaxDeg) return true;
  if (offsets.length > 0 && mean(offsets) >= opts.bracedOffset) return true;
  return false;
}

/**
 * Time-weighted confidence guard: the fraction of the dwell window during which
 * the contact keypoint was genuinely detected (score ≥ threshold) must clear the
 * minimum. Each sample is weighted by the gap to the next sample in the run, so a
 * few good frames cannot drag a mostly-estimated Dwell over the line.
 */
function confidencePasses(run: LimbSample[], opts: ResolvedOptions): boolean {
  const duration = run[run.length - 1].t - run[0].t;
  if (duration <= 0) return false;
  let goodTime = 0;
  for (let i = 0; i < run.length - 1; i++) {
    const dt = run[i + 1].t - run[i].t;
    if (run[i].score >= opts.confidenceThreshold) goodTime += dt;
  }
  return goodTime / duration >= opts.confidenceMinFraction;
}

// ---------------------------------------------------------------------------
// Dwell scan (one limb)
// ---------------------------------------------------------------------------

interface Dwell {
  kind: "hand" | "foot";
  x: number;
  y: number;
  firstUseTime: number;
}

function scanDwells(samples: LimbSample[], spec: LimbSpec, opts: ResolvedOptions): Dwell[] {
  const dwells: Dwell[] = [];
  let i = 0;
  while (i < samples.length) {
    if (!samples[i].contact) {
      i++;
      continue;
    }
    // Grow a maximal run that stays within the stationary radius of the anchor
    // (the run's first valid contact), so total drift is capped at the radius.
    const anchor = samples[i].contact!;
    let j = i;
    while (
      j + 1 < samples.length &&
      samples[j + 1].contact &&
      dist(samples[j + 1].contact!, anchor) <= opts.stationaryRadius
    ) {
      j++;
    }

    const run = samples.slice(i, j + 1);
    const duration = run[run.length - 1].t - run[0].t;
    if (
      duration >= opts.minDwellSec &&
      confidencePasses(run, opts) &&
      (spec.kind === "hand" ? handAboveWrist(run, opts) : footLoadBearing(run, opts))
    ) {
      const pts = run.filter((s) => s.contact).map((s) => s.contact!);
      dwells.push({
        kind: spec.kind,
        x: mean(pts.map((p) => p.x)),
        y: mean(pts.map((p) => p.y)),
        firstUseTime: run[0].t,
      });
    }

    // Continue from the breaking sample so it can anchor the next run.
    i = j + 1;
  }
  return dwells;
}

// ---------------------------------------------------------------------------
// Merge + order
// ---------------------------------------------------------------------------

/**
 * Collapse same-kind Dwells within the merge radius into one Hold located at —
 * and timed by — the earliest contributing Dwell, so a re-grip or a two-hand
 * match is one numbered Hold. Hand and foot Dwells never merge (different kinds).
 */
function mergeDwells(dwells: Dwell[], mergeRadius: number): Omit<Hold, "order" | "id">[] {
  // Earliest-first so the surviving cluster anchor is the first use.
  const sorted = [...dwells].sort((a, b) => a.firstUseTime - b.firstUseTime);
  const holds: Omit<Hold, "order" | "id">[] = [];
  for (const d of sorted) {
    const existing = holds.find(
      (h) => h.kind === d.kind && Math.hypot(h.x - d.x, h.y - d.y) <= mergeRadius,
    );
    if (existing) continue; // absorbed; the earlier anchor wins.
    holds.push({ kind: d.kind, x: d.x, y: d.y, firstUseTime: d.firstUseTime });
  }
  return holds;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Detect Holds from a Run's pose frames.
 *
 * @param frames    - Raw scored pose frames (normalized [0,1], already smoothed).
 *                    Timestamps are the frames' own (absolute) video seconds; the
 *                    returned `firstUseTime` is in the same space (the caller
 *                    rebases to the player clock if needed).
 * @param project   - Projects a normalized point at time `t` into photo pixels.
 * @param bodyScale - Photo-space body scale (shoulder width, px) all radii scale by.
 * @param opts      - Optional threshold overrides (default Balanced).
 */
export function detectHolds(
  frames: PoseFrame[],
  project: HoldProjector,
  bodyScale: number,
  opts: HoldDetectionOptions = {},
): Hold[] {
  if (frames.length === 0 || !(bodyScale > 0)) return [];

  const resolved: ResolvedOptions = {
    minDwellSec: opts.minDwellSec ?? DEFAULT_MIN_DWELL_SEC,
    stationaryRadius: (opts.stationaryRadiusFactor ?? DEFAULT_STATIONARY_RADIUS_FACTOR) * bodyScale,
    mergeRadius: (opts.mergeRadiusFactor ?? DEFAULT_MERGE_RADIUS_FACTOR) * bodyScale,
    aboveWristMargin: (opts.aboveWristFactor ?? DEFAULT_ABOVE_WRIST_FACTOR) * bodyScale,
    kneeStraightenDeg: opts.kneeStraightenDeg ?? DEFAULT_KNEE_STRAIGHTEN_DEG,
    bracedKneeMaxDeg: opts.bracedKneeMaxDeg ?? DEFAULT_BRACED_KNEE_MAX_DEG,
    bracedOffset: (opts.bracedOffsetFactor ?? DEFAULT_BRACED_OFFSET_FACTOR) * bodyScale,
    confidenceThreshold: opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    confidenceMinFraction: opts.confidenceMinFraction ?? DEFAULT_CONFIDENCE_MIN_FRACTION,
  };

  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);

  const dwells: Dwell[] = [];
  for (const spec of LIMBS) {
    dwells.push(...scanDwells(buildSamples(sorted, spec, project), spec, resolved));
  }

  const merged = mergeDwells(dwells, resolved.mergeRadius);

  // One combined chronological sequence — colour already distinguishes the kind.
  // Deterministic tie-break (time → x → y → kind) keeps numbering stable.
  merged.sort(
    (a, b) =>
      a.firstUseTime - b.firstUseTime ||
      a.x - b.x ||
      a.y - b.y ||
      a.kind.localeCompare(b.kind),
  );

  return merged.map((h, idx) => ({ ...h, order: idx + 1, id: `hold-${idx + 1}` }));
}

/**
 * Photo-space body scale (median projected shoulder width, px) for a Run, using
 * the same projector detection uses. Falls back to the median projected hip
 * width, then to a small default, so a Run missing both shoulders still yields a
 * usable scale rather than zero.
 */
export function computeProjectedBodyScale(
  frames: PoseFrame[],
  project: HoldProjector,
  fallback = 40,
): number {
  const widthsFor = (a: string, b: string): number[] => {
    const out: number[] = [];
    for (const frame of frames) {
      const map = nameMap(frame);
      const ka = map.get(a);
      const kb = map.get(b);
      if (ka && kb) {
        const pa = project({ x: ka.x, y: ka.y }, frame.timestamp);
        const pb = project({ x: kb.x, y: kb.y }, frame.timestamp);
        const d = dist(pa, pb);
        if (d > 1) out.push(d);
      }
    }
    return out;
  };
  const median = (xs: number[]): number => {
    if (xs.length === 0) return NaN;
    const s = [...xs].sort((p, q) => p - q);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const shoulders = median(widthsFor("left_shoulder", "right_shoulder"));
  if (Number.isFinite(shoulders)) return shoulders;
  const hips = median(widthsFor("left_hip", "right_hip"));
  if (Number.isFinite(hips)) return hips;
  return fallback;
}
