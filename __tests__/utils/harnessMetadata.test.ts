import { describe, it, expect } from "vitest";
import {
  scaleOptions,
  normalizeAnalysisInputs,
  parseAnalysisInputsEdit,
  mergeAnalysisInputs,
  computeProvenance,
  parseProvenanceEdit,
  mergeProvenance,
} from "@/utils/harnessMetadata";

describe("normalizeAnalysisInputs", () => {
  it("defaults scale fields to unknown and selects/notes to empty", () => {
    const v = normalizeAnalysisInputs(null);
    expect(v.shadows).toBe("unknown");
    expect(v.occlusion).toBe("unknown");
    expect(v.camera_angle).toBe("");
    expect(v.notes).toBe("");
  });

  it("keeps existing values, including off-scale amounts", () => {
    const v = normalizeAnalysisInputs({
      shadows: "high", // legacy intensity value — must be retained
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

describe("scaleOptions", () => {
  it("returns the ordinal scale for amount fields", () => {
    expect(scaleOptions("motion_blur", "low")).toEqual([
      "unknown",
      "none",
      "low",
      "medium",
      "high",
    ]);
  });

  it("returns the contract scale for occlusion, retaining legacy grades off-scale", () => {
    expect(scaleOptions("occlusion", "")).toEqual(["unknown", "none", "some", "heavy"]);
    expect(scaleOptions("occlusion", "medium")).toEqual([
      "unknown",
      "none",
      "some",
      "heavy",
      "medium",
    ]);
  });

  it("returns the structural vocabulary for shadows, climber included", () => {
    expect(scaleOptions("shadows", "solid")).toEqual([
      "unknown",
      "none",
      "solid",
      "patchy",
      "climber",
    ]);
  });

  it("appends an off-scale value so it is never dropped", () => {
    expect(scaleOptions("motion_blur", "extreme")).toEqual([
      "unknown",
      "none",
      "low",
      "medium",
      "high",
      "extreme",
    ]);
    // A legacy intensity-graded shadows label stays selectable, unmigrated.
    expect(scaleOptions("shadows", "medium")).toEqual([
      "unknown",
      "none",
      "solid",
      "patchy",
      "climber",
      "medium",
    ]);
  });
});

describe("parseAnalysisInputsEdit", () => {
  it("accepts a partial edit of editable fields", () => {
    const edit = parseAnalysisInputsEdit({ analysisInputs: { shadows: "patchy", notes: "hi" } });
    expect(edit).toEqual({ shadows: "patchy", notes: "hi" });
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

    const merged = mergeAnalysisInputs(existing, { shadows: "solid", notes: "backlit" });

    expect(merged.shadows).toBe("solid"); // edited
    expect(merged.notes).toBe("backlit"); // added
    expect(merged.occlusion).toBe("none"); // preserved
    expect(merged.camera_angle).toBe("low-angle"); // preserved
    expect(merged.motion_blur).toBe("extreme"); // off-scale preserved

    // The original object is not mutated.
    expect(existing.shadows).toBe("low");
  });

  it("builds a block from an empty base", () => {
    expect(mergeAnalysisInputs(null, { shadows: "patchy" })).toEqual({ shadows: "patchy" });
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

describe("computeProvenance", () => {
  const seeded = normalizeAnalysisInputs({ camera_angle: "level" });

  it("marks a kept suggestion auto-accepted and a changed one human-overridden", () => {
    const applied = { shadows: "patchy", wall_contrast: "low" };
    const saved = { ...seeded, shadows: "patchy", wall_contrast: "high" };
    expect(computeProvenance(saved, seeded, applied)).toEqual({
      shadows: "auto-accepted",
      wall_contrast: "human-overridden",
    });
  });

  it("marks an unsuggested field the user set as human-authored", () => {
    const saved = { ...seeded, occlusion: "some" };
    expect(computeProvenance(saved, seeded, {})).toEqual({ occlusion: "human-authored" });
  });

  it("emits no entry for untouched fields or notes", () => {
    // camera_angle carries a prior value but was not touched this save; notes
    // edits are free text and never tracked.
    const saved = { ...seeded, notes: "windy" };
    expect(computeProvenance(saved, seeded, {})).toEqual({});
  });
});

describe("parseProvenanceEdit", () => {
  it("parses an absent block as an empty edit", () => {
    expect(parseProvenanceEdit({ analysisInputs: { shadows: "none" } })).toEqual({});
  });

  it("accepts the three-word vocabulary on editable fields", () => {
    expect(
      parseProvenanceEdit({
        analysisInputsProvenance: {
          shadows: "auto-accepted",
          climber_contrast: "human-overridden",
          route_orientation: "human-authored",
        },
      }),
    ).toEqual({
      shadows: "auto-accepted",
      climber_contrast: "human-overridden",
      route_orientation: "human-authored",
    });
  });

  it("rejects unknown fields, notes, and off-vocabulary values", () => {
    expect(parseProvenanceEdit({ analysisInputsProvenance: { stray: "auto-accepted" } })).toBeNull();
    expect(parseProvenanceEdit({ analysisInputsProvenance: { notes: "human-authored" } })).toBeNull();
    expect(parseProvenanceEdit({ analysisInputsProvenance: { shadows: "guessed" } })).toBeNull();
    expect(parseProvenanceEdit({ analysisInputsProvenance: "nope" })).toBeNull();
  });
});

describe("mergeProvenance", () => {
  it("overwrites edited entries and carries prior ones forward", () => {
    const merged = mergeProvenance(
      { shadows: "auto-accepted", occlusion: "human-authored", stray: "junk" },
      { shadows: "human-overridden" },
    );
    expect(merged).toEqual({ shadows: "human-overridden", occlusion: "human-authored" });
  });

  it("drops malformed existing entries", () => {
    expect(mergeProvenance({ shadows: "guessed", occlusion: 3 }, {})).toEqual({});
  });
});
