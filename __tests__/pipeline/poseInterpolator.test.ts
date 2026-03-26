import { describe, it, expect } from "vitest";
import { interpolatePoseFrames } from "@/pipeline/poseInterpolator";
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
