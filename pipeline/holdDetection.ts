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
import type { StoredHold } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Balanced default constants (tune against real Runs — see ADR 0007)
// ---------------------------------------------------------------------------

/** Minimum time a *hand* must dwell to count as load-bearing. */
const DEFAULT_MIN_DWELL_SEC = 0.5;
/**
 * Minimum time a *foot* must dwell — deliberately longer than a hand's. Climbers
 * keep feet on footholds longer than hands, and a repositioning or swinging foot
 * briefly satisfies the same geometry a settled placement does (a side-swing
 * pause, or a tap-around before settling). Requiring a longer stationary stretch
 * lets dwell duration discriminate the transient visits from the real placement
 * (ADR 0008 — selectivity over recall).
 */
const DEFAULT_FOOT_MIN_DWELL_SEC = 1.0;
/** Stationary radius: a Dwell holds within this fraction of body scale. */
const DEFAULT_STATIONARY_RADIUS_FACTOR = 0.18;
/** Same-kind Holds within this fraction of body scale merge into one (ADR 0008). */
const DEFAULT_MERGE_RADIUS_FACTOR = 0.35;
/**
 * A Dwell survives a brief excursion outside the stationary radius this long
 * before it ends: a re-grip or a foot reset that returns to the same spot is one
 * Hold, not two (ADR 0008). Excursion frames are excluded from the averaged
 * position but their elapsed time still counts toward the Dwell duration, so a
 * *long* lift-off fails the confidence guard rather than being silently bridged.
 */
const DEFAULT_EXCURSION_GAP_SEC = 0.4;
/**
 * Foot-below-knee margin (× body scale): a braced (bent-knee) Foot Hold underneath
 * the body requires the ankle to sit at least this far below the knee, so a
 * tucked/swinging leg (foot drawn up level with or above the knee) is rejected
 * even when its knee is bent (ADR 0008).
 */
const DEFAULT_FOOT_BELOW_KNEE_FACTOR = 0.05;
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
  footMinDwellSec?: number;
  stationaryRadiusFactor?: number;
  mergeRadiusFactor?: number;
  excursionGapSec?: number;
  footBelowKneeFactor?: number;
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

/**
 * Normalized [0,1] contact point of one extremity in a single pose frame, using
 * the same fingers/toes→proximal fallback detection uses (hand = mean(index,
 * pinky) → wrist; foot = mean(foot_index, heel) → ankle). Returns null when the
 * limb is absent. Used by scan-stage Hold authoring to snap a new Hold to the
 * limb the User picks (ADR 0009).
 */
export function limbContactAt(
  frame: PoseFrame,
  kind: "hand" | "foot",
  side: "left" | "right",
): Point | null {
  const spec = LIMBS.find((l) => l.kind === kind && l.side === side);
  if (!spec) return null;
  const c = contactOf(nameMap(frame), spec);
  return c ? c.pt : null;
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
  footMinDwellSec: number;
  stationaryRadius: number;
  mergeRadius: number;
  excursionGapSec: number;
  footBelowKneeMargin: number;
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

/**
 * A Foot Hold needs the leg load-bearing. Three independent signals qualify
 * (ADR 0008):
 *
 *  (B) **Stand-up underneath** — the interior hip–knee–ankle angle increases
 *      across the dwell (the Climber pushes up on a foot under the body).
 *  (A) **Side support** — the ankle is offset horizontally from the hip plumb
 *      line: a leg shot out from under the torso and held still is resting on a
 *      hold even when the knee barely bends, so offset alone qualifies.
 *  (C) **Braced underneath** — a bent knee *with the foot planted below the knee*.
 *      The below-knee test separates a braced foothold from a tucked/dangling leg
 *      (foot drawn up level with or above the knee), which is rejected.
 *
 * A straight, static leg under the body matches none of these (no stand-up, no
 * offset, no bend) and is correctly read as hanging.
 */
function footLoadBearing(run: LimbSample[], opts: ResolvedOptions): boolean {
  const withLeg = run.filter((s) => s.hip && s.knee && s.ankle);
  if (withLeg.length === 0) return false;

  // (B) Stand-up: interior hip–knee–ankle angle increases across the dwell.
  if (withLeg.length >= 2) {
    const first = withLeg[0];
    const last = withLeg[withLeg.length - 1];
    const a0 = angleAt(first.hip!, first.knee!, first.ankle!);
    const a1 = angleAt(last.hip!, last.knee!, last.ankle!);
    if (Number.isFinite(a0) && Number.isFinite(a1) && a1 - a0 >= opts.kneeStraightenDeg) {
      return true;
    }
  }

  // (A) Side support: foot held out to the side of the hip plumb line.
  const offsets = withLeg.map((s) => Math.abs(s.ankle!.x - s.hip!.x));
  if (mean(offsets) >= opts.bracedOffset) return true;

  // (C) Braced underneath: bent knee with the foot planted below the knee.
  const kneeAngles = withLeg
    .map((s) => angleAt(s.hip!, s.knee!, s.ankle!))
    .filter((a) => Number.isFinite(a));
  const footBelowKnee =
    mean(withLeg.map((s) => s.ankle!.y)) >= mean(withLeg.map((s) => s.knee!.y)) + opts.footBelowKneeMargin;
  if (kneeAngles.length > 0 && mean(kneeAngles) < opts.bracedKneeMaxDeg && footBelowKnee) {
    return true;
  }
  return false;
}

/**
 * Time-weighted confidence guard: the fraction of the dwell window during which
 * the contact keypoint was genuinely detected (score ≥ threshold) *and on the
 * hold* must clear the minimum. Each sample is weighted by the gap to the next
 * sample in the run, so a few good frames cannot drag a mostly-estimated Dwell
 * over the line, and a bridged excursion (off-hold frames) counts against the
 * fraction so a long lift-off fails (ADR 0008).
 */
function confidencePasses(run: LimbSample[], onHold: boolean[], opts: ResolvedOptions): boolean {
  const duration = run[run.length - 1].t - run[0].t;
  if (duration <= 0) return false;
  let goodTime = 0;
  for (let i = 0; i < run.length - 1; i++) {
    const dt = run[i + 1].t - run[i].t;
    if (onHold[i] && run[i].score >= opts.confidenceThreshold) goodTime += dt;
  }
  return goodTime / duration >= opts.confidenceMinFraction;
}

// ---------------------------------------------------------------------------
// Dwell scan (one limb)
// ---------------------------------------------------------------------------

interface Dwell {
  kind: "hand" | "foot";
  side: "left" | "right";
  x: number;
  y: number;
  firstUseTime: number;
  /** Absolute time of the last on-hold sample (for support-window overlap). */
  endTime: number;
  /** Mean on-hold confidence — the "stronger" tie-break for support recovery. */
  score: number;
}

/** Accepted Dwells plus hand Dwells that cleared everything but the grip gate. */
interface ScanResult {
  accepted: Dwell[];
  /** Stationary, confident, long-enough hand Dwells that failed handAboveWrist. */
  handNearMiss: Dwell[];
}

function scanDwells(samples: LimbSample[], spec: LimbSpec, opts: ResolvedOptions): ScanResult {
  const accepted: Dwell[] = [];
  const handNearMiss: Dwell[] = [];
  // Feet must dwell longer than hands to clear a transient pause / tap-around.
  const minDwell = spec.kind === "foot" ? opts.footMinDwellSec : opts.minDwellSec;
  let i = 0;
  while (i < samples.length) {
    if (!samples[i].contact) {
      i++;
      continue;
    }
    // Grow a run anchored at the first valid contact. A sample within the
    // stationary radius extends the run directly; a sample outside it is a
    // potential excursion — bridged only if the limb returns to within the radius
    // of the same anchor inside the gap window (ADR 0008). `j` tracks the last
    // on-hold sample, so the run always ends on the hold.
    const anchor = samples[i].contact!;
    let j = i;
    let scan = i;
    while (scan + 1 < samples.length) {
      const next = samples[scan + 1];
      if (next.contact && dist(next.contact, anchor) <= opts.stationaryRadius) {
        scan++;
        j = scan;
        continue;
      }
      let look = scan + 1;
      let back = -1;
      while (look < samples.length && samples[look].t - samples[j].t <= opts.excursionGapSec) {
        if (samples[look].contact && dist(samples[look].contact!, anchor) <= opts.stationaryRadius) {
          back = look;
          break;
        }
        look++;
      }
      if (back >= 0) {
        scan = back;
        j = back;
      } else {
        break;
      }
    }

    const run = samples.slice(i, j + 1);
    // On-hold mask: in-radius contact frames. Off-hold (bridged) frames are
    // excluded from the averaged position and the confidence good-time.
    const onHold = run.map((s) => !!s.contact && dist(s.contact!, anchor) <= opts.stationaryRadius);
    const duration = run[run.length - 1].t - run[0].t;

    if (duration >= minDwell && confidencePasses(run, onHold, opts)) {
      const onHoldRun = run.filter((_, k) => onHold[k]);
      const pts = onHoldRun.map((s) => s.contact!);
      const dwell: Dwell = {
        kind: spec.kind,
        side: spec.side,
        x: mean(pts.map((p) => p.x)),
        y: mean(pts.map((p) => p.y)),
        firstUseTime: run[0].t,
        endTime: run[run.length - 1].t,
        score: mean(onHoldRun.map((s) => s.score)),
      };

      const loadBearing =
        spec.kind === "hand" ? handAboveWrist(onHoldRun, opts) : footLoadBearing(onHoldRun, opts);

      if (loadBearing) accepted.push(dwell);
      else if (spec.kind === "hand") handNearMiss.push(dwell);
    }

    // Continue from the breaking sample so it can anchor the next run.
    i = j + 1;
  }
  return { accepted, handNearMiss };
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
    footMinDwellSec: opts.footMinDwellSec ?? DEFAULT_FOOT_MIN_DWELL_SEC,
    stationaryRadius: (opts.stationaryRadiusFactor ?? DEFAULT_STATIONARY_RADIUS_FACTOR) * bodyScale,
    mergeRadius: (opts.mergeRadiusFactor ?? DEFAULT_MERGE_RADIUS_FACTOR) * bodyScale,
    excursionGapSec: opts.excursionGapSec ?? DEFAULT_EXCURSION_GAP_SEC,
    footBelowKneeMargin: (opts.footBelowKneeFactor ?? DEFAULT_FOOT_BELOW_KNEE_FACTOR) * bodyScale,
    aboveWristMargin: (opts.aboveWristFactor ?? DEFAULT_ABOVE_WRIST_FACTOR) * bodyScale,
    kneeStraightenDeg: opts.kneeStraightenDeg ?? DEFAULT_KNEE_STRAIGHTEN_DEG,
    bracedKneeMaxDeg: opts.bracedKneeMaxDeg ?? DEFAULT_BRACED_KNEE_MAX_DEG,
    bracedOffset: (opts.bracedOffsetFactor ?? DEFAULT_BRACED_OFFSET_FACTOR) * bodyScale,
    confidenceThreshold: opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    confidenceMinFraction: opts.confidenceMinFraction ?? DEFAULT_CONFIDENCE_MIN_FRACTION,
  };

  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);

  const dwells: Dwell[] = [];
  const handNearMiss: Record<"left" | "right", Dwell[]> = { left: [], right: [] };
  for (const spec of LIMBS) {
    const { accepted, handNearMiss: nm } = scanDwells(buildSamples(sorted, spec, project), spec, resolved);
    dwells.push(...accepted);
    if (spec.kind === "hand") handNearMiss[spec.side].push(...nm);
  }

  // Soft support rule (ADR 0008): both hands can never dangle at once. When both
  // hands are stationary near-miss candidates over an overlapping window and
  // neither hand has an accepted Hold there, the Climber must be hanging from one —
  // recover the stronger so a real hang is not erased. A lone near-miss (the other
  // hand absent) asserts nothing and stays rejected.
  const overlaps = (a: Dwell, b: Dwell) => a.firstUseTime <= b.endTime && b.firstUseTime <= a.endTime;
  for (const l of handNearMiss.left) {
    for (const r of handNearMiss.right) {
      if (!overlaps(l, r)) continue;
      const supported = dwells.some((d) => d.kind === "hand" && (overlaps(d, l) || overlaps(d, r)));
      if (supported) continue;
      const stronger = l.score >= r.score ? l : r;
      if (!dwells.includes(stronger)) dwells.push(stronger);
    }
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
 * Detect Holds at **scan time** in the Run's own video-frame space (ADR 0009,
 * Fixed Capture). The gates are unchanged — they are all fractions of a body
 * scale, so they hold in video pixels just as in photo pixels — but the output
 * lives in **normalized [0,1] video space** so it is resolution-independent and
 * projects onto the Route Photo through the same homography the on-the-fly path
 * uses. `firstUseTime` is the frames' own absolute video seconds.
 *
 * Order is intentionally not stored: it is re-derived from first-use order on
 * load (see {@link projectStoredHolds}).
 */
export function detectHoldsVideoSpace(
  frames: PoseFrame[],
  width: number,
  height: number,
  opts: HoldDetectionOptions = {},
): StoredHold[] {
  if (frames.length === 0 || !(width > 0) || !(height > 0)) return [];
  // Project a normalized [0,1] point into the Run's own video pixels — the
  // space the climber actually appears in, with no homography (there is no
  // Route Photo yet at scan time).
  const project: HoldProjector = (pt) => ({ x: pt.x * width, y: pt.y * height });
  const bodyScale = computeProjectedBodyScale(frames, project);
  return detectHolds(frames, project, bodyScale, opts).map((h) => ({
    x: h.x / width,
    y: h.y / height,
    kind: h.kind,
    firstUseTime: h.firstUseTime,
  }));
}

/**
 * Project saved (normalized video-space) {@link StoredHold}s into Route Photo
 * pixel space through `project`, re-deriving the 1-based first-use rank in that
 * space with the same deterministic tie-break detection uses. Used by the Holds
 * source path when a Run carries authored Holds (ADR 0009); legacy / Panning
 * Capture Runs fall back to {@link detectHolds}.
 */
export function projectStoredHolds(stored: StoredHold[], project: HoldProjector): Hold[] {
  const projected = stored.map((h) => {
    const p = project({ x: h.x, y: h.y }, h.firstUseTime);
    return { kind: h.kind, x: p.x, y: p.y, firstUseTime: h.firstUseTime };
  });
  projected.sort(
    (a, b) =>
      a.firstUseTime - b.firstUseTime ||
      a.x - b.x ||
      a.y - b.y ||
      a.kind.localeCompare(b.kind),
  );
  return projected.map((h, idx) => ({ ...h, order: idx + 1, id: `hold-${idx + 1}` }));
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
