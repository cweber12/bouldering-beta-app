import { describe, it, expect } from "vitest";
import {
  canonicalSetupInput,
  hashSetupInput,
  parseScanSetupInput,
  bodyHasSeedTap,
  parseSeedTapEdit,
  bodyHasClimbEnd,
  parseClimbEndEdit,
  climbStartOf,
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

  it("keeps the hash unchanged when climberPoint has no t", async () => {
    const withoutT = await hashSetupInput(base);
    const withUndefinedT = await hashSetupInput({
      ...base,
      climberPoint: { x: 0.5, y: 0.42, t: undefined },
    });
    expect(withoutT).toBe(withUndefinedT);
  });

  it("changes the hash when climberPoint.t is added", async () => {
    const withoutT = await hashSetupInput(base);
    const withT = await hashSetupInput({
      ...base,
      climberPoint: { x: 0.5, y: 0.42, t: 2.33 },
    });
    expect(withoutT).not.toBe(withT);
  });
});

describe("parseScanSetupInput", () => {
  it("accepts a well-formed body and defaults a missing tap to null", () => {
    const { climberPoint: _omit, ...noTap } = base;
    void _omit;
    expect(parseScanSetupInput(noTap)).toEqual({ ...noTap, climberPoint: null });
    expect(parseScanSetupInput(base)).toEqual(base);
    expect(
      parseScanSetupInput({
        ...base,
        climberPoint: { x: 0.5, y: 0.42, t: 2.33 },
      }),
    ).toEqual({
      ...base,
      climberPoint: { x: 0.5, y: 0.42, t: 2.33 },
    });
  });

  it("rejects malformed bodies", () => {
    expect(parseScanSetupInput(null)).toBeNull();
    expect(parseScanSetupInput({ ...base, climberCrop: { x: 0, y: 0, w: 0 } })).toBeNull();
    expect(parseScanSetupInput({ ...base, panning: "no" })).toBeNull();
    expect(parseScanSetupInput({ ...base, qualityTier: "" })).toBeNull();
    expect(parseScanSetupInput({ ...base, climberPoint: { x: "a", y: 1 } })).toBeNull();
    expect(parseScanSetupInput({ ...base, climberPoint: { x: 0.5, y: 0.42, t: Infinity } })).toBeNull();
    expect(parseScanSetupInput({ ...base, climberPoint: { x: 0.5, y: 0.42, t: -1 } })).toBeNull();
    expect(parseScanSetupInput({ ...base, climberCrop: { x: 0, y: 0, w: NaN, h: 1 } })).toBeNull();
  });
});

describe("bodyHasSeedTap", () => {
  it("detects a seedTap key (including an explicit null) and rejects non-objects", () => {
    expect(bodyHasSeedTap({ seedTap: { x: 0.5, y: 0.5 } })).toBe(true);
    expect(bodyHasSeedTap({ seedTap: null })).toBe(true);
    expect(bodyHasSeedTap({ analysisInputs: { shadows: "low" } })).toBe(false);
    expect(bodyHasSeedTap(null)).toBe(false);
    expect(bodyHasSeedTap("nope")).toBe(false);
  });
});

describe("parseSeedTapEdit", () => {
  it("returns null to clear, the point to set, and false when malformed", () => {
    expect(parseSeedTapEdit({ seedTap: null })).toBeNull();
    expect(parseSeedTapEdit({ seedTap: { x: 0.4, y: 0.6 } })).toEqual({ x: 0.4, y: 0.6 });
    expect(parseSeedTapEdit({ seedTap: { x: 0.4, y: 0.6, t: 1.5 } })).toEqual({
      x: 0.4,
      y: 0.6,
      t: 1.5,
    });
    expect(parseSeedTapEdit({ seedTap: { x: "no", y: 0.6 } })).toBe(false);
    expect(parseSeedTapEdit({ seedTap: { x: 0.4, y: 0.6, t: -1 } })).toBe(false);
    expect(parseSeedTapEdit({ seedTap: 42 })).toBe(false);
  });
});

describe("seedTap is excluded from the setup hash", () => {
  it("does not appear in the canonical pre-image (ScanSetupInput has no seedTap)", () => {
    // seedTap lives on ScanSetup, not ScanSetupInput — the canonical string is
    // built only from the scan inputs, so it can never mention a seed tap.
    expect(canonicalSetupInput(base)).not.toContain("seedTap");
  });
});

// ---------------------------------------------------------------------------
// Climb window (harness ADR 0007)
// ---------------------------------------------------------------------------

describe("bodyHasClimbEnd", () => {
  it("detects a climbEnd key (including an explicit null) and rejects non-objects", () => {
    expect(bodyHasClimbEnd({ climbEnd: 58 })).toBe(true);
    expect(bodyHasClimbEnd({ climbEnd: null })).toBe(true);
    expect(bodyHasClimbEnd({ seedTap: null })).toBe(false);
    expect(bodyHasClimbEnd(null)).toBe(false);
    expect(bodyHasClimbEnd("nope")).toBe(false);
  });
});

describe("parseClimbEndEdit", () => {
  it("returns null to clear and the seconds value to set", () => {
    expect(parseClimbEndEdit({ climbEnd: null })).toBeNull();
    expect(parseClimbEndEdit({ climbEnd: 58 })).toBe(58);
    expect(parseClimbEndEdit({ climbEnd: 0 })).toBe(0);
  });

  it("rejects anything that is not a finite, non-negative number", () => {
    expect(parseClimbEndEdit({ climbEnd: -1 })).toBe(false);
    expect(parseClimbEndEdit({ climbEnd: Number.NaN })).toBe(false);
    expect(parseClimbEndEdit({ climbEnd: Infinity })).toBe(false);
    expect(parseClimbEndEdit({ climbEnd: "58" })).toBe(false);
    expect(parseClimbEndEdit({ climbEnd: { t: 58 } })).toBe(false);
  });

  it("enforces the harness's window rule: the end must be after the start", () => {
    // Mirrors `climb_end > climb_start` so a window we accept is never one the
    // harness 422s on after a job has been submitted.
    expect(parseClimbEndEdit({ climbEnd: 58 }, 3.5)).toBe(58);
    expect(parseClimbEndEdit({ climbEnd: 3.5 }, 3.5)).toBe(false);
    expect(parseClimbEndEdit({ climbEnd: 2 }, 3.5)).toBe(false);
  });

  it("accepts any non-negative end when the climb start is unknown", () => {
    // A Bundle whose setup tap carries no `t` has no start to order against.
    expect(parseClimbEndEdit({ climbEnd: 0.5 }, undefined)).toBe(0.5);
  });

  it("still clears on null even when the start would reject that value", () => {
    expect(parseClimbEndEdit({ climbEnd: null }, 3.5)).toBeNull();
  });
});

describe("climbStartOf", () => {
  it("reads the setup tap's time, and nothing when it has none", () => {
    expect(climbStartOf({ climberPoint: { x: 0.5, y: 0.5, t: 3.5 } })).toBe(3.5);
    expect(climbStartOf({ climberPoint: { x: 0.5, y: 0.5 } })).toBeUndefined();
    expect(climbStartOf({ climberPoint: null })).toBeUndefined();
  });
});

describe("climbEnd is excluded from the setup hash", () => {
  it("never reaches the canonical pre-image", () => {
    // climbEnd lives on ScanSetup, not ScanSetupInput. This is what keeps a
    // marker from invalidating the 90 already-calibrated Bundles (ADR 0020).
    expect(canonicalSetupInput(base)).not.toContain("climbEnd");
  });

  it("leaves the hash byte-identical whether or not a marker exists", async () => {
    const withMarker = { ...base, climbEnd: 58 } as ScanSetupInput;
    expect(await hashSetupInput(withMarker)).toBe(await hashSetupInput(base));
  });
});

describe("SETUP_VERSION", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(SETUP_VERSION)).toBe(true);
    expect(SETUP_VERSION).toBeGreaterThan(0);
  });
});
