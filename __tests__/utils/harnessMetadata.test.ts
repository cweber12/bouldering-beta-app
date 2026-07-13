import { describe, it, expect } from "vitest";
import {
  amountOptions,
  normalizeAnalysisInputs,
  parseAnalysisInputsEdit,
  mergeMetadataAnalysisInputs,
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

describe("mergeMetadataAnalysisInputs", () => {
  it("overwrites only edited fields and preserves everything else", () => {
    const existing = {
      route_folder: "route-x",
      imported_from: "downloader",
      source_title: "clip",
      analysis_inputs: {
        shadows: "low",
        occlusion: "none",
        camera_angle: "low-angle",
        extra_field: "keep-me",
      },
    };

    const merged = mergeMetadataAnalysisInputs(existing, { shadows: "high", notes: "backlit" });

    // Top-level downloader-owned keys untouched.
    expect(merged.route_folder).toBe("route-x");
    expect(merged.imported_from).toBe("downloader");
    expect(merged.source_title).toBe("clip");

    const inputs = merged.analysis_inputs as Record<string, unknown>;
    expect(inputs.shadows).toBe("high"); // edited
    expect(inputs.notes).toBe("backlit"); // added
    expect(inputs.occlusion).toBe("none"); // preserved
    expect(inputs.camera_angle).toBe("low-angle"); // preserved
    expect(inputs.extra_field).toBe("keep-me"); // unknown key preserved

    // The original object is not mutated.
    expect((existing.analysis_inputs as Record<string, unknown>).shadows).toBe("low");
  });

  it("creates analysis_inputs when the metadata has none", () => {
    const merged = mergeMetadataAnalysisInputs({ route_folder: "r" }, { shadows: "medium" });
    expect(merged.route_folder).toBe("r");
    expect(merged.analysis_inputs).toEqual({ shadows: "medium" });
  });
});
