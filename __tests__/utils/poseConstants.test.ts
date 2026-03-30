import { describe, it, expect } from "vitest";
import {
  MP_KP,
  MP_KP_NAMES,
  MP_SKELETON_EDGES,
  MEDIAPIPE_KEYPOINT_COUNT,
  getTopology,
  type MediaPipeKeypointIndex,
} from "@/utils/poseConstants";

// ---------------------------------------------------------------------------
// MediaPipe Pose Landmarker (33 BlazePose keypoints)
// ---------------------------------------------------------------------------

describe("poseConstants — MP_KP indices", () => {
  it("exports 33 unique keypoint indices", () => {
    const indices = Object.values(MP_KP);
    expect(indices).toHaveLength(MEDIAPIPE_KEYPOINT_COUNT);
    expect(new Set(indices).size).toBe(MEDIAPIPE_KEYPOINT_COUNT);
  });

  it("indices are contiguous 0–32", () => {
    const indices = Object.values(MP_KP).sort((a, b) => a - b);
    indices.forEach((idx, i) => expect(idx).toBe(i));
  });

  it("MP_KP.NOSE is 0 (BlazePose convention)", () => {
    expect(MP_KP.NOSE).toBe(0);
  });
});

describe("poseConstants — MP_KP_NAMES", () => {
  it("has a name for every MediaPipe keypoint index", () => {
    const indices = Object.values(MP_KP) as MediaPipeKeypointIndex[];
    for (const idx of indices) {
      expect(MP_KP_NAMES[idx]).toBeTypeOf("string");
      expect(MP_KP_NAMES[idx].length).toBeGreaterThan(0);
    }
  });

  it("name strings are snake_case", () => {
    for (const name of Object.values(MP_KP_NAMES)) {
      expect(name).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it("includes expected joint names", () => {
    expect(MP_KP_NAMES[MP_KP.NOSE]).toBe("nose");
    expect(MP_KP_NAMES[MP_KP.LEFT_SHOULDER]).toBe("left_shoulder");
    expect(MP_KP_NAMES[MP_KP.RIGHT_HIP]).toBe("right_hip");
    expect(MP_KP_NAMES[MP_KP.LEFT_KNEE]).toBe("left_knee");
    expect(MP_KP_NAMES[MP_KP.RIGHT_ANKLE]).toBe("right_ankle");
  });
});

describe("poseConstants — MP_SKELETON_EDGES", () => {
  it("every edge references valid MediaPipe keypoint indices", () => {
    const validIndices = new Set(Object.values(MP_KP));
    for (const [from, to] of MP_SKELETON_EDGES) {
      expect(validIndices.has(from as MediaPipeKeypointIndex)).toBe(true);
      expect(validIndices.has(to as MediaPipeKeypointIndex)).toBe(true);
    }
  });

  it("no edge connects a keypoint to itself", () => {
    for (const [from, to] of MP_SKELETON_EDGES) {
      expect(from).not.toBe(to);
    }
  });

  it("includes hand connections (wrist to fingers)", () => {
    const edgeSet = new Set(MP_SKELETON_EDGES.map(([f, t]) => `${f}-${t}`));
    expect(edgeSet.has(`${MP_KP.LEFT_WRIST}-${MP_KP.LEFT_PINKY}`)).toBe(true);
    expect(edgeSet.has(`${MP_KP.RIGHT_WRIST}-${MP_KP.RIGHT_INDEX}`)).toBe(true);
  });

  it("includes foot connections (ankle to heel/foot_index)", () => {
    const edgeSet = new Set(MP_SKELETON_EDGES.map(([f, t]) => `${f}-${t}`));
    expect(edgeSet.has(`${MP_KP.LEFT_ANKLE}-${MP_KP.LEFT_HEEL}`)).toBe(true);
    expect(edgeSet.has(`${MP_KP.RIGHT_ANKLE}-${MP_KP.RIGHT_FOOT_INDEX}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getTopology helper
// ---------------------------------------------------------------------------

describe("getTopology", () => {
  it("returns MediaPipe topology for 'mediapipe' backend", () => {
    const topo = getTopology("mediapipe");
    expect(topo.keypointCount).toBe(MEDIAPIPE_KEYPOINT_COUNT);
    expect(topo.keypointNames).toBe(MP_KP_NAMES);
    expect(topo.skeletonEdges).toBe(MP_SKELETON_EDGES);
  });

  it("returns MediaPipe topology for any backend value", () => {
    // getTopology always returns MediaPipe now
    const topo = getTopology("mediapipe");
    expect(topo.keypointCount).toBe(33);
  });
});
