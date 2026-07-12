import { describe, it, expect } from "vitest";
import {
  toReplayData,
  subsamplePoses,
  hasStarfield,
  runTimestamp,
  sortRunFilesNewestFirst,
  DEFAULT_MAX_POSES,
} from "@/pipeline/overlay/replayData.mjs";

// Build a minimal attempt-shaped object for projection tests.
function makeAttempt(frameCount: number, orbCount = 3) {
  return {
    videoMeta: { width: 200, height: 400 },
    orbFeatures: {
      keypoints: Array.from({ length: orbCount }, (_, i) => ({ pt: { x: i * 10, y: i * 20 } })),
    },
    frames: Array.from({ length: frameCount }, (_, i) => ({
      timestamp: i * 0.1,
      keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }],
    })),
  };
}

describe("subsamplePoses", () => {
  it("returns a copy when already within the cap", () => {
    const items = [1, 2, 3];
    const out = subsamplePoses(items, 5);
    expect(out).toEqual([1, 2, 3]);
    expect(out).not.toBe(items);
  });

  it("strides down to exactly maxPoses, keeping first and last", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const out = subsamplePoses(items, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(99);
  });

  it("handles degenerate caps", () => {
    expect(subsamplePoses([1, 2, 3], 1)).toEqual([1]);
    expect(subsamplePoses([1, 2, 3], 0)).toEqual([]);
  });
});

describe("toReplayData", () => {
  it("normalises orb keypoints by the video dimensions", () => {
    const rd = toReplayData(makeAttempt(2, 2));
    expect(rd.aspect).toEqual({ w: 200, h: 400 });
    expect(rd.starfield).toEqual([
      { x: 0, y: 0 },
      { x: 10 / 200, y: 20 / 400 },
    ]);
  });

  it("drops frames with no keypoints and caps pose count", () => {
    const attempt = makeAttempt(200);
    attempt.frames.push({ timestamp: 99, keypoints: [] });
    const rd = toReplayData(attempt);
    expect(rd.poses).toHaveLength(DEFAULT_MAX_POSES);
    expect(rd.poses.every((p) => p.keypoints.length > 0)).toBe(true);
  });

  it("respects an explicit maxPoses", () => {
    const rd = toReplayData(makeAttempt(50), { maxPoses: 8 });
    expect(rd.poses).toHaveLength(8);
  });

  it("rounds coordinates to 4 decimal places", () => {
    const attempt = makeAttempt(1, 1);
    attempt.videoMeta.width = 3;
    attempt.orbFeatures.keypoints = [{ pt: { x: 1, y: 1 } }];
    const rd = toReplayData(attempt);
    expect(rd.starfield[0].x).toBe(0.3333); // 1/3 rounded to 4dp
  });
});

describe("hasStarfield", () => {
  it("is true only for a non-empty orb keypoint set", () => {
    expect(hasStarfield(makeAttempt(1, 3))).toBe(true);
    expect(hasStarfield({ orbFeatures: null })).toBe(false);
    expect(hasStarfield({ orbFeatures: { keypoints: [] } })).toBe(false);
    expect(hasStarfield({})).toBe(false);
  });
});

describe("run file selection", () => {
  it("parses embedded timestamps, defaulting to 0", () => {
    expect(runTimestamp("run-1700000000000-send.json")).toBe(1700000000000);
    expect(runTimestamp("attempt-123.json")).toBe(123);
    expect(runTimestamp("route-image.json")).toBe(0);
  });

  it("sorts run files newest-first and filters non-runs and data siblings", () => {
    const files = [
      "run-100-attempt.json",
      "run-300-send.json",
      "run-300-send.data.json", // heavy sibling — excluded
      "route-image.json", // not a run — excluded
      "run-200-attempt.json",
    ];
    expect(sortRunFilesNewestFirst(files)).toEqual([
      "run-300-send.json",
      "run-200-attempt.json",
      "run-100-attempt.json",
    ]);
  });
});
