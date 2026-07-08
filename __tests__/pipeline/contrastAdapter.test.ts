import { describe, it, expect } from "vitest";
import {
  computeLumaStats,
  computeContrastAdjust,
  adaptColor,
  paletteContrastIsPoor,
  TARGET_CONTRAST_RATIO,
  type ContrastAdjust,
} from "@/pipeline/overlay/contrastAdapter";

// ---------------------------------------------------------------------------
// Test helpers — mirror the module's Rec. 709 luminance and HSL parse so we can
// assert on the *behaviour* of a returned colour (its luminance, hue, saturation)
// without reaching into the module internals.
// ---------------------------------------------------------------------------

function parseRgb(css: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(css);
  if (!m) throw new Error(`unparseable colour: ${css}`);
  return [+m[1], +m[2], +m[3]];
}

function luma(css: string): number {
  const [r, g, b] = parseRgb(css);
  return 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
}

function hsl(css: string): [number, number, number] {
  let [r, g, b] = parseRgb(css);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** Build a flat ImageData of a single RGB colour (jsdom lacks ImageData). */
function solidImage(r: number, g: number, b: number, n = 4): ImageData {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { data, width: n, height: 1, colorSpace: "srgb" } as ImageData;
}

// ---------------------------------------------------------------------------
// computeLumaStats — the pure half of the backdrop sampler.
// ---------------------------------------------------------------------------

describe("computeLumaStats", () => {
  it("uses Rec. 709 weighting (green reads brighter than blue at equal channel value)", () => {
    const green = computeLumaStats(solidImage(0, 255, 0));
    const blue = computeLumaStats(solidImage(0, 0, 255));
    expect(green.meanLuma).toBeGreaterThan(blue.meanLuma);
    expect(green.meanLuma).toBeCloseTo(0.7152, 3);
    expect(blue.meanLuma).toBeCloseTo(0.0722, 3);
  });

  it("computes mean and stdDev on a black/white checkerboard", () => {
    // Two black + two white pixels → mean 0.5, stdDev 0.5.
    const data = new Uint8ClampedArray(16);
    for (let i = 0; i < 2; i++) { data[i * 4 + 3] = 255; } // black, opaque
    for (let i = 2; i < 4; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
    }
    const stats = computeLumaStats({ data, width: 4, height: 1, colorSpace: "srgb" } as ImageData);
    expect(stats.meanLuma).toBeCloseTo(0.5, 6);
    expect(stats.stdLuma).toBeCloseTo(0.5, 6);
  });

  it("returns zeroes for an empty image", () => {
    const stats = computeLumaStats({ data: new Uint8ClampedArray(0), width: 0, height: 0, colorSpace: "srgb" } as ImageData);
    expect(stats).toEqual({ meanLuma: 0, stdLuma: 0 });
  });
});

// ---------------------------------------------------------------------------
// adaptColor — the primary seam.
// ---------------------------------------------------------------------------

const midGray = "rgb(128, 128, 128)";

describe("adaptColor", () => {
  it("passes a colour through unchanged when adjust is undefined", () => {
    expect(adaptColor("#39B1D1", undefined)).toBe("#39B1D1");
  });

  it("passes a colour through unchanged when it already clears the target", () => {
    // White on a dark, flat wall already has huge contrast.
    const adjust = computeContrastAdjust({ meanLuma: 0.1, stdLuma: 0 });
    expect(adaptColor("#ffffff", adjust)).toBe("#ffffff");
  });

  it("shifts a failing colour to exactly the target ratio (minimal nudge)", () => {
    // Mid-grey on a flat mid-grey wall must move to hit exactly 3:1.
    const adjust = computeContrastAdjust({ meanLuma: 0.5, stdLuma: 0 });
    const out = adaptColor(midGray, adjust);
    expect(out).not.toBe(midGray);
    // Within 8-bit quantization of exactly the target ratio (no over-shoot).
    expect(contrastRatio(luma(out), 0.5)).toBeCloseTo(TARGET_CONTRAST_RATIO, 1);
  });

  it("keeps hue invariant across adaptation", () => {
    const adjust = computeContrastAdjust({ meanLuma: 0.5, stdLuma: 0.2 });
    const cyan = "#39B1D1";
    const out = adaptColor(cyan, adjust);
    expect(out).not.toBe(cyan);
    expect(hsl(out)[0]).toBeCloseTo(hsl(cyan)[0], 2);
  });

  it("never decreases saturation below the authored value", () => {
    const adjust = computeContrastAdjust({ meanLuma: 0.95, stdLuma: 0.02 });
    const cyan = "#39B1D1";
    const out = adaptColor(cyan, adjust);
    // Rescue only raises saturation; allow a hair of 8-bit rounding slack.
    expect(hsl(out)[1]).toBeGreaterThanOrEqual(hsl(cyan)[1] - 0.01);
  });

  it("shifts more on a high-variance wall than a low-variance one (same mean)", () => {
    const low = adaptColor(midGray, computeContrastAdjust({ meanLuma: 0.5, stdLuma: 0 }));
    const high = adaptColor(midGray, computeContrastAdjust({ meanLuma: 0.5, stdLuma: 0.2 }));
    const base = luma(midGray);
    expect(Math.abs(luma(high) - base)).toBeGreaterThan(Math.abs(luma(low) - base));
  });

  it("moves a colour lighter on a dark wall and darker on a bright wall", () => {
    const base = luma(midGray);
    const dark = adaptColor(midGray, computeContrastAdjust({ meanLuma: 0.28, stdLuma: 0.1 }));
    const bright = adaptColor(midGray, computeContrastAdjust({ meanLuma: 0.72, stdLuma: 0.1 }));
    expect(luma(dark)).toBeGreaterThan(base);
    expect(luma(bright)).toBeLessThan(base);
  });

  it("never bottoms out at pure black or white (clamped result range)", () => {
    // A bright wall would push a bright colour to near-black under a hard target;
    // the clamp keeps it a deep, still-coloured version.
    const adjust = computeContrastAdjust({ meanLuma: 0.6, stdLuma: 0.12 });
    const out = adaptColor("#d6fb61", adjust);
    expect(luma(out)).toBeGreaterThan(0.02);
    expect(hsl(out)[1]).toBeGreaterThan(0.2); // hue survives (still saturated)
  });
});

describe("paletteContrastIsPoor", () => {
  it("flags a wall whose luma sits in the middle of the palette", () => {
    // A mid-luma, busy wall blends with the lime/cyan/orange palette.
    expect(paletteContrastIsPoor(computeContrastAdjust({ meanLuma: 0.55, stdLuma: 0.15 }))).toBe(true);
  });

  it("does not flag a very dark, flat wall the bright palette clears easily", () => {
    expect(paletteContrastIsPoor(computeContrastAdjust({ meanLuma: 0.03, stdLuma: 0.01 }))).toBe(false);
  });
});

describe("computeContrastAdjust", () => {
  it("defaults the target ratio and band multiplier from the module constants", () => {
    const adjust: ContrastAdjust = computeContrastAdjust({ meanLuma: 0.4, stdLuma: 0.1 });
    expect(adjust.target).toBe(TARGET_CONTRAST_RATIO);
    expect(adjust.k).toBe(1.0);
  });

  it("accepts overrides for tuning", () => {
    const adjust = computeContrastAdjust({ meanLuma: 0.4, stdLuma: 0.1 }, { target: 4.5, k: 1.5 });
    expect(adjust.target).toBe(4.5);
    expect(adjust.k).toBe(1.5);
  });
});
