import { describe, it, expect, vi } from "vitest";
import {
  interpolatePoseFrames,
  smoothPoseFrames,
  filterLandmarks,
  estimateMissingLandmarks,
  fillPersistentGaps,
  PERSISTENT_GAP_SCORE_FACTOR,
  applyLandmarkEstimator,
  type LandmarkEstimator,
} from "@/pipeline/poseInterpolator";
import type { PoseFrame } from "@/pipeline/poseDetection";
import { MP_KP_NAMES } from "@/utils/poseConstants";

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

  it("interpolates shared keypoints and holds one-anchor keypoints (attenuated)", () => {
    const processed = [
      frame(0.0, [["left_hip", 0.4, 0.5], ["nose", 0.5, 0.1, 0.8]]),
      frame(1.0, [["left_hip", 0.6, 0.7]]), // nose is missing in second frame
    ];
    const result = interpolatePoseFrames(processed, [0.0, 0.5, 1.0]);
    const mid = result[1].keypoints;
    // left_hip is in both anchors → interpolated to the midpoint.
    const hip = mid.find(k => k.name === "left_hip")!;
    expect(hip.x).toBeCloseTo(0.5);
    // nose is in only the first anchor → HELD at its position, not dropped, with
    // an attenuated score so the renderer can dim it.
    const nose = mid.find(k => k.name === "nose")!;
    expect(nose).toBeDefined();
    expect(nose.x).toBeCloseTo(0.5);
    expect(nose.y).toBeCloseTo(0.1);
    expect(nose.score).toBeCloseTo(0.4); // 0.8 × HELD factor (0.5)
  });

  it("produces one output frame per input timestamp", () => {
    const processed = [frame(0, [["nose", 0.5, 0.5]]), frame(1, [["nose", 0.6, 0.6]])];
    const timestamps = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    const result = interpolatePoseFrames(processed, timestamps);
    expect(result).toHaveLength(timestamps.length);
    result.forEach((f, i) => expect(f.timestamp).toBe(timestamps[i]));
  });

  it("bridges a joint missing from an intermediate anchor instead of freezing it", () => {
    // The wrist is detected at t=0 and t=2 but occluded (absent) at the t=1
    // anchor; the elbow is present throughout and moving. The wrist must
    // interpolate across its OWN detections (no freeze, no snap), not hold at
    // the t=0 position while the elbow slides away — the limb-stretch bug.
    const processed = [
      frame(0.0, [["left_wrist", 0.2, 0.2], ["left_elbow", 0.2, 0.4]]),
      frame(0.5, [["left_elbow", 0.5, 0.4]]), // wrist occluded here
      frame(1.0, [["left_wrist", 0.8, 0.2], ["left_elbow", 0.8, 0.4]]),
    ];
    const result = interpolatePoseFrames(processed, [0, 0.25, 0.5, 0.75, 1.0]);

    const wristAt = (i: number) =>
      result[i].keypoints.find(k => k.name === "left_wrist");

    // Wrist is present across the whole span (bridged), never dropped.
    expect(wristAt(1)).toBeDefined(); // t=0.5
    expect(wristAt(2)).toBeDefined(); // t=1.0 (the occluded anchor)
    expect(wristAt(3)).toBeDefined(); // t=1.5

    // It tracks its real trajectory 0.2 → 0.8 monotonically, not frozen at 0.2.
    const xs = [wristAt(0)!.x, wristAt(1)!.x, wristAt(2)!.x, wristAt(3)!.x, wristAt(4)!.x];
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]); // strictly increasing — no snap
    }
    // At t=1 the wrist sits near the elbow's mid-travel (0.5), not at 0.2.
    expect(wristAt(2)!.x).toBeCloseTo(0.5, 1);

    // Bridged (inferred) values are attenuated so the renderer can dim them.
    expect(wristAt(2)!.score).toBeLessThan(0.9);
  });

  it("omits a joint absent for longer than maxBridgeGap rather than bridging it", () => {
    // The wrist vanishes for 2 s (anchors 0 → 2) — too long to invent a path.
    // With maxBridgeGap=1.0 the joint stays absent through the gap instead of
    // sliding a fake straight line; the always-visible elbow is unaffected.
    const processed = [
      frame(0, [["left_wrist", 0.2, 0.2], ["left_elbow", 0.2, 0.4]]),
      frame(1, [["left_elbow", 0.5, 0.4]]),
      frame(2, [["left_wrist", 0.8, 0.2], ["left_elbow", 0.8, 0.4]]),
    ];
    const result = interpolatePoseFrames(processed, [0, 1, 2], 1.0);
    // Mid-gap (the t=1 anchor): wrist omitted, elbow present.
    expect(result[1].keypoints.find(k => k.name === "left_wrist")).toBeUndefined();
    expect(result[1].keypoints.find(k => k.name === "left_elbow")).toBeDefined();
    // Endpoints still carry their real detections.
    expect(result[0].keypoints.find(k => k.name === "left_wrist")).toBeDefined();
    expect(result[2].keypoints.find(k => k.name === "left_wrist")).toBeDefined();
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

  it("is zero-phase: time-reversing the input reverses the output (no directional lag)", () => {
    // A step at the middle. A causal (forward-only) filter would lag the step,
    // making the forward and time-reversed responses asymmetric. The zero-phase
    // filter is symmetric: smoothing the reversed sequence yields the reverse of
    // smoothing the forward sequence.
    const ts = [0, 1, 2, 3, 4, 5];
    const fwdVals = [0, 0, 0, 1, 1, 1];
    const fwd = ts.map((t, i) => frame(t, [["nose", fwdVals[i], 0]]));
    // Same timestamps, values reversed in order (a mirror-image step).
    const rev = ts.map((t, i) => frame(t, [["nose", fwdVals[fwdVals.length - 1 - i], 0]]));

    const outFwd = smoothPoseFrames(fwd).map(f => f.keypoints[0].x);
    const outRev = smoothPoseFrames(rev).map(f => f.keypoints[0].x);

    // One-Euro's cutoff is speed-dependent (nonlinear), so the filter is only
    // approximately zero-phase — symmetric to ~0.5% rather than bit-exact. A
    // causal forward-only filter would be grossly asymmetric here (the lagged
    // step would land several frames late), so this still pins down zero-phase.
    for (let i = 0; i < ts.length; i++) {
      expect(outFwd[i]).toBeCloseTo(outRev[ts.length - 1 - i], 2);
    }
  });

  it("smooths a mid-sequence spike toward its neighbours (jitter rejection)", () => {
    // Single-frame outlier surrounded by a constant signal. Zero-phase smoothing
    // must pull the spike back toward the baseline from both sides.
    const frames = [
      frame(0, [["nose", 0.5, 0.5]]),
      frame(1, [["nose", 0.5, 0.5]]),
      frame(2, [["nose", 0.9, 0.5]]), // spike
      frame(3, [["nose", 0.5, 0.5]]),
      frame(4, [["nose", 0.5, 0.5]]),
    ];
    const result = smoothPoseFrames(frames);
    const spike = result[2].keypoints[0].x;
    // Pulled down from 0.9, but still above the 0.5 baseline.
    expect(spike).toBeLessThan(0.9);
    expect(spike).toBeGreaterThan(0.5);
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

/** Drop named keypoints from a frame (simulating absent detections). */
function dropKeypoints(f: PoseFrame, ...names: string[]): PoseFrame {
  const drop = new Set(names);
  return { ...f, keypoints: f.keypoints.filter(kp => !drop.has(kp.name)) };
}

/** Set the confidence score on named keypoints. */
function setScore(f: PoseFrame, score: number, ...names: string[]): PoseFrame {
  const target = new Set(names);
  return {
    ...f,
    keypoints: f.keypoints.map(kp => (target.has(kp.name) ? { ...kp, score } : kp)),
  };
}

describe("filterLandmarks (climbing-weighted)", () => {
  it("returns an empty array when given an empty array", () => {
    expect(filterLandmarks([])).toEqual([]);
  });

  it("keeps frames with all 33 high-confidence keypoints", () => {
    const frames = [goodFrame(0), goodFrame(1)];
    expect(filterLandmarks(frames)).toHaveLength(2);
  });

  it("keeps a frame with both feet occluded but strong hands/torso/hips", () => {
    // Both ankles + both foot-index points gone → 4 × 0.25 = 1.0 weighted bad,
    // well within the default tolerance of 3.
    const f = dropKeypoints(
      goodFrame(0),
      "left_ankle", "right_ankle", "left_foot_index", "right_foot_index",
    );
    expect(filterLandmarks([f])).toHaveLength(1);
  });

  it("keeps a frame even when feet are present but low-confidence", () => {
    const f = setScore(
      goodFrame(0), 0.05,
      "left_ankle", "right_ankle", "left_foot_index", "right_foot_index", "left_heel", "right_heel",
    );
    expect(filterLandmarks([f])).toHaveLength(1);
  });

  it("drops a genuinely degraded frame missing hands/shoulders/hips", () => {
    // All six full-weight core joints bad → weight 6 > tolerance 3.
    const f = dropKeypoints(
      goodFrame(0),
      "left_wrist", "right_wrist", "left_shoulder", "right_shoulder", "left_hip", "right_hip",
    );
    expect(filterLandmarks([f])).toHaveLength(0);
  });

  it("ignores non-climbing keypoints (face / fingers / knees)", () => {
    // Wreck the face, fingers, and knees — none are in the climbing subset.
    const f = setScore(
      goodFrame(0), 0.0,
      "nose", "left_eye", "right_eye", "left_ear", "right_ear",
      "left_pinky", "right_pinky", "left_index", "right_index",
      "left_knee", "right_knee",
    );
    expect(filterLandmarks([f])).toHaveLength(1);
  });

  it("counts absent core keypoints toward the bad-weight budget", () => {
    // Three core joints absent → weight 3.0 == default tolerance → kept;
    // a fourth absent core joint → weight 4.0 > tolerance → dropped.
    const kept = dropKeypoints(goodFrame(0), "left_wrist", "right_wrist", "left_hip");
    expect(filterLandmarks([kept])).toHaveLength(1);

    const dropped = dropKeypoints(goodFrame(0), "left_wrist", "right_wrist", "left_hip", "right_hip");
    expect(filterLandmarks([dropped])).toHaveLength(0);
  });

  it("respects a custom (tier-tunable) tolerance", () => {
    // Two core joints bad → weight 2.0.
    const f = dropKeypoints(goodFrame(0), "left_wrist", "right_wrist");
    // Accurate-style strict tolerance (1) drops it; looser tolerance keeps it.
    expect(filterLandmarks([f], 0.3, 1)).toHaveLength(0);
    expect(filterLandmarks([f], 0.3, 2)).toHaveLength(1);
  });

  it("respects a custom minScore threshold", () => {
    // Lower all climbing-subset scores to 0.5.
    const f = setScore(
      goodFrame(0), 0.5,
      "left_wrist", "right_wrist", "left_shoulder", "right_shoulder", "left_hip", "right_hip",
      "left_ankle", "right_ankle", "left_foot_index", "right_foot_index",
    );
    // minScore=0.6 makes every climbing keypoint bad → weight 7 > 3 → dropped.
    expect(filterLandmarks([f], 0.6)).toHaveLength(0);
    // minScore=0.4 keeps them all → weight 0 → kept.
    expect(filterLandmarks([f], 0.4)).toHaveLength(1);
  });

  it("drops a frame with no keypoints at all", () => {
    const empty = frame(0, []);
    expect(filterLandmarks([empty])).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// fillPersistentGaps — the no-gap guarantee
// ---------------------------------------------------------------------------

const ALL_MP_NAMES = Object.values(MP_KP_NAMES);

/** Count joints that go present → absent → present across a dense sequence
 *  (the visual "limb winks out" glitch). Leading/trailing absence is ignored. */
function countMidSequenceWinks(frames: PoseFrame[]): string[] {
  const winked: string[] = [];
  for (const name of ALL_MP_NAMES) {
    const present = frames.map(f => f.keypoints.some(k => k.name === name));
    const first = present.indexOf(true);
    const last = present.lastIndexOf(true);
    if (first < 0) continue;
    for (let i = first; i <= last; i++) {
      if (!present[i]) { winked.push(name); break; }
    }
  }
  return winked;
}

describe("fillPersistentGaps", () => {
  it("returns short sequences (< 3 frames) untouched", () => {
    const frames = [frame(0, [["nose", 0.5, 0.5]]), { timestamp: 1, keypoints: [] }];
    expect(fillPersistentGaps(frames)).toEqual(frames);
  });

  it("fills a joint bracketed by detections via temporal interpolation", () => {
    // left_wrist seen at frame 0 and 2, absent at 1 — with no neighbour present
    // at frame 1, it must be temporally interpolated to the midpoint.
    const frames: PoseFrame[] = [
      frame(0, [["left_wrist", 0.2, 0.4, 0.8]]),
      { timestamp: 1, keypoints: [] },
      frame(2, [["left_wrist", 0.4, 0.6, 0.8]]),
    ];
    const filled = fillPersistentGaps(frames, "mediapipe");
    const wrist = filled[1].keypoints.find(k => k.name === "left_wrist");
    expect(wrist).toBeDefined();
    expect(wrist!.x).toBeCloseTo(0.3);
    expect(wrist!.y).toBeCloseTo(0.5);
    // Dimmed below the renderer's Estimated-Landmark threshold (0.4).
    expect(wrist!.score).toBeCloseTo(0.8 * PERSISTENT_GAP_SCORE_FACTOR);
    expect(wrist!.score).toBeLessThan(0.4);
  });

  it("places a gap joint structurally off a present neighbour, keeping it attached", () => {
    // left_wrist drops at frame 1, but left_elbow (its neighbour) is present and
    // has moved. The wrist must follow the elbow via the bone vector from a
    // bracketing frame, not sit at the absolute temporal midpoint.
    const frames: PoseFrame[] = [
      frame(0, [["left_wrist", 0.20, 0.50, 0.9], ["left_elbow", 0.30, 0.30, 0.9]]),
      frame(1, [["left_elbow", 0.60, 0.30, 0.9]]), // elbow jumped right; wrist gone
      frame(2, [["left_wrist", 0.20, 0.50, 0.9], ["left_elbow", 0.30, 0.30, 0.9]]),
    ];
    const filled = fillPersistentGaps(frames, "mediapipe");
    const wrist = filled[1].keypoints.find(k => k.name === "left_wrist");
    expect(wrist).toBeDefined();
    // Bone vector wrist-elbow = (-0.1, 0.2) applied to the current elbow (0.6, 0.3).
    expect(wrist!.x).toBeCloseTo(0.5);
    expect(wrist!.y).toBeCloseTo(0.5);
  });

  it("leaves a joint absent before its first detection (not bracketed)", () => {
    const frames: PoseFrame[] = [
      { timestamp: 0, keypoints: [] },
      { timestamp: 1, keypoints: [] },
      frame(2, [["nose", 0.5, 0.1]]),
    ];
    const filled = fillPersistentGaps(frames, "mediapipe");
    expect(filled[0].keypoints.find(k => k.name === "nose")).toBeUndefined();
    expect(filled[1].keypoints.find(k => k.name === "nose")).toBeUndefined();
  });

  it("leaves a joint absent after its last detection (not bracketed)", () => {
    const frames: PoseFrame[] = [
      frame(0, [["nose", 0.5, 0.1]]),
      { timestamp: 1, keypoints: [] },
      { timestamp: 2, keypoints: [] },
    ];
    const filled = fillPersistentGaps(frames, "mediapipe");
    expect(filled[2].keypoints.find(k => k.name === "nose")).toBeUndefined();
  });

  it("never invents a joint the detector never saw", () => {
    const frames = [goodFrame(0), goodFrame(1), goodFrame(2)].map(f => ({
      ...f,
      keypoints: f.keypoints.filter(k => k.name !== "left_pinky"),
    }));
    const filled = fillPersistentGaps(frames, "mediapipe");
    filled.forEach(f =>
      expect(f.keypoints.find(k => k.name === "left_pinky")).toBeUndefined(),
    );
  });

  it("closes a multi-second whole-limb dropout end-to-end (no winks)", () => {
    // Regression for the overlay glitch: an arm + leg occluded for ~1.5 s mid
    // sequence used to wink out — too long for interpolatePoseFrames to bridge
    // and too degraded (9 joints) for estimateMissingLandmarks to touch.
    const dropped = new Set([
      "left_elbow", "left_wrist", "left_pinky", "left_index", "left_thumb",
      "right_knee", "right_ankle", "right_heel", "right_foot_index",
    ]);
    const anchors: PoseFrame[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k * 0.5;
      const base = goodFrame(t);
      anchors.push(
        t >= 1.5 && t <= 2.5
          ? { ...base, keypoints: base.keypoints.filter(kp => !dropped.has(kp.name)) }
          : base,
      );
    }
    const allTs: number[] = [];
    for (let t = 0; t <= 4.0001; t += 1 / 30) allTs.push(+t.toFixed(4));

    const interp = interpolatePoseFrames(filterLandmarks(anchors, 0.3), allTs);
    const est = estimateMissingLandmarks(interp, 10, 5, "mediapipe");

    // Before the fill pass the limbs wink out…
    expect(countMidSequenceWinks(est).length).toBeGreaterThan(0);

    // …and after it, no joint that is seen on both sides is ever absent between.
    const filled = fillPersistentGaps(est, "mediapipe");
    expect(countMidSequenceWinks(smoothPoseFrames(filled))).toEqual([]);
  });
});
