import { describe, it, expect } from "vitest";
import {
  frameClampCrop,
  defaultRouteAroundClimber,
  tapOutsideSeedGate,
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

describe("tapOutsideSeedGate", () => {
  // Mirrors the downloader's seed crop gate: center inside the crop expanded
  // by 10% of its size per side, no un-crop fallback.
  const crop: CropFraction = { x: 0.4, y: 0.6, w: 0.2, h: 0.3 };

  it("accepts a tap inside the crop and inside the 10% expansion band", () => {
    expect(tapOutsideSeedGate({ x: 0.5, y: 0.7 }, crop)).toBe(false);
    // Just inside the expanded top edge (0.6 - 0.03).
    expect(tapOutsideSeedGate({ x: 0.5, y: 0.575 }, crop)).toBe(false);
  });

  it("flags a tap beyond the expanded crop — the doomed-seed case", () => {
    // The observed failure shape: tap on the climber mid-route, well above the
    // crop drawn around the start.
    expect(tapOutsideSeedGate({ x: 0.49, y: 0.46 }, crop)).toBe(true);
    expect(tapOutsideSeedGate({ x: 0.65, y: 0.7 }, crop)).toBe(true);
  });

  it("never flags when there is no tap", () => {
    expect(tapOutsideSeedGate(null, crop)).toBe(false);
  });
});
