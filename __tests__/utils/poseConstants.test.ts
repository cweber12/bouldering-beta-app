import { describe, it, expect } from "vitest";
import {
  KP,
  KP_NAMES,
  SKELETON_EDGES,
  MOVENET_KEYPOINT_COUNT,
  type KeypointIndex,
} from "@/utils/poseConstants";

describe("poseConstants — KP indices", () => {
  it("exports 17 unique keypoint indices", () => {
    const indices = Object.values(KP);
    expect(indices).toHaveLength(MOVENET_KEYPOINT_COUNT);
    // All values must be unique.
    expect(new Set(indices).size).toBe(MOVENET_KEYPOINT_COUNT);
  });

  it("indices are contiguous 0–16", () => {
    const indices = Object.values(KP).sort((a, b) => a - b);
    indices.forEach((idx, i) => expect(idx).toBe(i));
  });

  it("KP.NOSE is 0 (COCO convention)", () => {
    expect(KP.NOSE).toBe(0);
  });

  it("left/right limb pairs are symmetric", () => {
    expect(KP.LEFT_SHOULDER).not.toBe(KP.RIGHT_SHOULDER);
    expect(KP.LEFT_HIP).not.toBe(KP.RIGHT_HIP);
    expect(KP.LEFT_WRIST).not.toBe(KP.RIGHT_WRIST);
    expect(KP.LEFT_ANKLE).not.toBe(KP.RIGHT_ANKLE);
  });
});

describe("poseConstants — KP_NAMES", () => {
  it("has a name for every keypoint index", () => {
    const indices = Object.values(KP) as KeypointIndex[];
    for (const idx of indices) {
      expect(KP_NAMES[idx]).toBeTypeOf("string");
      expect(KP_NAMES[idx].length).toBeGreaterThan(0);
    }
  });

  it("name strings are snake_case", () => {
    for (const name of Object.values(KP_NAMES)) {
      expect(name).toMatch(/^[a-z][a-z_]*$/);
    }
  });
});

describe("poseConstants — SKELETON_EDGES", () => {
  it("every edge references valid keypoint indices", () => {
    const validIndices = new Set(Object.values(KP));
    for (const [from, to] of SKELETON_EDGES) {
      expect(validIndices.has(from as KeypointIndex)).toBe(true);
      expect(validIndices.has(to as KeypointIndex)).toBe(true);
    }
  });

  it("no edge connects a keypoint to itself", () => {
    for (const [from, to] of SKELETON_EDGES) {
      expect(from).not.toBe(to);
    }
  });

  it("covers all major body segments (torso, both arms, both legs)", () => {
    const edgeSet = new Set(SKELETON_EDGES.map(([f, t]) => `${f}-${t}`));

    // Spine/torso cross-bar
    expect(edgeSet.has(`${KP.LEFT_SHOULDER}-${KP.RIGHT_SHOULDER}`)).toBe(true);
    expect(edgeSet.has(`${KP.LEFT_HIP}-${KP.RIGHT_HIP}`)).toBe(true);

    // Arms
    expect(edgeSet.has(`${KP.LEFT_SHOULDER}-${KP.LEFT_ELBOW}`)).toBe(true);
    expect(edgeSet.has(`${KP.RIGHT_SHOULDER}-${KP.RIGHT_ELBOW}`)).toBe(true);
    expect(edgeSet.has(`${KP.LEFT_ELBOW}-${KP.LEFT_WRIST}`)).toBe(true);
    expect(edgeSet.has(`${KP.RIGHT_ELBOW}-${KP.RIGHT_WRIST}`)).toBe(true);

    // Legs
    expect(edgeSet.has(`${KP.LEFT_HIP}-${KP.LEFT_KNEE}`)).toBe(true);
    expect(edgeSet.has(`${KP.RIGHT_HIP}-${KP.RIGHT_KNEE}`)).toBe(true);
    expect(edgeSet.has(`${KP.LEFT_KNEE}-${KP.LEFT_ANKLE}`)).toBe(true);
    expect(edgeSet.has(`${KP.RIGHT_KNEE}-${KP.RIGHT_ANKLE}`)).toBe(true);
  });
});
