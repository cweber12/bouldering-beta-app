import { describe, it, expect, vi } from "vitest";
import { estimateFrameUnified } from "@/pipeline/poseDetection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal HTMLCanvasElement with explicit dimensions. */
function makeCanvas(width = 640, height = 480): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Build a mock MediaPipe PoseLandmarker. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockLandmarker(landmarks: any[][]) {
  return {
    detectForVideo: vi.fn().mockReturnValue({ landmarks }),
  };
}

// ---------------------------------------------------------------------------
// Tests — estimateFrameUnified (MediaPipe only)
// ---------------------------------------------------------------------------

describe("estimateFrameUnified — MediaPipe pose estimation", () => {
  it("returns a PoseFrame with the correct timestamp", async () => {
    const landmarker = mockLandmarker([
      [{ x: 0.5, y: 0.5, visibility: 0.9 }],
    ]);
    const result = await estimateFrameUnified(landmarker, makeCanvas(), 2.0, "mediapipe");
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(2.0);
  });

  it("uses normalised coords directly from MediaPipe", async () => {
    const landmarker = mockLandmarker([
      [{ x: 0.25, y: 0.75, visibility: 0.9 }],
    ]);
    const result = await estimateFrameUnified(landmarker, makeCanvas(), 1.0, "mediapipe");
    expect(result).not.toBeNull();
    expect(result!.keypoints[0].x).toBe(0.25);
    expect(result!.keypoints[0].y).toBe(0.75);
  });

  it("returns null when no landmarks are detected", async () => {
    const landmarker = mockLandmarker([]);
    const result = await estimateFrameUnified(landmarker, makeCanvas(), 0, "mediapipe");
    expect(result).toBeNull();
  });

  it("works without an explicit backend argument", async () => {
    const landmarker = mockLandmarker([
      [{ x: 0.1, y: 0.2, visibility: 0.8 }],
    ]);
    const result = await estimateFrameUnified(landmarker, makeCanvas(), 3.0);
    expect(result).not.toBeNull();
    expect(result!.keypoints[0].x).toBe(0.1);
  });

  it("filters keypoints below the default minScore", async () => {
    const landmarker = mockLandmarker([
      [
        { x: 0.5, y: 0.5, visibility: 0.9 },  // kept
        { x: 0.1, y: 0.1, visibility: 0.1 },  // dropped — below 0.3
      ],
    ]);
    const result = await estimateFrameUnified(landmarker, makeCanvas(), 0);
    expect(result).not.toBeNull();
    expect(result!.keypoints).toHaveLength(1);
  });

  it("each keypoint has name, x, y, score fields", async () => {
    const landmarker = mockLandmarker([
      [{ x: 0.3, y: 0.7, visibility: 0.95 }],
    ]);
    const result = await estimateFrameUnified(landmarker, makeCanvas(), 0);
    const kp = result!.keypoints[0];
    expect(kp).toHaveProperty("x", 0.3);
    expect(kp).toHaveProperty("y", 0.7);
    expect(kp).toHaveProperty("score", 0.95);
    expect(kp).toHaveProperty("name");
  });
});
