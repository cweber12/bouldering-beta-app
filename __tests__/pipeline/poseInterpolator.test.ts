import { describe, it, expect, vi } from "vitest";
import {
  interpolatePoseFrames,
  smoothPoseFrames,
  filterLandmarks,
  applyLandmarkEstimator,
  type LandmarkEstimator,
} from "@/pipeline/poseInterpolator";
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

// ---------------------------------------------------------------------------
// interpolatePoseFrames
// ---------------------------------------------------------------------------

describe("interpolatePoseFrames", () => {
  it("returns an empty-keypoints frame for every timestamp when processedFrames is empty", () => {
    const result = interpolatePoseFrames([], [0, 0.1, 0.2]);
    expect(result).toHaveLength(3);
    result.forEach(f => expect(f.keypoints).toEqual([]));
    expect(result.map(f => f.timestamp)).toEqual([0, 0.1, 0.2]);
  });

  it("returns exact frames when timestamps match processed frames exactly", () => {
    const processed = [
      frame(0.0, [["nose", 0.5, 0.1]]),
      frame(0.5, [["nose", 0.6, 0.2]]),
    ];
    const result = interpolatePoseFrames(processed, [0.0, 0.5]);
    expect(result[0].keypoints[0]).toMatchObject({ x: 0.5, y: 0.1 });
    expect(result[1].keypoints[0]).toMatchObject({ x: 0.6, y: 0.2 });
  });

  it("linearly interpolates x and y at the midpoint", () => {
    const processed = [
      frame(0.0, [["left_hip", 0.4, 0.4]]),
      frame(1.0, [["left_hip", 0.6, 0.8]]),
    ];
    const result = interpolatePoseFrames(processed, [0.0, 0.5, 1.0]);
    const mid = result[1].keypoints[0];
    expect(mid.x).toBeCloseTo(0.5); // (0.4 + 0.6) / 2
    expect(mid.y).toBeCloseTo(0.6); // (0.4 + 0.8) / 2
  });

  it("uses the minimum score of the two anchor frames", () => {
    const processed = [
      frame(0.0, [["nose", 0.5, 0.5, 0.9]]),
      frame(1.0, [["nose", 0.5, 0.5, 0.4]]),
    ];
    const result = interpolatePoseFrames(processed, [0.0, 0.5, 1.0]);
    expect(result[1].keypoints[0].score).toBe(0.4);
  });

  it("holds first pose for timestamps before the first detected frame", () => {
    const processed = [frame(1.0, [["nose", 0.5, 0.1]])];
    const result = interpolatePoseFrames(processed, [0.0, 0.5, 1.0]);
    // Timestamps 0.0 and 0.5 are before the first detection.
    expect(result[0].keypoints[0]).toMatchObject({ x: 0.5, y: 0.1 });
    expect(result[1].keypoints[0]).toMatchObject({ x: 0.5, y: 0.1 });
    expect(result[2].keypoints[0]).toMatchObject({ x: 0.5, y: 0.1 });
  });

  it("holds last pose for timestamps after the final detected frame", () => {
    const processed = [frame(0.0, [["nose", 0.5, 0.1]])];
    const result = interpolatePoseFrames(processed, [0.0, 0.5, 1.0]);
    expect(result[1].keypoints[0]).toMatchObject({ x: 0.5, y: 0.1 });
    expect(result[2].keypoints[0]).toMatchObject({ x: 0.5, y: 0.1 });
  });

  it("only interpolates keypoints present in both anchor frames", () => {
    const processed = [
      frame(0.0, [["left_hip", 0.4, 0.5], ["nose", 0.5, 0.1]]),
      frame(1.0, [["left_hip", 0.6, 0.7]]), // nose is missing in second frame
    ];
    const result = interpolatePoseFrames(processed, [0.0, 0.5, 1.0]);
    const midKps = result[1].keypoints.map(k => k.name);
    // nose disappears at the midpoint because it is absent in the to-frame.
    expect(midKps).not.toContain("nose");
    expect(midKps).toContain("left_hip");
  });

  it("produces one output frame per input timestamp", () => {
    const processed = [frame(0, [["nose", 0.5, 0.5]]), frame(1, [["nose", 0.6, 0.6]])];
    const timestamps = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    const result = interpolatePoseFrames(processed, timestamps);
    expect(result).toHaveLength(timestamps.length);
    result.forEach((f, i) => expect(f.timestamp).toBe(timestamps[i]));
  });
});

// ---------------------------------------------------------------------------
// smoothPoseFrames
// ---------------------------------------------------------------------------

describe("smoothPoseFrames", () => {
  it("returns an empty array when given an empty array", () => {
    expect(smoothPoseFrames([])).toEqual([]);
  });

  it("preserves timestamps unchanged", () => {
    const frames = [frame(0.0, [["nose", 0.5, 0.5]]), frame(0.5, [["nose", 0.6, 0.6]])];
    const result = smoothPoseFrames(frames);
    expect(result.map(f => f.timestamp)).toEqual([0.0, 0.5]);
  });

  it("does not fill missing keypoints — absent keypoints remain absent", () => {
    // EMA-only: frame 0 has 'nose'; frame 1 has no 'nose' — it stays absent.
    const frames: PoseFrame[] = [
      frame(0, [["nose", 0.5, 0.5]]),
      { timestamp: 1, keypoints: [] },
      frame(2, [["nose", 0.7, 0.7]]),
    ];
    const result = smoothPoseFrames(frames);
    // EMA never fills gaps — frame 1 has no nose keypoint.
    expect(result[1].keypoints.find(k => k.name === "nose")).toBeUndefined();
    // The EMA state carries into frames where the keypoint reappears.
    const reappeared = result[2].keypoints.find(k => k.name === "nose")!;
    expect(reappeared).toBeDefined();
    // With default alpha=0.3 the value should be smoothed toward the prior EMA
    // (which was seeded at 0.5), so x must be between 0.5 and 0.7.
    expect(reappeared.x).toBeGreaterThan(0.5);
    expect(reappeared.x).toBeLessThan(0.7);
  });

  it("seeds a freshly appearing keypoint as its first value (no backward fill)", () => {
    // Frames 0–1 have no 'nose'; frame 2 first detects it.
    const frames: PoseFrame[] = [
      { timestamp: 0, keypoints: [] },
      { timestamp: 1, keypoints: [] },
      frame(2, [["nose", 0.5, 0.5]]),
    ];
    const result = smoothPoseFrames(frames);
    // No backward fill — frames 0 and 1 remain empty.
    expect(result[0].keypoints.find(k => k.name === "nose")).toBeUndefined();
    expect(result[1].keypoints.find(k => k.name === "nose")).toBeUndefined();
    // Frame 2 seeds the EMA so its value is returned exactly (no prior state).
    const seeded = result[2].keypoints.find(k => k.name === "nose")!;
    expect(seeded).toBeDefined();
    expect(seeded.x).toBeCloseTo(0.5);
    expect(seeded.y).toBeCloseTo(0.5);
  });

  it("with alpha=1 leaves values exactly as-is (no smoothing)", () => {
    const frames = [
      frame(0, [["left_hip", 0.3, 0.4]]),
      frame(1, [["left_hip", 0.7, 0.8]]),
    ];
    const result = smoothPoseFrames(frames, 1.0);
    expect(result[0].keypoints[0]).toMatchObject({ x: 0.3, y: 0.4 });
    expect(result[1].keypoints[0]).toMatchObject({ x: 0.7, y: 0.8 });
  });

  it("with alpha<1 the second frame is smoothed toward the first", () => {
    // alpha=0.5 → second value = 0.5*x1 + 0.5*x0
    const frames = [
      frame(0, [["nose", 0.0, 0.0]]),
      frame(1, [["nose", 1.0, 1.0]]),
    ];
    const result = smoothPoseFrames(frames, 0.5);
    const kp = result[1].keypoints.find(k => k.name === "nose")!;
    expect(kp.x).toBeCloseTo(0.5);
    expect(kp.y).toBeCloseTo(0.5);
  });

  it("processes multiple keypoints independently", () => {
    const frames = [
      frame(0, [["nose", 0.0, 0.0], ["left_hip", 1.0, 1.0]]),
      frame(1, [["nose", 1.0, 1.0], ["left_hip", 0.0, 0.0]]),
    ];
    const result = smoothPoseFrames(frames, 1.0); // alpha=1 → no smoothing
    const nose1 = result[1].keypoints.find(k => k.name === "nose")!;
    const hip1  = result[1].keypoints.find(k => k.name === "left_hip")!;
    expect(nose1.x).toBeCloseTo(1.0);
    expect(hip1.x).toBeCloseTo(0.0);
  });
});

// ---------------------------------------------------------------------------
// filterLandmarks
// ---------------------------------------------------------------------------

// Build a frame where every keypoint has a score above threshold.
function goodFrame(ts: number): PoseFrame {
  return frame(ts, [
    ["nose", 0.5, 0.5, 0.9],
    ["left_eye", 0.4, 0.4, 0.9],
    ["right_eye", 0.6, 0.4, 0.9],
    ["left_ear", 0.3, 0.5, 0.9],
    ["right_ear", 0.7, 0.5, 0.9],
    ["left_shoulder", 0.3, 0.6, 0.9],
    ["right_shoulder", 0.7, 0.6, 0.9],
    ["left_elbow", 0.3, 0.7, 0.9],
    ["right_elbow", 0.7, 0.7, 0.9],
    ["left_wrist", 0.3, 0.8, 0.9],
    ["right_wrist", 0.7, 0.8, 0.9],
    ["left_hip", 0.4, 0.85, 0.9],
    ["right_hip", 0.6, 0.85, 0.9],
    ["left_knee", 0.4, 0.9, 0.9],
    ["right_knee", 0.6, 0.9, 0.9],
    ["left_ankle", 0.4, 0.95, 0.9],
    ["right_ankle", 0.6, 0.95, 0.9],
  ]);
}

describe("filterLandmarks", () => {
  it("returns an empty array when given an empty array", () => {
    expect(filterLandmarks([])).toEqual([]);
  });

  it("keeps frames with all 17 high-confidence keypoints", () => {
    const frames = [goodFrame(0), goodFrame(1)];
    expect(filterLandmarks(frames)).toHaveLength(2);
  });

  it("keeps frames with exactly maxMissingAllowed low-confidence keypoints", () => {
    const f = goodFrame(0);
    // Drop score on 2 keypoints to below threshold but keep them present.
    f.keypoints[0].score = 0.1;
    f.keypoints[1].score = 0.1;
    // 2 low-confidence == maxMissingAllowed(2), so frame is kept.
    expect(filterLandmarks([f])).toHaveLength(1);
  });

  it("drops frames with more than maxMissingAllowed low-confidence keypoints", () => {
    const f = goodFrame(0);
    // 3 keypoints with score below threshold.
    f.keypoints[0].score = 0.1;
    f.keypoints[1].score = 0.1;
    f.keypoints[2].score = 0.1;
    expect(filterLandmarks([f])).toHaveLength(0);
  });

  it("counts completely absent keypoints toward the missing tally", () => {
    // A frame with only 14 keypoints — 3 are absent (counted as missing).
    const f = frame(0, [
      ["nose", 0.5, 0.5, 0.9],
      ["left_eye", 0.4, 0.4, 0.9],
      ["right_eye", 0.6, 0.4, 0.9],
      ["left_ear", 0.3, 0.5, 0.9],
      ["right_ear", 0.7, 0.5, 0.9],
      ["left_shoulder", 0.3, 0.6, 0.9],
      ["right_shoulder", 0.7, 0.6, 0.9],
      ["left_elbow", 0.3, 0.7, 0.9],
      ["right_elbow", 0.7, 0.7, 0.9],
      ["left_wrist", 0.3, 0.8, 0.9],
      ["right_wrist", 0.7, 0.8, 0.9],
      ["left_hip", 0.4, 0.85, 0.9],
      ["right_hip", 0.6, 0.85, 0.9],
      ["left_knee", 0.4, 0.9, 0.9],
      // right_knee, left_ankle, right_ankle absent — 3 missing
    ]);
    // 3 missing > 2 allowed, so it should be dropped.
    expect(filterLandmarks([f])).toHaveLength(0);
  });

  it("respects a custom maxMissingAllowed threshold", () => {
    const f = goodFrame(0);
    // 1 low-confidence keypoint.
    f.keypoints[0].score = 0.1;
    // maxMissingAllowed=0 → drop even 1 bad keypoint.
    expect(filterLandmarks([f], 0.3, 0)).toHaveLength(0);
    // maxMissingAllowed=1 → keep it.
    expect(filterLandmarks([f], 0.3, 1)).toHaveLength(1);
  });

  it("respects a custom minScore threshold", () => {
    const f = goodFrame(0);
    // All scores are 0.9 — raising the threshold above that drops all.
    f.keypoints.forEach(kp => { kp.score = 0.5; });
    // minScore=0.6 makes all keypoints "low confidence".
    expect(filterLandmarks([f], 0.6, 0)).toHaveLength(0);
    // minScore=0.4 keeps all keypoints — frame is good.
    expect(filterLandmarks([f], 0.4, 0)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// applyLandmarkEstimator
// ---------------------------------------------------------------------------

describe("applyLandmarkEstimator", () => {
  it("passes each frame and its neighbours to the estimator", () => {
    const frames = [goodFrame(0), goodFrame(1), goodFrame(2)];
    const estimator = vi.fn<LandmarkEstimator>((f) => f);
    applyLandmarkEstimator(frames, estimator);
    expect(estimator).toHaveBeenCalledTimes(3);
    // frame index 1 receives prev=frames[0] and next=frames[2].
    const [, ctx] = estimator.mock.calls[1];
    expect(ctx.prev).toBe(frames[0]);
    expect(ctx.next).toBe(frames[2]);
  });

  it("passes null for prev on the first frame and null for next on the last", () => {
    const frames = [goodFrame(0), goodFrame(1)];
    const estimator = vi.fn<LandmarkEstimator>((f) => f);
    applyLandmarkEstimator(frames, estimator);
    // First frame: prev is null.
    expect(estimator.mock.calls[0][1].prev).toBeNull();
    // Last frame: next is null.
    expect(estimator.mock.calls[1][1].next).toBeNull();
  });

  it("returns the results of the estimator in order", () => {
    const frames = [goodFrame(0), goodFrame(1)];
    const modified: PoseFrame = { ...frames[0], timestamp: 99 };
    const estimator = vi.fn<LandmarkEstimator>().mockReturnValue(modified);
    const result = applyLandmarkEstimator(frames, estimator);
    expect(result).toHaveLength(2);
    result.forEach(f => expect(f.timestamp).toBe(99));
  });

  it("returns an empty array when given an empty array", () => {
    const estimator = vi.fn<LandmarkEstimator>((f) => f);
    expect(applyLandmarkEstimator([], estimator)).toEqual([]);
    expect(estimator).not.toHaveBeenCalled();
  });
});
