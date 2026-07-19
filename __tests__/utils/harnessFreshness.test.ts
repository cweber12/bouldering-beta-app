import { describe, it, expect } from "vitest";
import {
  effectiveTruthHash,
  truthIsStale,
  scaffoldIsStale,
  scaffoldIsSeedReady,
  runPairsWithTruth,
} from "@/utils/harnessFreshness";
import type { ViTPoseScaffold } from "@/utils/harnessViTPose";

describe("effectiveTruthHash", () => {
  it("prefers the truth's own stamped hash", () => {
    expect(effectiveTruthHash("t1", "s1")).toBe("t1");
  });

  it("falls back to the current setup hash for legacy truth without one", () => {
    expect(effectiveTruthHash("", "s1")).toBe("s1");
    expect(effectiveTruthHash(null, "s1")).toBe("s1");
    expect(effectiveTruthHash(undefined, "s1")).toBe("s1");
  });

  it("is empty when neither hash exists", () => {
    expect(effectiveTruthHash(null, null)).toBe("");
  });
});

describe("truthIsStale", () => {
  it("is stale exactly when both hashes exist and differ", () => {
    expect(truthIsStale("old", "new")).toBe(true);
    expect(truthIsStale("same", "same")).toBe(false);
  });

  it("never marks legacy truth without a stamped hash stale (it falls back to the setup)", () => {
    expect(truthIsStale("", "s1")).toBe(false);
    expect(truthIsStale(undefined, "s1")).toBe(false);
  });

  it("never marks truth stale when the bundle has no setup hash to compare against", () => {
    expect(truthIsStale("t1", null)).toBe(false);
    expect(truthIsStale("t1", "")).toBe(false);
  });
});

describe("scaffoldIsStale", () => {
  it("flags a scaffold stamped under a different calibration", () => {
    expect(scaffoldIsStale("old", "new")).toBe(true);
    expect(scaffoldIsStale("same", "same")).toBe(false);
  });

  it("trusts a legacy scaffold without a stamped hash", () => {
    expect(scaffoldIsStale(undefined, "s1")).toBe(false);
    expect(scaffoldIsStale("", "s1")).toBe(false);
  });
});

describe("scaffoldIsSeedReady", () => {
  const posedFrame = {
    timestamp: 0.1,
    keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }],
  };
  const scaffold = (setupHash: string | undefined, posed: boolean): ViTPoseScaffold => ({
    version: 1,
    ...(setupHash ? { setupHash } : {}),
    frames: posed ? [{ timestamp: 0, keypoints: [] }, posedFrame] : [{ timestamp: 0, keypoints: [] }],
  });

  it("is ready when the scaffold stamps the current hash and poses a frame", () => {
    expect(scaffoldIsSeedReady(scaffold("h1", true), "h1")).toBe(true);
  });

  it("is not ready when the scaffold stamps an older calibration's hash", () => {
    expect(scaffoldIsSeedReady(scaffold("old", true), "new")).toBe(false);
  });

  it("is not ready when there is no scaffold at all", () => {
    expect(scaffoldIsSeedReady(null, "h1")).toBe(false);
    expect(scaffoldIsSeedReady(undefined, "h1")).toBe(false);
  });

  it("trusts a legacy unstamped scaffold, matching the staleness fallback", () => {
    expect(scaffoldIsSeedReady(scaffold(undefined, true), "h1")).toBe(true);
  });

  it("is never ready for a poseless scaffold — the tracker found no Climber", () => {
    expect(scaffoldIsSeedReady(scaffold("h1", false), "h1")).toBe(false);
    expect(scaffoldIsSeedReady({ version: 1, setupHash: "h1", frames: [] }, "h1")).toBe(false);
  });
});

describe("runPairsWithTruth", () => {
  it("pairs a run stamped with the truth's hash", () => {
    expect(runPairsWithTruth("h1", "h1", "h2")).toBe(true);
  });

  it("rejects a run stamped under a different calibration than the truth", () => {
    // The export-race shape: the run carries the current setup hash but the
    // truth still stamps the previous calibration's.
    expect(runPairsWithTruth("current", "previous", "current")).toBe(false);
  });

  it("pairs legacy truth without a hash against the current setup hash", () => {
    expect(runPairsWithTruth("s1", "", "s1")).toBe(true);
    expect(runPairsWithTruth("other", "", "s1")).toBe(false);
  });

  it("treats fully hashless legacy bundles as paired rather than alarming", () => {
    expect(runPairsWithTruth(null, null, null)).toBe(true);
  });
});
