import { describe, it, expect, vi } from "vitest";
import { estimateFrameMediaPipe } from "@/pipeline/mediapipePoseDetection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock PoseLandmarker whose detectForVideo() returns the supplied landmarks. */
function mockLandmarker(landmarks: Array<{ x: number; y: number; z?: number; visibility?: number }>[]) {
  return { detectForVideo: vi.fn().mockReturnValue({ landmarks }) };
}

/** Create a minimal canvas element. */
function makeCanvas(width = 640, height = 480): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("estimateFrameMediaPipe — basic behaviour", () => {
  it("returns null when the landmarker returns no landmarks", () => {
    const lm = mockLandmarker([]);
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 0);
    expect(result).toBeNull();
  });

  it("returns null when landmarks array is empty", () => {
    const lm = { detectForVideo: vi.fn().mockReturnValue({ landmarks: [] }) };
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 0);
    expect(result).toBeNull();
  });

  it("returns null for undefined result", () => {
    const lm = { detectForVideo: vi.fn().mockReturnValue(undefined) };
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 0);
    expect(result).toBeNull();
  });

  it("returns a PoseFrame with the correct timestamp", () => {
    const lm = mockLandmarker([[{ x: 0.5, y: 0.5, visibility: 0.9 }]]);
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 2.5);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(2.5);
  });

  it("passes timestamp in milliseconds to detectForVideo", () => {
    const lm = mockLandmarker([[{ x: 0.5, y: 0.5, visibility: 0.9 }]]);
    const canvas = makeCanvas();
    estimateFrameMediaPipe(lm, canvas, 1.5);
    expect(lm.detectForVideo).toHaveBeenCalledWith(canvas, 1500);
  });
});

describe("estimateFrameMediaPipe — landmark conversion", () => {
  it("uses normalised coordinates directly (no pixel-to-norm conversion)", () => {
    const lm = mockLandmarker([[{ x: 0.25, y: 0.75, visibility: 0.9 }]]);
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 0);
    expect(result!.keypoints[0].x).toBe(0.25);
    expect(result!.keypoints[0].y).toBe(0.75);
  });

  it("maps landmark index 0 to 'nose'", () => {
    const lm = mockLandmarker([[{ x: 0.5, y: 0.5, visibility: 0.9 }]]);
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 0);
    expect(result!.keypoints[0].name).toBe("nose");
  });

  it("maps visibility to score", () => {
    const lm = mockLandmarker([[{ x: 0.5, y: 0.5, visibility: 0.75 }]]);
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 0);
    expect(result!.keypoints[0].score).toBe(0.75);
  });

  it("handles missing visibility by defaulting to 0", () => {
    const lm = mockLandmarker([[{ x: 0.5, y: 0.5 }]]);
    // visibility undefined → score 0 → filtered out with default minScore(0.3)
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 0);
    expect(result!.keypoints).toHaveLength(0);
  });
});

describe("estimateFrameMediaPipe — confidence filtering", () => {
  it("drops landmarks below the default minScore (0.3)", () => {
    const lm = mockLandmarker([[
      { x: 0.5, y: 0.5, visibility: 0.9 },   // kept
      { x: 0.4, y: 0.4, visibility: 0.1 },   // dropped — index 1 = left_eye_inner
    ]]);
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 0);
    expect(result!.keypoints).toHaveLength(1);
    expect(result!.keypoints[0].name).toBe("nose");
  });

  it("keeps landmarks exactly at the minScore threshold", () => {
    const lm = mockLandmarker([[{ x: 0.5, y: 0.5, visibility: 0.3 }]]);
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 0);
    expect(result!.keypoints).toHaveLength(1);
  });

  it("accepts a custom minScore", () => {
    const lm = mockLandmarker([[{ x: 0.5, y: 0.5, visibility: 0.5 }]]);
    expect(estimateFrameMediaPipe(lm, makeCanvas(), 0, 0.6)!.keypoints).toHaveLength(0);
    expect(estimateFrameMediaPipe(lm, makeCanvas(), 0, 0.4)!.keypoints).toHaveLength(1);
  });
});

describe("estimateFrameMediaPipe — multiple landmarks", () => {
  it("correctly maps indices 11 and 12 to left_shoulder and right_shoulder", () => {
    // Build a full 13-landmark array with only indices 11 and 12 having high visibility.
    const landmarks = Array.from({ length: 13 }, (_, i) => ({
      x: i * 0.01,
      y: i * 0.01,
      visibility: i >= 11 ? 0.9 : 0.0,
    }));
    const lm = mockLandmarker([landmarks]);
    const result = estimateFrameMediaPipe(lm, makeCanvas(), 0);
    expect(result!.keypoints).toHaveLength(2);
    expect(result!.keypoints.map(k => k.name)).toEqual(["left_shoulder", "right_shoulder"]);
  });
});
