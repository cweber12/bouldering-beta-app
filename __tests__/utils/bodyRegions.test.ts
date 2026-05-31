import { describe, expect, it } from "vitest";
import {
  REGIONS,
  EMPTY_HIGHLIGHT,
  isHighlightActive,
  buildHighlightStyle,
  type HighlightSelection,
} from "@/utils/bodyRegions";
import { MP_SKELETON_EDGES, MP_KP_NAMES } from "@/utils/poseConstants";

const baseParams = {
  limbColor: "#00d273",
  jointColor: "rgba(255,255,255,0.9)",
  lineWidth: 2.5,
  pointRadius: 2,
  skeletonEdges: MP_SKELETON_EDGES,
  keypointNames: MP_KP_NAMES,
};

describe("REGIONS", () => {
  it("exposes the six climbing regions", () => {
    expect(REGIONS.map((r) => r.key)).toEqual(["head", "arms", "hands", "torso", "legs", "feet"]);
  });
});

describe("isHighlightActive", () => {
  it("is false for the empty selection", () => {
    expect(isHighlightActive(EMPTY_HIGHLIGHT)).toBe(false);
  });
  it("is true once a region is selected", () => {
    expect(isHighlightActive({ regions: ["arms"], side: "both" })).toBe(true);
  });
});

describe("buildHighlightStyle", () => {
  it("returns a flat style (no overrides) when nothing is selected", () => {
    const style = buildHighlightStyle({ ...baseParams, selection: EMPTY_HIGHLIGHT });
    expect(style.limbColor).toBe("#00d273");
    expect(style.jointColorOverrides).toBeUndefined();
    expect(style.edgeColorMap).toBeUndefined();
  });

  it("dims joints outside the selected region and leaves emphasized ones at default", () => {
    const sel: HighlightSelection = { regions: ["arms"], side: "both" };
    const style = buildHighlightStyle({ ...baseParams, selection: sel });
    // Elbows are part of "arms" → emphasized → no dim override.
    expect(style.jointColorOverrides?.["left_elbow"]).toBeUndefined();
    expect(style.jointColorOverrides?.["right_elbow"]).toBeUndefined();
    // Knees are not in "arms" → dimmed.
    expect(style.jointColorOverrides?.["left_knee"]).toBeDefined();
    expect(style.jointRadiusOverrides?.["left_knee"]).toBeLessThan(2);
  });

  it("emphasizes the arm edges and dims the leg edges", () => {
    const sel: HighlightSelection = { regions: ["arms"], side: "both" };
    const style = buildHighlightStyle({ ...baseParams, selection: sel });
    // 11-13 is left shoulder→elbow (an arm edge) → emphasized → no override.
    expect(style.edgeColorMap?.["11-13"]).toBeUndefined();
    // 23-25 is left hip→knee (a leg edge) → dimmed.
    expect(style.edgeColorMap?.["23-25"]).toBeDefined();
  });

  it("restricts emphasis to one side when split", () => {
    const sel: HighlightSelection = { regions: ["arms"], side: "left" };
    const style = buildHighlightStyle({ ...baseParams, selection: sel });
    // Left elbow emphasized, right elbow dimmed.
    expect(style.jointColorOverrides?.["left_elbow"]).toBeUndefined();
    expect(style.jointColorOverrides?.["right_elbow"]).toBeDefined();
    // Left arm edge emphasized, right arm edge dimmed.
    expect(style.edgeColorMap?.["11-13"]).toBeUndefined();
    expect(style.edgeColorMap?.["12-14"]).toBeDefined();
  });
});
