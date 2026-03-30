import { describe, it, expect, vi } from "vitest";
import { applyHomographyMatrix } from "@/pipeline/homography";
import { buildTransformedKeypoints, drawSkeleton } from "@/pipeline/skeletonOverlay";
import type { PoseFrame } from "@/pipeline/poseDetection";

// ---------------------------------------------------------------------------
// applyHomographyMatrix
// ---------------------------------------------------------------------------

describe("applyHomographyMatrix", () => {
  it("returns the input point unchanged for an identity matrix", () => {
    // prettier-ignore
    const I = new Float64Array([1, 0, 0,   0, 1, 0,   0, 0, 1]);
    const result = applyHomographyMatrix(I, 100, 200);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it("applies a pure translation", () => {
    // Translate by (+50, +30)
    // prettier-ignore
    const T = new Float64Array([1, 0, 50,   0, 1, 30,   0, 0, 1]);
    const result = applyHomographyMatrix(T, 10, 20);
    expect(result.x).toBeCloseTo(60);
    expect(result.y).toBeCloseTo(50);
  });

  it("applies a uniform scale", () => {
    // Scale by 2×
    // prettier-ignore
    const S = new Float64Array([2, 0, 0,   0, 2, 0,   0, 0, 1]);
    const result = applyHomographyMatrix(S, 5, 10);
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(20);
  });

  it("performs perspective division when w ≠ 1", () => {
    // w-scale of 2 halves both coordinates.
    // prettier-ignore
    const P = new Float64Array([1, 0, 0,   0, 1, 0,   0, 0, 2]);
    const result = applyHomographyMatrix(P, 10, 20);
    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(10);
  });

  it("composes translation then scale correctly", () => {
    // Scale 2× then translate (+10, +5) — H = S·T is not tested here;
    // we test a specific combined matrix directly.
    // prettier-ignore
    const H = new Float64Array([2, 0, 10,   0, 2, 5,   0, 0, 1]);
    const result = applyHomographyMatrix(H, 3, 4);
    // x' = 2*3 + 10 = 16,  y' = 2*4 + 5 = 13,  w = 1
    expect(result.x).toBeCloseTo(16);
    expect(result.y).toBeCloseTo(13);
  });
});

// ---------------------------------------------------------------------------
// buildTransformedKeypoints
// ---------------------------------------------------------------------------

describe("buildTransformedKeypoints", () => {
  // prettier-ignore
  const IDENTITY = new Float64Array([1, 0, 0,   0, 1, 0,   0, 0, 1]);

  it("maps normalized coordinates to pixel coordinates under identity H", () => {
    const frame: PoseFrame = {
      timestamp: 0,
      keypoints: [
        { name: "nose", x: 0.5, y: 0.25, score: 0.9 },
        { name: "left_shoulder", x: 0.3, y: 0.4, score: 0.8 },
      ],
    };

    const result = buildTransformedKeypoints(frame, IDENTITY, 640, 480);

    // nose: x = 0.5*640 = 320, y = 0.25*480 = 120
    expect(result["nose"].x).toBeCloseTo(320);
    expect(result["nose"].y).toBeCloseTo(120);

    // left_shoulder: x = 0.3*640 = 192, y = 0.4*480 = 192
    expect(result["left_shoulder"].x).toBeCloseTo(192);
    expect(result["left_shoulder"].y).toBeCloseTo(192);
  });

  it("returns an empty object for a frame with no keypoints", () => {
    const frame: PoseFrame = { timestamp: 0, keypoints: [] };
    const result = buildTransformedKeypoints(frame, IDENTITY, 640, 480);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("applies a translation homography to mapped pixel coordinates", () => {
    // Translate by (+100, +50)
    // prettier-ignore
    const T = new Float64Array([1, 0, 100,  0, 1, 50,  0, 0, 1]);
    const frame: PoseFrame = {
      timestamp: 0,
      keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.95 }],
    };

    const result = buildTransformedKeypoints(frame, T, 640, 480);
    // pixel before H: (320, 240) → after translation: (420, 290)
    expect(result["nose"].x).toBeCloseTo(420);
    expect(result["nose"].y).toBeCloseTo(290);
  });

  it("uses keypoint names as map keys", () => {
    const frame: PoseFrame = {
      timestamp: 0,
      keypoints: [
        { name: "left_wrist", x: 0.1, y: 0.2, score: 0.7 },
        { name: "right_wrist", x: 0.9, y: 0.8, score: 0.7 },
      ],
    };

    const result = buildTransformedKeypoints(frame, IDENTITY, 100, 100);
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(["left_wrist", "right_wrist"]),
    );
    expect(Object.keys(result)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// drawSkeleton
// ---------------------------------------------------------------------------

function makeFakeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    lineCap: "",
  } as unknown as CanvasRenderingContext2D;
}

describe("drawSkeleton", () => {
  it("draws limbs for connected keypoint pairs", () => {
    const ctx = makeFakeCtx();
    // Use keypoints that share a direct edge in MediaPipe topology:
    // left_eye_inner → nose → right_eye_inner
    const keypoints = {
      nose: { x: 50, y: 50 },
      left_eye_inner: { x: 40, y: 40 },
      right_eye_inner: { x: 60, y: 40 },
    };

    drawSkeleton(ctx, keypoints);

    // stroke() should be called at least once for the nose↔eye_inner edges.
    expect(ctx.stroke).toHaveBeenCalled();
    // fill() is called once per keypoint for the joint circles.
    expect(ctx.fill).toHaveBeenCalledTimes(3);
  });

  it("skips edges where a keypoint is missing", () => {
    const ctx = makeFakeCtx();
    // Provide only two keypoints — most edges will have missing endpoints.
    const keypoints = {
      nose: { x: 100, y: 100 },
      left_eye: { x: 90, y: 90 },
    };

    // Should not throw even with many missing edge endpoints.
    expect(() => drawSkeleton(ctx, keypoints)).not.toThrow();
    // Only 2 joint circles drawn.
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });

  it("calls save and restore to isolate canvas state", () => {
    const ctx = makeFakeCtx();
    drawSkeleton(ctx, {});
    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it("draws nothing for an empty keypoints map", () => {
    const ctx = makeFakeCtx();
    drawSkeleton(ctx, {});
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
  });
});
