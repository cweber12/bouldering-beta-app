import { describe, it, expect } from "vitest";
import {
  effectiveTruthHash,
  truthIsStale,
  scaffoldIsStale,
  runPairsWithTruth,
} from "@/utils/harnessFreshness";

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
