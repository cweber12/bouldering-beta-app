import { describe, it, expect } from "vitest";
import { parseSuggestions, applySuggestions } from "@/utils/harnessVideoStats";
import { normalizeAnalysisInputs } from "@/utils/harnessMetadata";

describe("parseSuggestions", () => {
  it("keeps only known suggestion keys with non-empty string values", () => {
    const parsed = parseSuggestions({
      shadows: "patchy",
      climber_contrast: "high",
      camera_stability: "steady",
      route_orientation: "left", // never suggested — dropped
      motion_blur: "",
      wall_contrast: 3,
      extra: "junk",
    });
    expect(parsed).toEqual({
      shadows: "patchy",
      climber_contrast: "high",
      camera_stability: "steady",
    });
  });

  it("reads a missing/invalid block as no suggestions", () => {
    expect(parseSuggestions(undefined)).toEqual({});
    expect(parseSuggestions(null)).toEqual({});
    expect(parseSuggestions("nope")).toEqual({});
  });
});

describe("applySuggestions", () => {
  it("prefills only unlabelled fields and reports what was applied", () => {
    const seeded = normalizeAnalysisInputs({ shadows: "solid", camera_stability: "" });
    const { values, applied } = applySuggestions(seeded, {
      shadows: "patchy", // existing human label wins
      wall_contrast: "low", // unknown → prefilled
      camera_stability: "steady", // empty → prefilled
    });

    expect(values.shadows).toBe("solid");
    expect(values.wall_contrast).toBe("low");
    expect(values.camera_stability).toBe("steady");
    expect(applied).toEqual({ wall_contrast: "low", camera_stability: "steady" });
  });

  it("applies nothing when there are no suggestions", () => {
    const seeded = normalizeAnalysisInputs(null);
    const { values, applied } = applySuggestions(seeded, {});
    expect(values).toEqual(seeded);
    expect(applied).toEqual({});
  });
});
