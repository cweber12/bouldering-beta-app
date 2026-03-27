import { describe, it, expect } from "vitest";
import {
  extractHipCenter,
  mapKeypointsToFullFrame,
} from "@/pipeline/cropDetector";
import type { Keypoint } from "@/pipeline/poseDetection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kp(name: string, x: number, y: number, score = 0.9): Keypoint {
  return { name, x, y, score };
}

// ---------------------------------------------------------------------------
// extractHipCenter
// ---------------------------------------------------------------------------

describe("extractHipCenter", () => {
  it("averages both hips when present", () => {
    const keypoints = [kp("left_hip", 0.4, 0.6), kp("right_hip", 0.6, 0.8)];
    const center = extractHipCenter(keypoints);
    expect(center).toEqual({ x: 0.5, y: 0.7 });
  });

  it("returns left hip alone when right is missing", () => {
    const center = extractHipCenter([kp("left_hip", 0.3, 0.5)]);
    expect(center).toEqual({ x: 0.3, y: 0.5 });
  });

  it("returns right hip alone when left is missing", () => {
    const center = extractHipCenter([kp("right_hip", 0.7, 0.5)]);
    expect(center).toEqual({ x: 0.7, y: 0.5 });
  });

  it("returns null when no hip keypoints exist", () => {
    expect(extractHipCenter([kp("nose", 0.5, 0.1)])).toBeNull();
    expect(extractHipCenter([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapKeypointsToFullFrame
// ---------------------------------------------------------------------------

describe("mapKeypointsToFullFrame", () => {
  it("maps crop-relative coords back to full-frame normalized coords", () => {
    // A 400×400 crop starting at (200, 100) within a 1000×800 frame.
    const crop = { x: 200, y: 100, width: 400, height: 400 };
    // Keypoint at center of the crop: kp.x = 0.5, kp.y = 0.5
    // Expected full-frame: x = (0.5*400 + 200) / 1000 = 400/1000 = 0.4
    //                      y = (0.5*400 + 100) / 800  = 300/800  = 0.375
    const result = mapKeypointsToFullFrame(
      [kp("left_hip", 0.5, 0.5)],
      crop,
      1000,
      800,
    );
    expect(result[0].x).toBeCloseTo(0.4);
    expect(result[0].y).toBeCloseTo(0.375);
  });

  it("preserves the keypoint's name and score", () => {
    const crop = { x: 0, y: 0, width: 100, height: 100 };
    const result = mapKeypointsToFullFrame([kp("nose", 0.5, 0.5, 0.88)], crop, 100, 100);
    expect(result[0].name).toBe("nose");
    expect(result[0].score).toBe(0.88);
  });

  it("maps top-left crop corner (0, 0) to the crop's top-left in full frame", () => {
    const crop = { x: 50, y: 50, width: 200, height: 200 };
    const result = mapKeypointsToFullFrame([kp("nose", 0, 0)], crop, 400, 400);
    // x = (0*200 + 50) / 400 = 0.125
    expect(result[0].x).toBeCloseTo(0.125);
    expect(result[0].y).toBeCloseTo(0.125);
  });
});
