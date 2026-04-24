import { describe, it, expect, vi } from "vitest";
import {
  interpolatePoseFrames,
  smoothPoseFrames,
  filterLandmarks,
  estimateMissingLandmarks,
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

  it("returns empty keypoints for timestamps before the first detected frame", () => {
    const processed = [frame(1.0, [["nose", 0.5, 0.1]])];
    const result = interpolatePoseFrames(processed, [0.0, 0.5, 1.0]);
    // Timestamps 0.0 and 0.5 are before the first detection — must be empty.
    expect(result[0].keypoints).toEqual([]);
    expect(result[1].keypoints).toEqual([]);
    // Timestamp 1.0 exactly matches the detection — keypoints present.
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
    const frames: PoseFrame[] = [
      frame(0, [["nose", 0.5, 0.5]]),
      { timestamp: 1, keypoints: [] },
      frame(2, [["nose", 0.7, 0.7]]),
    ];
    const result = smoothPoseFrames(frames);
    expect(result[1].keypoints.find(k => k.name === "nose")).toBeUndefined();
    // The filter state carries into frames where the keypoint reappears.
    const reappeared = result[2].keypoints.find(k => k.name === "nose")!;
    expect(reappeared).toBeDefined();
    // One-Euro smooths the reappeared value toward the prior state.
    expect(reappeared.x).toBeGreaterThan(0.5);
    expect(reappeared.x).toBeLessThan(0.7);
  });

  it("seeds a freshly appearing keypoint as its first value (no backward fill)", () => {
    const frames: PoseFrame[] = [
      { timestamp: 0, keypoints: [] },
      { timestamp: 1, keypoints: [] },
      frame(2, [["nose", 0.5, 0.5]]),
    ];
    const result = smoothPoseFrames(frames);
    expect(result[0].keypoints.find(k => k.name === "nose")).toBeUndefined();
    expect(result[1].keypoints.find(k => k.name === "nose")).toBeUndefined();
    const seeded = result[2].keypoints.find(k => k.name === "nose")!;
    expect(seeded).toBeDefined();
    expect(seeded.x).toBeCloseTo(0.5);
    expect(seeded.y).toBeCloseTo(0.5);
  });

  it("with very high minCutoff leaves values nearly unchanged", () => {
    const frames = [
      frame(0, [["left_hip", 0.3, 0.4]]),
      frame(1, [["left_hip", 0.7, 0.8]]),
    ];
    // minCutoff=10000 → alpha ≈ 1 → near pass-through
    const result = smoothPoseFrames(frames, 10000, 0);
    expect(result[0].keypoints[0].x).toBeCloseTo(0.3, 2);
    expect(result[0].keypoints[0].y).toBeCloseTo(0.4, 2);
    expect(result[1].keypoints[0].x).toBeCloseTo(0.7, 2);
    expect(result[1].keypoints[0].y).toBeCloseTo(0.8, 2);
  });

  it("with default parameters the second frame is smoothed toward the first", () => {
    const frames = [
      frame(0, [["nose", 0.0, 0.0]]),
      frame(1, [["nose", 1.0, 1.0]]),
    ];
    const result = smoothPoseFrames(frames);
    const kp = result[1].keypoints.find(k => k.name === "nose")!;
    // The One-Euro filter smooths the jump — value should be between 0 and 1.
    expect(kp.x).toBeGreaterThan(0.0);
    expect(kp.x).toBeLessThan(1.0);
  });

  it("processes multiple keypoints independently", () => {
    const frames = [
      frame(0, [["nose", 0.0, 0.0], ["left_hip", 1.0, 1.0]]),
      frame(1, [["nose", 1.0, 1.0], ["left_hip", 0.0, 0.0]]),
    ];
    // Very high minCutoff → near pass-through
    const result = smoothPoseFrames(frames, 10000, 0);
    const nose1 = result[1].keypoints.find(k => k.name === "nose")!;
    const hip1  = result[1].keypoints.find(k => k.name === "left_hip")!;
    expect(nose1.x).toBeCloseTo(1.0, 2);
    expect(hip1.x).toBeCloseTo(0.0, 2);
  });
});

// ---------------------------------------------------------------------------
// filterLandmarks
// ---------------------------------------------------------------------------

// Build a frame with all 33 MediaPipe keypoints, each above threshold.
function goodFrame(ts: number): PoseFrame {
  return frame(ts, [
    ["nose", 0.5, 0.1],
    ["left_eye_inner", 0.48, 0.09],
    ["left_eye", 0.46, 0.09],
    ["left_eye_outer", 0.44, 0.09],
    ["right_eye_inner", 0.52, 0.09],
    ["right_eye", 0.54, 0.09],
    ["right_eye_outer", 0.56, 0.09],
    ["left_ear", 0.4, 0.1],
    ["right_ear", 0.6, 0.1],
    ["mouth_left", 0.48, 0.12],
    ["mouth_right", 0.52, 0.12],
    ["left_shoulder", 0.35, 0.25],
    ["right_shoulder", 0.65, 0.25],
    ["left_elbow", 0.3, 0.4],
    ["right_elbow", 0.7, 0.4],
    ["left_wrist", 0.28, 0.55],
    ["right_wrist", 0.72, 0.55],
    ["left_pinky", 0.27, 0.57],
    ["right_pinky", 0.73, 0.57],
    ["left_index", 0.28, 0.58],
    ["right_index", 0.72, 0.58],
    ["left_thumb", 0.29, 0.56],
    ["right_thumb", 0.71, 0.56],
    ["left_hip", 0.4, 0.6],
    ["right_hip", 0.6, 0.6],
    ["left_knee", 0.38, 0.75],
    ["right_knee", 0.62, 0.75],
    ["left_ankle", 0.37, 0.9],
    ["right_ankle", 0.63, 0.9],
    ["left_heel", 0.36, 0.92],
    ["right_heel", 0.64, 0.92],
    ["left_foot_index", 0.38, 0.93],
    ["right_foot_index", 0.62, 0.93],
  ]);
}

describe("filterLandmarks", () => {
  it("returns an empty array when given an empty array", () => {
    expect(filterLandmarks([])).toEqual([]);
  });

  it("keeps frames with all 33 high-confidence keypoints", () => {
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

  it("uses custom keypointCount to allow fewer keypoints", () => {
    // Build a frame with only 10 keypoints — less than default 33.
    const f = frame(0, Array.from({ length: 10 }, (_, i) => [`kp_${i}`, 0.5, 0.5, 0.9]));
    // Default keypointCount=33: 23 missing > maxMissingAllowed(2) → dropped.
    expect(filterLandmarks([f])).toHaveLength(0);
    // With keypointCount=10: 0 missing → kept.
    expect(filterLandmarks([f], 0.3, 2, 10)).toHaveLength(1);
  });

  it("keeps MediaPipe frames when enough keypoints are present", () => {
    // Build a frame with 33 high-confidence keypoints.
    const mp33 = frame(0, Array.from({ length: 33 }, (_, i) => [`kp_${i}`, 0.5, 0.5, 0.9]));
    expect(filterLandmarks([mp33], 0.3, 2, 33)).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// estimateMissingLandmarks
// ---------------------------------------------------------------------------

describe("estimateMissingLandmarks", () => {
  it("returns an empty array when given an empty array", () => {
    expect(estimateMissingLandmarks([])).toEqual([]);
  });

  it("returns frames unchanged when all 33 keypoints are present", () => {
    const frames = [goodFrame(0), goodFrame(1)];
    const result = estimateMissingLandmarks(frames);
    expect(result[0].keypoints).toHaveLength(33);
    expect(result[1].keypoints).toHaveLength(33);
  });

  it("fills a missing keypoint via temporal interpolation from prev and next", () => {
    // Frame 0 and 2 have left_wrist; frame 1 is missing it.
    const f0 = frame(0, [["left_wrist", 0.2, 0.4, 0.9], ["left_elbow", 0.3, 0.3, 0.9]]);
    const f1 = frame(1, [["left_elbow", 0.35, 0.35, 0.9]]);
    const f2 = frame(2, [["left_wrist", 0.4, 0.6, 0.9], ["left_elbow", 0.4, 0.4, 0.9]]);
    const result = estimateMissingLandmarks([f0, f1, f2], 10, 33);
    const estimated = result[1].keypoints.find(k => k.name === "left_wrist");
    expect(estimated).toBeDefined();
    // Temporal lerp: midpoint between (0.2, 0.4) and (0.4, 0.6).
    expect(estimated!.x).toBeCloseTo(0.3);
    expect(estimated!.y).toBeCloseTo(0.5);
    // Score is discounted.
    expect(estimated!.score).toBeLessThan(0.9);
  });

  it("uses structural estimation when only one temporal side is available", () => {
    // Frame 0 has both left_wrist and left_elbow.
    // Frame 1 has left_elbow but not left_wrist → structural can estimate.
    const f0 = frame(0, [["left_wrist", 0.2, 0.5, 0.9], ["left_elbow", 0.3, 0.3, 0.9]]);
    const f1 = frame(1, [["left_elbow", 0.35, 0.35, 0.9]]);
    // No frame 2 with left_wrist → no temporal lerp, so structural kicks in.
    const result = estimateMissingLandmarks([f0, f1], 10, 33);
    const est = result[1].keypoints.find(k => k.name === "left_wrist");
    expect(est).toBeDefined();
    // Bone vector from frame 0: wrist(0.2, 0.5) - elbow(0.3, 0.3) = (-0.1, 0.2)
    // Applied to current elbow (0.35, 0.35) → (0.25, 0.55)
    expect(est!.x).toBeCloseTo(0.25);
    expect(est!.y).toBeCloseTo(0.55);
    // Structural confidence is discounted.
    expect(est!.score).toBeLessThan(0.9);
  });

  it("skips estimation when too many keypoints are missing (> maxEstimatable)", () => {
    // One frame with only 2 keypoints — 15 missing > default maxEstimatable(5).
    const f = frame(0, [["nose", 0.5, 0.5, 0.9], ["left_eye", 0.4, 0.4, 0.9]]);
    const result = estimateMissingLandmarks([f]);
    // Frame returned unchanged.
    expect(result[0].keypoints).toHaveLength(2);
  });

  it("uses single-neighbour extrapolation within 2 frames distance", () => {
    // Frame 0 has nose; frame 1 does not. No next frame with nose.
    // prev is 1 frame away (≤ 2), so extrapolation should apply.
    const f0 = frame(0, [["nose", 0.5, 0.5, 0.9]]);
    const f1: PoseFrame = { timestamp: 1, keypoints: [] };
    const result = estimateMissingLandmarks([f0, f1], 10, 33);
    const est = result[1].keypoints.find(k => k.name === "nose");
    expect(est).toBeDefined();
    expect(est!.x).toBeCloseTo(0.5);
    expect(est!.score).toBeCloseTo(0.45); // 0.9 * 0.5
  });

  it("accepts 'mediapipe' backend for MediaPipe topology estimation", () => {
    // MediaPipe topology has 33 keypoints. We need enough present keypoints
    // so that the missing count (1) is within maxEstimatable.
    // Build frames with most MediaPipe keypoints, leaving left_elbow missing in f1.
    const mpKps: Array<[string, number, number, number?]> = [
      ["nose", 0.5, 0.1], ["left_eye_inner", 0.48, 0.09],
      ["left_eye", 0.46, 0.09], ["left_eye_outer", 0.44, 0.09],
      ["right_eye_inner", 0.52, 0.09], ["right_eye", 0.54, 0.09],
      ["right_eye_outer", 0.56, 0.09], ["left_ear", 0.4, 0.1],
      ["right_ear", 0.6, 0.1], ["mouth_left", 0.48, 0.12],
      ["mouth_right", 0.52, 0.12], ["left_shoulder", 0.35, 0.25],
      ["right_shoulder", 0.65, 0.25], ["left_elbow", 0.3, 0.4],
      ["right_elbow", 0.7, 0.4], ["left_wrist", 0.28, 0.55],
      ["right_wrist", 0.72, 0.55], ["left_pinky", 0.27, 0.57],
      ["right_pinky", 0.73, 0.57], ["left_index", 0.28, 0.58],
      ["right_index", 0.72, 0.58], ["left_thumb", 0.29, 0.56],
      ["right_thumb", 0.71, 0.56], ["left_hip", 0.4, 0.6],
      ["right_hip", 0.6, 0.6], ["left_knee", 0.38, 0.75],
      ["right_knee", 0.62, 0.75], ["left_ankle", 0.37, 0.9],
      ["right_ankle", 0.63, 0.9], ["left_heel", 0.36, 0.92],
      ["right_heel", 0.64, 0.92], ["left_foot_index", 0.38, 0.93],
      ["right_foot_index", 0.62, 0.93],
    ];
    const f0 = frame(0, mpKps);
    // f1 is missing left_elbow (only 1 missing, within maxEstimatable=5).
    const f1Kps = mpKps.filter(([name]) => name !== "left_elbow");
    const f1 = frame(1, f1Kps);
    const result = estimateMissingLandmarks([f0, f1], 10, 5, "mediapipe");
    const est = result[1].keypoints.find(k => k.name === "left_elbow");
    expect(est).toBeDefined();
  });

  it("returns frames unchanged with mediapipe backend when all keypoints present", () => {
    const frames = [goodFrame(0), goodFrame(1)];
    const result = estimateMissingLandmarks(frames, 10, 5, "mediapipe");
    expect(result[0].keypoints).toHaveLength(33);
    expect(result[1].keypoints).toHaveLength(33);
  });
});
