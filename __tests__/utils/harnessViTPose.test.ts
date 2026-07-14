import { describe, it, expect } from "vitest";
import {
  viTPoseToPoseFrames,
  parseViTPoseScaffold,
  VITPOSE_TO_MP_NAME,
  type ViTPoseScaffold,
} from "@/utils/harnessViTPose";

const scaffold: ViTPoseScaffold = {
  version: 1,
  frames: [
    {
      timestamp: 0.0,
      keypoints: [
        { name: "nose", x: 0.5, y: 0.1, score: 0.9 },
        { name: "left_wrist", x: 0.4, y: 0.6, score: 0.2 },
      ],
    },
    { timestamp: 0.5, keypoints: [] },
  ],
};

describe("viTPoseToPoseFrames", () => {
  it("maps ViTPose frames to PoseFrames, carrying position and confidence", () => {
    const frames = viTPoseToPoseFrames(scaffold);
    expect(frames).toHaveLength(2);
    expect(frames[0].timestamp).toBe(0.0);
    expect(frames[0].keypoints).toEqual([
      { name: "nose", x: 0.5, y: 0.1, score: 0.9 },
      { name: "left_wrist", x: 0.4, y: 0.6, score: 0.2 },
    ]);
    // An empty tracker frame maps to a pose with no keypoints (→ absent later).
    expect(frames[1].keypoints).toEqual([]);
  });

  it("applies the ViTPose→MediaPipe name alias when one is defined", () => {
    // The core joint names coincide today, so the alias map is a passthrough.
    expect(VITPOSE_TO_MP_NAME).toEqual({});
    const frames = viTPoseToPoseFrames({
      version: 1,
      frames: [{ timestamp: 0, keypoints: [{ name: "nose", x: 0.5, y: 0.1, score: 0.9 }] }],
    });
    expect(frames[0].keypoints[0].name).toBe("nose");
  });
});

describe("parseViTPoseScaffold", () => {
  it("accepts a well-formed scaffold", () => {
    expect(parseViTPoseScaffold(scaffold)).toEqual(scaffold);
  });

  it("rejects a non-object, a missing version, and a non-array frames", () => {
    expect(parseViTPoseScaffold(null)).toBeNull();
    expect(parseViTPoseScaffold({ frames: [] })).toBeNull();
    expect(parseViTPoseScaffold({ version: 1, frames: {} })).toBeNull();
  });

  it("rejects a malformed keypoint or frame", () => {
    expect(
      parseViTPoseScaffold({
        version: 1,
        frames: [{ timestamp: 0, keypoints: [{ name: "nose", x: 0.5, y: "nope", score: 0.9 }] }],
      }),
    ).toBeNull();
    expect(
      parseViTPoseScaffold({ version: 1, frames: [{ timestamp: -1, keypoints: [] }] }),
    ).toBeNull();
    expect(
      parseViTPoseScaffold({
        version: 1,
        frames: [{ timestamp: 0, keypoints: [{ name: "", x: 0.5, y: 0.1, score: 0.9 }] }],
      }),
    ).toBeNull();
  });
});
