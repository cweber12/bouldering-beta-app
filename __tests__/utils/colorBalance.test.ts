import { describe, it, expect } from "vitest";
import {
  channelMeans,
  castRatio,
  neutralizeColorCast,
} from "@/utils/colorBalance";

/** Build an N-pixel RGBA buffer with a uniform colour. */
function solid(r: number, g: number, b: number, pixels = 64): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("channelMeans / castRatio", () => {
  it("reports per-channel means and a cast ratio above 1 for a green cast", () => {
    const m = channelMeans(solid(60, 140, 60));
    expect(m.r).toBeCloseTo(60, 5);
    expect(m.g).toBeCloseTo(140, 5);
    expect(m.b).toBeCloseTo(60, 5);
    expect(castRatio(m)).toBeCloseTo(140 / 60, 5);
  });

  it("reports a ratio of 1 for a neutral frame", () => {
    expect(castRatio(channelMeans(solid(100, 100, 100)))).toBe(1);
  });
});

describe("neutralizeColorCast", () => {
  it("rebalances a strong green cast toward neutral", () => {
    const data = solid(60, 140, 60);
    const applied = neutralizeColorCast(data);
    expect(applied).toBe(true);

    const after = channelMeans(data);
    // Channels should be near the original gray mean (≈86.7) and close together.
    expect(castRatio(after)).toBeLessThan(1.1);
    expect(after.g).toBeLessThan(140); // green pulled down
    expect(after.r).toBeGreaterThan(60); // red/blue pushed up
  });

  it("leaves a near-neutral frame untouched (no-op gate)", () => {
    const data = solid(100, 100, 100);
    const before = Uint8ClampedArray.from(data);
    expect(neutralizeColorCast(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it("does not touch a mildly tinted frame below the threshold", () => {
    // ratio 130/100 = 1.3 < default 1.35 → must be preserved (no regression on
    // legitimately coloured scenes such as a red rock wall).
    const data = solid(130, 100, 100);
    const before = Uint8ClampedArray.from(data);
    expect(neutralizeColorCast(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it("skips near-black frames (no reliable colour to balance)", () => {
    const data = solid(2, 5, 2);
    const before = Uint8ClampedArray.from(data);
    expect(neutralizeColorCast(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it("clamps per-channel gain so a near-dead channel does not blow out", () => {
    // Extreme green cast: blue almost dead. With maxGain=2 the blue gain is
    // capped, so it cannot be scaled by the raw gray/mean ratio.
    const data = solid(40, 200, 20);
    const applied = neutralizeColorCast(data, { maxGain: 2 });
    expect(applied).toBe(true);
    const after = channelMeans(data);
    // gray ≈ 86.7; blue raw gain would be ~4.3 but is clamped to 2 → ≈40.
    expect(after.b).toBeCloseTo(40, 0);
  });
});
