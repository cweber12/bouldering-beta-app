import { describe, expect, it } from "vitest";
import { findActiveCrop } from "@/components/skeleton/FramePlayer";
import type { CropTrace, CropTraceEntry } from "@/utils/cropTrace";

/** Minimal entry builder — only `timestamp` matters for selection. */
function entry(timestamp: number, extra: Partial<CropTraceEntry> = {}): CropTraceEntry {
  return {
    timestamp,
    frameIndex: Math.round(timestamp * 10),
    detected: true,
    reacquired: false,
    refinement: false,
    searchRegion: null,
    landmarkBox: null,
    ...extra,
  };
}

describe("findActiveCrop", () => {
  const trace: CropTrace = [entry(0.5), entry(1.0), entry(1.5), entry(2.0)];

  it("returns null for an empty trace", () => {
    expect(findActiveCrop([], 1.0)).toBeNull();
  });

  it("holds (steps) to the last entry at or before t", () => {
    expect(findActiveCrop(trace, 1.2)?.timestamp).toBe(1.0);
    expect(findActiveCrop(trace, 1.5)?.timestamp).toBe(1.5); // exact boundary is inclusive
    expect(findActiveCrop(trace, 1.99)?.timestamp).toBe(1.5);
  });

  it("does not interpolate — the box never advances early", () => {
    expect(findActiveCrop(trace, 0.9)?.timestamp).toBe(0.5);
  });

  it("falls back to the first entry when t precedes every row", () => {
    expect(findActiveCrop(trace, 0.0)?.timestamp).toBe(0.5);
    expect(findActiveCrop(trace, -5)?.timestamp).toBe(0.5);
  });

  it("clamps to the last entry past the end", () => {
    expect(findActiveCrop(trace, 99)?.timestamp).toBe(2.0);
  });
});
