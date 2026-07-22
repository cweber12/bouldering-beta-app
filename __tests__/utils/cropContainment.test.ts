import { describe, it, expect } from "vitest";
import {
  frameClampCrop,
  defaultRouteAroundClimber,
  deriveSeedRegion,
  SEED_REGION_HALF,
} from "@/utils/cropContainment";
import type { CropFraction } from "@/utils/cropFraction";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const contains = (route: CropFraction, climber: CropFraction) =>
  route.x <= climber.x + 1e-9 &&
  route.y <= climber.y + 1e-9 &&
  route.x + route.w >= climber.x + climber.w - 1e-9 &&
  route.y + route.h >= climber.y + climber.h - 1e-9;

describe("frameClampCrop", () => {
  it("clamps a rect that overflows the frame", () => {
    expect(frameClampCrop({ x: -0.1, y: 0.5, w: 0.4, h: 0.8 })).toEqual({
      x: 0,
      y: 0.5,
      w: 0.4,
      h: 0.5,
    });
  });

  it("leaves an in-bounds rect unchanged", () => {
    const c = { x: 0.2, y: 0.3, w: 0.4, h: 0.4 };
    expect(frameClampCrop(c)).toEqual(c);
  });
});

describe("defaultRouteAroundClimber", () => {
  it("insets from the frame edges with the bottom at the climber's bottom", () => {
    const climber: CropFraction = { x: 0.4, y: 0.3, w: 0.2, h: 0.3 };
    const route = defaultRouteAroundClimber(climber);
    // Top/left/right inset by the 5% edge pad so the box is grabbable.
    expect(close(route.x, 0.05)).toBe(true);
    expect(close(route.y, 0.05)).toBe(true);
    expect(close(route.x + route.w, 0.95)).toBe(true);
    // Bottom hugs the climber bottom (0.3 + 0.3 = 0.6).
    expect(close(route.y + route.h, 0.6)).toBe(true);
    expect(contains(route, climber)).toBe(true);
  });

  it("widens past the pad to frame a climber that spills toward an edge", () => {
    const climber: CropFraction = { x: 0.02, y: 0.3, w: 0.2, h: 0.3 };
    const route = defaultRouteAroundClimber(climber);
    // Left edge pulled out to the climber (0.02), not the 0.05 pad.
    expect(close(route.x, 0.02)).toBe(true);
    expect(contains(route, climber)).toBe(true);
  });

  it("still contains the climber when it reaches the frame bottom", () => {
    const climber: CropFraction = { x: 0.1, y: 0.7, w: 0.3, h: 0.3 };
    const route = defaultRouteAroundClimber(climber);
    expect(contains(route, climber)).toBe(true);
    expect(close(route.y + route.h, 1)).toBe(true);
  });
});

describe("deriveSeedRegion", () => {
  it("centers a box of ±SEED_REGION_HALF on the tap", () => {
    const region = deriveSeedRegion({ x: 0.5, y: 0.5 });
    expect(close(region.x, 0.5 - SEED_REGION_HALF)).toBe(true);
    expect(close(region.y, 0.5 - SEED_REGION_HALF)).toBe(true);
    expect(close(region.w, SEED_REGION_HALF * 2)).toBe(true);
    expect(close(region.h, SEED_REGION_HALF * 2)).toBe(true);
    // The tap is always the box center — the seed is independent of any crop.
    expect(close(region.x + region.w / 2, 0.5)).toBe(true);
    expect(close(region.y + region.h / 2, 0.5)).toBe(true);
  });

  it("clamps the box to the frame near an edge", () => {
    const region = deriveSeedRegion({ x: 0.02, y: 0.98 });
    expect(region.x).toBe(0);
    expect(region.y + region.h).toBe(1);
    expect(region.x).toBeGreaterThanOrEqual(0);
    expect(region.y).toBeGreaterThanOrEqual(0);
    expect(region.x + region.w).toBeLessThanOrEqual(1);
    expect(region.y + region.h).toBeLessThanOrEqual(1);
  });

  it("yields the full frame when there is no tap", () => {
    expect(deriveSeedRegion(null)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
