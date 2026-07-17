import { describe, it, expect } from "vitest";
import {
  buildDetectionGrid,
  isOnDetectionGrid,
  summarizeGridAlignment,
  DETECTION_GRID_INTERVAL_MS,
} from "@/utils/harnessDetectionGrid";

describe("buildDetectionGrid", () => {
  it("starts at zero and steps by the grid interval", () => {
    const grid = buildDetectionGrid(0.5);
    expect(grid.map((f) => f.timestamp)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it("covers the whole duration at 10 frames per second", () => {
    const grid = buildDetectionGrid(30);
    expect(grid).toHaveLength(301);
    expect(grid[0].timestamp).toBe(0);
    expect(grid[grid.length - 1].timestamp).toBeCloseTo(30, 6);
  });

  it("emits only 100 ms multiples", () => {
    for (const { timestamp } of buildDetectionGrid(7.3)) {
      const ms = timestamp * 1000;
      expect(Math.abs(ms - Math.round(ms / DETECTION_GRID_INTERVAL_MS) * DETECTION_GRID_INTERVAL_MS))
        .toBeLessThan(1e-6);
    }
  });

  it("includes the final frame when the duration lands on a stride boundary", () => {
    const grid = buildDetectionGrid(3);
    expect(grid).toHaveLength(31);
    expect(grid[30].timestamp).toBeCloseTo(3, 6);
  });

  it("includes the final frame when the duration is a hair short of the boundary", () => {
    // Durations arrive from `video.duration` as floats; 3 s can read 2.9999999.
    const grid = buildDetectionGrid(2.9999999);
    expect(grid).toHaveLength(31);
    expect(grid[30].timestamp).toBeCloseTo(3, 6);
  });

  it("never invents a frame past the end of the video", () => {
    const grid = buildDetectionGrid(2.95);
    expect(grid).toHaveLength(30);
    expect(grid[29].timestamp).toBeCloseTo(2.9, 6);
  });

  it("is deterministic across calls", () => {
    expect(buildDetectionGrid(12.34)).toEqual(buildDetectionGrid(12.34));
  });

  it("returns a single frame for a zero-length video", () => {
    expect(buildDetectionGrid(0)).toEqual([{ timestamp: 0 }]);
  });

  it("returns an empty grid when the duration is unusable", () => {
    expect(buildDetectionGrid(NaN)).toEqual([]);
    expect(buildDetectionGrid(Infinity)).toEqual([]);
    expect(buildDetectionGrid(-1)).toEqual([]);
  });
});

describe("isOnDetectionGrid", () => {
  it("accepts the stride multiples the seek loop probes", () => {
    // The same arithmetic useVideoProcessor seeks with: (i * 100) / 1000.
    for (let i = 0; i <= 300; i += 1) {
      expect(isOnDetectionGrid((i * DETECTION_GRID_INTERVAL_MS) / 1000)).toBe(true);
    }
  });

  it("tolerates a millisecond of float noise on either side", () => {
    expect(isOnDetectionGrid(2.4999)).toBe(true);
    expect(isOnDetectionGrid(2.5001)).toBe(true);
  });

  it("rejects a probe time between two strides", () => {
    expect(isOnDetectionGrid(0.05)).toBe(false);
    // A frame-boundary snap (30 fps) lands well off the stride.
    expect(isOnDetectionGrid(0.0333)).toBe(false);
    expect(isOnDetectionGrid(2.4666)).toBe(false);
  });

  it("rejects an unusable timestamp", () => {
    expect(isOnDetectionGrid(NaN)).toBe(false);
    expect(isOnDetectionGrid(-0.1)).toBe(false);
  });
});

describe("summarizeGridAlignment", () => {
  it("reports a production run's probes as wholly on-grid", () => {
    // A sparse tier stride plus an Adaptive Refinement re-probe — both are
    // i x 100 ms by construction, so both land on the grid.
    const run = [0, 1, 1.1, 1.2, 2, 3].map((timestamp) => ({ timestamp }));
    expect(summarizeGridAlignment(run)).toEqual({
      total: 6,
      onGrid: 6,
      offGrid: 0,
      offGridTimestamps: [],
    });
  });

  it("counts and names the probes that drifted off the grid", () => {
    const run = [{ timestamp: 0 }, { timestamp: 0.0333 }, { timestamp: 0.2 }];
    expect(summarizeGridAlignment(run)).toEqual({
      total: 3,
      onGrid: 2,
      offGrid: 1,
      offGridTimestamps: [0.0333],
    });
  });

  it("reports an empty run as aligned", () => {
    expect(summarizeGridAlignment([])).toEqual({
      total: 0,
      onGrid: 0,
      offGrid: 0,
      offGridTimestamps: [],
    });
  });
});
