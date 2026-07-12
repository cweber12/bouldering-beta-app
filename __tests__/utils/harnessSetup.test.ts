import { describe, it, expect } from "vitest";
import {
  canonicalSetupInput,
  hashSetupInput,
  parseScanSetupInput,
  SETUP_VERSION,
  type ScanSetupInput,
} from "@/utils/harnessSetup";

const base: ScanSetupInput = {
  climberCrop: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
  wallCrop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
  climberPoint: { x: 0.5, y: 0.42 },
  panning: false,
  qualityTier: "balanced",
};

describe("canonicalSetupInput", () => {
  it("is stable regardless of source key order", () => {
    const reordered: ScanSetupInput = {
      qualityTier: "balanced",
      panning: false,
      climberPoint: { x: 0.5, y: 0.42 },
      wallCrop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
      climberCrop: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    };
    expect(canonicalSetupInput(reordered)).toBe(canonicalSetupInput(base));
  });

  it("rounds float noise below 1e-6 to the same string", () => {
    const noisy: ScanSetupInput = {
      ...base,
      climberCrop: { x: 0.1 + 1e-9, y: 0.2, w: 0.3, h: 0.4 },
    };
    expect(canonicalSetupInput(noisy)).toBe(canonicalSetupInput(base));
  });

  it("distinguishes a null tap from a placed tap", () => {
    const noTap: ScanSetupInput = { ...base, climberPoint: null };
    expect(canonicalSetupInput(noTap)).not.toBe(canonicalSetupInput(base));
  });
});

describe("hashSetupInput", () => {
  it("is deterministic for equal inputs and differs for changed ones", async () => {
    const a = await hashSetupInput(base);
    const b = await hashSetupInput({ ...base });
    const c = await hashSetupInput({ ...base, panning: true });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("parseScanSetupInput", () => {
  it("accepts a well-formed body and defaults a missing tap to null", () => {
    const { climberPoint: _omit, ...noTap } = base;
    void _omit;
    expect(parseScanSetupInput(noTap)).toEqual({ ...noTap, climberPoint: null });
    expect(parseScanSetupInput(base)).toEqual(base);
  });

  it("rejects malformed bodies", () => {
    expect(parseScanSetupInput(null)).toBeNull();
    expect(parseScanSetupInput({ ...base, climberCrop: { x: 0, y: 0, w: 0 } })).toBeNull();
    expect(parseScanSetupInput({ ...base, panning: "no" })).toBeNull();
    expect(parseScanSetupInput({ ...base, qualityTier: "" })).toBeNull();
    expect(parseScanSetupInput({ ...base, climberPoint: { x: "a", y: 1 } })).toBeNull();
    expect(parseScanSetupInput({ ...base, climberCrop: { x: 0, y: 0, w: NaN, h: 1 } })).toBeNull();
  });
});

describe("SETUP_VERSION", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(SETUP_VERSION)).toBe(true);
    expect(SETUP_VERSION).toBeGreaterThan(0);
  });
});
