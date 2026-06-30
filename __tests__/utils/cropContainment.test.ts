import { describe, it, expect } from "vitest";
import {
  frameClampCrop,
  containRoute,
  defaultRouteAroundClimber,
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

describe("containRoute", () => {
  const climber: CropFraction = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };

  it("grows the route to cover a climber that spills past an edge", () => {
    const route: CropFraction = { x: 0.45, y: 0.0, w: 0.1, h: 0.7 };
    const out = containRoute(route, climber);
    expect(contains(out, climber)).toBe(true);
    // Left edge pulled out to the climber, right edge to the climber's right.
    expect(close(out.x, 0.4)).toBe(true);
    expect(close(out.x + out.w, 0.6)).toBe(true);
  });

  it("never shrinks a route that already contains the climber (grow-only)", () => {
    const route: CropFraction = { x: 0, y: 0, w: 1, h: 1 };
    expect(containRoute(route, climber)).toEqual(route);
  });

  it("pins a route edge dragged inside the climber back to the climber edge", () => {
    // Route right edge dragged left to 0.5, inside the climber's right (0.6).
    const route: CropFraction = { x: 0, y: 0, w: 0.5, h: 1 };
    const out = containRoute(route, climber);
    expect(close(out.x + out.w, 0.6)).toBe(true);
    expect(contains(out, climber)).toBe(true);
  });

  it("stays within the frame", () => {
    const out = containRoute({ x: 0, y: 0, w: 1, h: 1 }, climber);
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect(out.x + out.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(out.y + out.h).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("defaultRouteAroundClimber", () => {
  it("is near full-frame with the bottom at the climber's bottom", () => {
    const climber: CropFraction = { x: 0.4, y: 0.3, w: 0.2, h: 0.3 };
    const route = defaultRouteAroundClimber(climber);
    expect(close(route.x, 0)).toBe(true);
    expect(close(route.y, 0)).toBe(true);
    expect(close(route.w, 1)).toBe(true);
    // Bottom hugs the climber bottom (0.3 + 0.3 = 0.6).
    expect(close(route.y + route.h, 0.6)).toBe(true);
    expect(contains(route, climber)).toBe(true);
  });

  it("always contains the climber even when it reaches the frame bottom", () => {
    const climber: CropFraction = { x: 0.1, y: 0.7, w: 0.3, h: 0.3 };
    const route = defaultRouteAroundClimber(climber);
    expect(contains(route, climber)).toBe(true);
    expect(close(route.y + route.h, 1)).toBe(true);
  });
});
