import { describe, it, expect } from "vitest";
import { capToPixelBudget, MAX_DECODE_PIXELS } from "@/utils/imageHelpers";

describe("capToPixelBudget", () => {
  it("passes through an image already within the budget", () => {
    const out = capToPixelBudget(4000, 3000); // 12 MP < 24 MP
    expect(out).toEqual({ width: 4000, height: 3000, scale: 1 });
  });

  it("passes through an image exactly at the budget", () => {
    const out = capToPixelBudget(6000, 4000); // 24 MP
    expect(out.scale).toBe(1);
    expect(out.width).toBe(6000);
    expect(out.height).toBe(4000);
  });

  it("downscales an oversized image to the budget, preserving aspect ratio", () => {
    const out = capToPixelBudget(12000, 8000); // 96 MP → quarter linear scale
    expect(out.width * out.height).toBeLessThanOrEqual(MAX_DECODE_PIXELS + 6000);
    expect(out.scale).toBeCloseTo(0.5, 2);
    // Aspect ratio preserved.
    expect(out.width / out.height).toBeCloseTo(12000 / 8000, 3);
  });

  it("guards against a degenerate zero-area input", () => {
    expect(capToPixelBudget(0, 0)).toEqual({ width: 0, height: 0, scale: 1 });
  });

  it("honours a custom pixel budget", () => {
    const out = capToPixelBudget(2000, 2000, 1_000_000);
    expect(out.scale).toBeCloseTo(0.5, 2);
    expect(out.width).toBe(1000);
    expect(out.height).toBe(1000);
  });
});
