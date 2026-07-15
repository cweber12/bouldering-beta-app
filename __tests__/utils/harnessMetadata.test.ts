import { describe, it, expect } from "vitest";
import {
  amountOptions,
  normalizeAnalysisInputs,
  parseAnalysisInputsEdit,
  mergeAnalysisInputs,
} from "@/utils/harnessMetadata";

describe("normalizeAnalysisInputs", () => {
  it("defaults amounts to unknown and selects/notes to empty", () => {
    const v = normalizeAnalysisInputs(null);
    expect(v.shadows).toBe("unknown");
    expect(v.occlusion).toBe("unknown");
    expect(v.camera_angle).toBe("");
    expect(v.notes).toBe("");
  });

  it("keeps existing values, including off-scale amounts", () => {
    const v = normalizeAnalysisInputs({
      shadows: "high",
      motion_blur: "extreme", // off-scale — must be retained
      camera_angle: "low-angle",
      notes: "backlit",
      route_folder: "ignored",
    });
    expect(v.shadows).toBe("high");
    expect(v.motion_blur).toBe("extreme");
    expect(v.camera_angle).toBe("low-angle");
    expect(v.notes).toBe("backlit");
  });
});

describe("amountOptions", () => {
  it("returns the ordinal scale for scale values", () => {
    expect(amountOptions("low")).toEqual(["unknown", "none", "low", "medium", "high"]);
    expect(amountOptions("")).toEqual(["unknown", "none", "low", "medium", "high"]);
  });

  it("appends an off-scale value so it is never dropped", () => {
    expect(amountOptions("extreme")).toEqual([
      "unknown",
      "none",
      "low",
      "medium",
      "high",
      "extreme",
    ]);
  });
});

describe("parseAnalysisInputsEdit", () => {
  it("accepts a partial edit of editable fields", () => {
    const edit = parseAnalysisInputsEdit({ analysisInputs: { shadows: "low", notes: "hi" } });
    expect(edit).toEqual({ shadows: "low", notes: "hi" });
  });

  it("accepts off-scale amount strings (retained labels)", () => {
    expect(parseAnalysisInputsEdit({ analysisInputs: { motion_blur: "extreme" } })).toEqual({
      motion_blur: "extreme",
    });
  });

  it("rejects unknown fields, non-string values, and non-object bodies", () => {
    expect(parseAnalysisInputsEdit({ analysisInputs: { route_folder: "x" } })).toBeNull();
    expect(parseAnalysisInputsEdit({ analysisInputs: { shadows: 3 } })).toBeNull();
    expect(parseAnalysisInputsEdit({})).toBeNull();
    expect(parseAnalysisInputsEdit(null)).toBeNull();
  });

  it("rejects over-length values", () => {
    expect(parseAnalysisInputsEdit({ analysisInputs: { notes: "x".repeat(2001) } })).toBeNull();
    expect(parseAnalysisInputsEdit({ analysisInputs: { shadows: "x".repeat(201) } })).toBeNull();
  });
});

describe("mergeAnalysisInputs", () => {
  it("overwrites only edited fields and carries the rest forward", () => {
    const existing = {
      shadows: "low",
      occlusion: "none",
      camera_angle: "low-angle",
      motion_blur: "extreme", // off-scale label preserved
    };

    const merged = mergeAnalysisInputs(existing, { shadows: "high", notes: "backlit" });

    expect(merged.shadows).toBe("high"); // edited
    expect(merged.notes).toBe("backlit"); // added
    expect(merged.occlusion).toBe("none"); // preserved
    expect(merged.camera_angle).toBe("low-angle"); // preserved
    expect(merged.motion_blur).toBe("extreme"); // off-scale preserved

    // The original object is not mutated.
    expect(existing.shadows).toBe("low");
  });

  it("builds a block from an empty base", () => {
    expect(mergeAnalysisInputs(null, { shadows: "medium" })).toEqual({ shadows: "medium" });
    expect(mergeAnalysisInputs(undefined, {})).toEqual({});
  });

  it("drops non-string and structural values from the existing block", () => {
    const merged = mergeAnalysisInputs(
      { shadows: "low", route_folder: "route-x", stray: 3 as unknown as string },
      {},
    );
    expect(merged).toEqual({ shadows: "low" });
  });
});
