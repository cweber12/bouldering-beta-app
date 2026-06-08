import { describe, it, expect } from "vitest";
import {
  detectFlips,
  isLandmarkFlip,
} from "@/pipeline/flipDetection";
import type { PoseFrame } from "@/pipeline/poseDetection";

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
