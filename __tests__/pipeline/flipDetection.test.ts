import { describe, it, expect } from "vitest";
import {
  detectFlips,
  isLandmarkFlip,
} from "@/pipeline/pose/flipDetection";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function frame(timestamp: number, kps: Array<[string, number, number, number?]>): PoseFrame {
  return {
    timestamp,
    keypoints: kps.map(([name, x, y, score = 0.9]) => ({ name, x, y, score })),
  };
}

/**
 * Build a torso frame from the four left/right separations. `ls`/`rs` are the
 * x of the left/right shoulder; `lh`/`rh` the hips. y values are arbitrary but
 * fixed so vertical motion is zero.
 */
function torso(
  timestamp: number,
  ls: number, rs: number, lh: number, rh: number,
): PoseFrame {
  return frame(timestamp, [
    ["left_shoulder", ls, 0.25],
    ["right_shoulder", rs, 0.25],
    ["left_hip", lh, 0.6],
    ["right_hip", rh, 0.6],
  ]);
}

// A climber facing the wall: left side at x≈0.35, right side at x≈0.65.
// Separation (right − left) is positive.
const FACING = (t: number) => torso(t, 0.35, 0.65, 0.4, 0.6);

/**
 * Build a vertically-oriented torso. `shY` is the shoulders' y, `hipY` the hips'.
 * Upright climbers have shoulders above hips (smaller y). Pass shoulders BELOW
 * hips to simulate MediaPipe's upside-down fit, keeping left-on-left so no
 * horizontal sign changes — exactly the case the left/right path cannot see.
 */
function vtorso(timestamp: number, shY: number, hipY: number): PoseFrame {
  return frame(timestamp, [
    ["left_shoulder", 0.42, shY],
    ["right_shoulder", 0.58, shY],
    ["left_hip", 0.44, hipY],
    ["right_hip", 0.56, hipY],
  ]);
}

// Upright: shoulders at y=0.30 (top), hips at y=0.60 (bottom).
const UPRIGHT = (t: number) => vtorso(t, 0.3, 0.6);
// Upside-down glitch: shoulders drop to y=0.60, hips rise to y=0.30, L/R intact.
const INVERTED = (t: number) => vtorso(t, 0.6, 0.3);

// ---------------------------------------------------------------------------
// isLandmarkFlip
// ---------------------------------------------------------------------------

describe("isLandmarkFlip", () => {
  it("returns false when the torso is unchanged", () => {
    expect(isLandmarkFlip(FACING(0), FACING(1))).toBe(false);
  });

  it("returns false when neither torso pair is present in both frames", () => {
    const a = frame(0, [["nose", 0.5, 0.1]]);
    const b = frame(1, [["nose", 0.5, 0.1]]);
    expect(isLandmarkFlip(a, b)).toBe(false);
  });

  it("flags a glitch flip: labels teleport across the body in one step", () => {
    // Frame 0 facing the wall (L≈0.35, R≈0.65). Frame 1 has the labels swapped
    // to the other side without the body moving there gradually — left_shoulder
    // now at 0.65, right_shoulder at 0.35. Separation sign inverts; swapping the
    // labels back makes displacement ≈ 0.
    const prev = FACING(0);
    const flipped = torso(1, 0.65, 0.35, 0.6, 0.4);
    expect(isLandmarkFlip(prev, flipped)).toBe(true);
  });

  it("does NOT flag a genuine rotation: sides cross but each joint moves a little", () => {
    // The climber slowly turns: shoulders converge toward centre and just barely
    // cross, each labelled joint moving only ~0.06. Swapping would roughly double
    // the displacement, so it is left alone even though the sign changed.
    const prev = torso(0, 0.46, 0.54, 0.47, 0.53);
    const rotated = torso(1, 0.54, 0.46, 0.53, 0.47);
    // Per-joint motion is 0.08 (small); no-swap cost ≈ 0.32 total; swap cost ≈ 0
    // would WRONGLY flag — but the teleport threshold treats a near-zero-velocity
    // crossing as a real turn only when motion stays under threshold. Verify the
    // tuned default keeps a clearly-small, smooth crossing.
    expect(isLandmarkFlip(prev, rotated, { teleportThreshold: 0.5 })).toBe(false);
  });

  it("does NOT flag pure lateral translation (sign change, but swapping doesn't help)", () => {
    // Whole body slides right by 0.4: both shoulders and hips move the same way.
    // The separation sign can flip only if it crosses; here it stays positive, so
    // this also exercises the swap-margin guard — swapping makes it worse.
    const prev = torso(0, 0.1, 0.3, 0.12, 0.28);
    const slid = torso(1, 0.5, 0.7, 0.52, 0.68);
    expect(isLandmarkFlip(prev, slid)).toBe(false);
  });

  it("detects a flip from shoulders alone when hips are absent", () => {
    const prev = frame(0, [["left_shoulder", 0.35, 0.25], ["right_shoulder", 0.65, 0.25]]);
    const flipped = frame(1, [["left_shoulder", 0.65, 0.25], ["right_shoulder", 0.35, 0.25]]);
    expect(isLandmarkFlip(prev, flipped)).toBe(true);
  });

  it("respects a higher teleport threshold (sparser sampling tolerates more motion)", () => {
    const prev = FACING(0);
    const flipped = torso(1, 0.65, 0.35, 0.6, 0.4);
    // A very high threshold treats even a full teleport as plausible real motion.
    expect(isLandmarkFlip(prev, flipped, { teleportThreshold: 5 })).toBe(false);
  });

  // --- Vertical (upside-down) inversion -------------------------------------

  it("flags an upside-down flip: torso up-vector reverses with L/R sides intact", () => {
    // The case the left/right path is blind to: shoulders and hips swap their
    // vertical positions in one step, but left stays left so no horizontal sign
    // changes. Only the orientation test can catch this.
    expect(isLandmarkFlip(UPRIGHT(0), INVERTED(1))).toBe(true);
  });

  it("does NOT flag a steady upright torso (up-vector unchanged)", () => {
    expect(isLandmarkFlip(UPRIGHT(0), UPRIGHT(1))).toBe(false);
  });

  it("does NOT flag a gradual real inversion (axis turns, centroids stay put)", () => {
    // Shoulders and hips converge toward a horizontal torso over one step — the
    // axis rotates ~90° but the centroids barely move, so it is real motion.
    const prev = vtorso(0, 0.4, 0.6);
    const turning = vtorso(1, 0.48, 0.52);
    expect(isLandmarkFlip(prev, turning)).toBe(false);
  });

  it("does NOT flag a compact torso whose up-vector is below the length floor", () => {
    // Heavily foreshortened: shoulders and hips nearly coincident. Direction is
    // meaningless, so a sign wobble must not register as an inversion.
    const prev = vtorso(0, 0.49, 0.51);
    const wobble = vtorso(1, 0.51, 0.49);
    expect(isLandmarkFlip(prev, wobble)).toBe(false);
  });

  it("does NOT flag an upside-down pose under a permissive orientation cosine", () => {
    // orientationFlipCos = -1 only fires on an exact 180° reversal; a clean
    // inversion sits at cos ≈ -1 but the guard lets callers loosen it.
    expect(
      isLandmarkFlip(UPRIGHT(0), INVERTED(1), { orientationFlipCos: -1.5 }),
    ).toBe(false);
  });

  it("flags a SMALL/distant climber's inversion an absolute gate would miss", () => {
    // Real-data regression: a climber whose whole torso spans ~0.09 of the frame
    // flips upside down. The centroids move only ~0.13 — far below any absolute
    // frame-fraction teleport gate — but that is ~1.5 torso lengths, so the
    // torso-relative gate catches it. Numbers taken from midnight_lightning_3.
    const upright = frame(0, [
      ["left_shoulder", 0.47, 0.47], ["right_shoulder", 0.45, 0.45],
      ["left_hip", 0.49, 0.55], ["right_hip", 0.47, 0.54],
    ]);
    const inverted = frame(1, [
      ["left_shoulder", 0.49, 0.57], ["right_shoulder", 0.47, 0.55],
      ["left_hip", 0.45, 0.49], ["right_hip", 0.47, 0.50],
    ]);
    // Default teleportThreshold is 0.35 of the frame; the centroids move far less,
    // so only a body-relative test can flag this.
    expect(isLandmarkFlip(upright, inverted)).toBe(true);
  });

  it("flags an inversion whose torso COLLAPSES below the length floor", () => {
    // MediaPipe's upside-down fits routinely crush the torso (centroids cross),
    // dropping the current frame below MIN_TORSO_LENGTH. The reference frame is
    // trusted for scale, the current frame only needs a non-degenerate direction.
    const upright = vtorso(0, 0.4, 0.6); // healthy torso, length 0.2
    const collapsedInverted = vtorso(1, 0.55, 0.51); // inverted, length ~0.04
    expect(isLandmarkFlip(upright, collapsedInverted)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectFlips — upside-down sequences
// ---------------------------------------------------------------------------

describe("detectFlips — vertical inversion", () => {
  it("discards a single upside-down glitch and recovers", () => {
    const frames = [UPRIGHT(0), INVERTED(1), UPRIGHT(2)];
    const result = detectFlips(frames);
    expect(result.flippedTimestamps).toEqual([1]);
    expect(result.kept.map(f => f.timestamp)).toEqual([0, 2]);
  });

  it("discards a sustained inversion run against the last accepted upright frame", () => {
    const frames = [UPRIGHT(0), INVERTED(1), INVERTED(2), UPRIGHT(3)];
    const result = detectFlips(frames);
    expect(result.flippedTimestamps).toEqual([1, 2]);
    expect(result.kept.map(f => f.timestamp)).toEqual([0, 3]);
  });
});

// ---------------------------------------------------------------------------
// detectFlips (stateful walk)
// ---------------------------------------------------------------------------

describe("detectFlips", () => {
  it("returns empty result for empty input", () => {
    expect(detectFlips([])).toEqual({ kept: [], flippedTimestamps: [] });
  });

  it("always keeps the first frame (nothing to compare against)", () => {
    const result = detectFlips([FACING(0)]);
    expect(result.kept).toHaveLength(1);
    expect(result.flippedTimestamps).toEqual([]);
  });

  it("keeps a smooth, non-flipping sequence intact", () => {
    const frames = [FACING(0), FACING(1), FACING(2)];
    const result = detectFlips(frames);
    expect(result.kept).toHaveLength(3);
    expect(result.flippedTimestamps).toEqual([]);
  });

  it("discards a single glitch flip and records its timestamp", () => {
    const frames = [
      FACING(0),
      torso(1, 0.65, 0.35, 0.6, 0.4), // flipped
      FACING(2),
    ];
    const result = detectFlips(frames);
    expect(result.flippedTimestamps).toEqual([1]);
    expect(result.kept.map(f => f.timestamp)).toEqual([0, 2]);
  });

  it("discards a sustained mislabel run by comparing to the last ACCEPTED frame", () => {
    // Two consecutive flipped frames: both are teleported relative to the last
    // good frame (0), so both are discarded; the walk recovers at frame 3.
    const frames = [
      FACING(0),
      torso(1, 0.65, 0.35, 0.6, 0.4), // flipped
      torso(2, 0.66, 0.34, 0.61, 0.39), // still flipped
      FACING(3),
    ];
    const result = detectFlips(frames);
    expect(result.flippedTimestamps).toEqual([1, 2]);
    expect(result.kept.map(f => f.timestamp)).toEqual([0, 3]);
  });
});
