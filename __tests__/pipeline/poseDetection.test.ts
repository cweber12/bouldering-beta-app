import { describe, it, expect, vi, afterEach } from "vitest";
import {
  estimateFrameUnified,
  estimateFrameWithRetry,
  scorePoseFrame,
  meanConfidence,
  type PoseFrame,
} from "@/pipeline/poseDetection";

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

/**
 * Create a canvas whose getContext("2d") returns a fake CanvasRenderingContext2D.
 * jsdom doesn't implement canvas 2d, so retry tests need this.
 */
function makeCanvasWithCtx(width = 640, height = 480): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const fakeCtx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  const origGetContext = canvas.getContext.bind(canvas);
  canvas.getContext = vi.fn().mockImplementation((id: string) => {
    if (id === "2d") return fakeCtx;
    return origGetContext(id);
  }) as typeof canvas.getContext;
  return canvas;
}

// Stub document.createElement so that retry canvases also get a fake 2d context.
const _origCreateElement = document.createElement.bind(document);

function stubCanvasCreation() {
  vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const el = _origCreateElement(tag, options);
    if (tag === "canvas") {
      const c = el as HTMLCanvasElement;
      const fakeCtx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
      const origGC = c.getContext.bind(c);
      c.getContext = vi.fn().mockImplementation((id: string) => {
        if (id === "2d") return fakeCtx;
        return origGC(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
    }
    return el;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

// ---------------------------------------------------------------------------
// Tests — scorePoseFrame & meanConfidence
// ---------------------------------------------------------------------------

describe("scorePoseFrame", () => {
  it("returns 0 for null frame", () => {
    expect(scorePoseFrame(null)).toBe(0);
  });

  it("returns 0 for empty keypoints", () => {
    expect(scorePoseFrame({ timestamp: 0, keypoints: [] })).toBe(0);
  });

  it("scores based on count × average confidence", () => {
    const frame: PoseFrame = {
      timestamp: 0,
      keypoints: [
        { name: "a", x: 0, y: 0, score: 0.8 },
        { name: "b", x: 0, y: 0, score: 0.6 },
      ],
    };
    // 2 × 0.7 = 1.4
    expect(scorePoseFrame(frame)).toBeCloseTo(1.4, 5);
  });
});

describe("meanConfidence", () => {
  it("returns 0 for null frame", () => {
    expect(meanConfidence(null)).toBe(0);
  });

  it("returns 0 for empty keypoints", () => {
    expect(meanConfidence({ timestamp: 0, keypoints: [] })).toBe(0);
  });

  it("computes mean of keypoint scores", () => {
    const frame: PoseFrame = {
      timestamp: 0,
      keypoints: [
        { name: "a", x: 0, y: 0, score: 0.4 },
        { name: "b", x: 0, y: 0, score: 0.8 },
      ],
    };
    expect(meanConfidence(frame)).toBeCloseTo(0.6, 5);
  });
});

// ---------------------------------------------------------------------------
// Tests — estimateFrameWithRetry
// ---------------------------------------------------------------------------

describe("estimateFrameWithRetry — confidence-aware retry", () => {
  it("returns the initial result when confidence is high", () => {
    const landmarker = mockLandmarker([
      [{ x: 0.5, y: 0.5, visibility: 0.9 }],
    ]);
    const result = estimateFrameWithRetry(landmarker, makeCanvas(), 1.0);
    expect(result).not.toBeNull();
    expect(result!.keypoints[0].score).toBe(0.9);
    // Only one call to detectForVideo (no retries).
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);
  });

  it("retries with tighter crop when initial confidence is low", () => {
    stubCanvasCreation();
    let callCount = 0;
    const landmarker = {
      detectForVideo: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: low confidence
          return { landmarks: [[{ x: 0.5, y: 0.5, visibility: 0.35 }]] };
        }
        // Retry: high confidence
        return { landmarks: [[{ x: 0.5, y: 0.5, visibility: 0.8 }]] };
      }),
    };
    const result = estimateFrameWithRetry(landmarker, makeCanvasWithCtx(), 1.0);
    expect(result).not.toBeNull();
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
  });

  it("returns null when no attempt passes the discard threshold", () => {
    const landmarker = mockLandmarker([
      [{ x: 0.5, y: 0.5, visibility: 0.1 }], // below discard threshold
    ]);
    const result = estimateFrameWithRetry(landmarker, makeCanvas(), 1.0);
    expect(result).toBeNull();
  });

  it("remaps keypoints from retry crop back to original canvas space", () => {
    stubCanvasCreation();
    let callCount = 0;
    const landmarker = {
      detectForVideo: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Low confidence on first call
          return { landmarks: [[{ x: 0.5, y: 0.5, visibility: 0.35 }]] };
        }
        // Retry: detect at (0.5, 0.5) in the cropped region
        return { landmarks: [[{ x: 0.5, y: 0.5, visibility: 0.8 }]] };
      }),
    };
    const canvas = makeCanvasWithCtx(100, 100);
    const result = estimateFrameWithRetry(landmarker, canvas, 1.0);
    expect(result).not.toBeNull();
    // Keypoints from the retry should be remapped — they won't be exactly (0.5, 0.5)
    // because the crop is offset by shrinkStep = 5%.
    // Expected: x = (0.5 * 90 + 5) / 100 = 0.5, y = same.
    // With 5% shrink from each edge: srcX=5, srcW=90, so x = (0.5*90 + 5)/100 = 0.5
    expect(result!.keypoints[0].x).toBeCloseTo(0.5, 1);
  });

  it("stops retrying when fewer keypoints are detected", () => {
    stubCanvasCreation();
    let callCount = 0;
    const landmarker = {
      detectForVideo: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // 2 keypoints, low confidence
          return {
            landmarks: [[
              { x: 0.5, y: 0.5, visibility: 0.4 },
              { x: 0.3, y: 0.3, visibility: 0.4 },
            ]],
          };
        }
        // Retry: fewer keypoints
        return { landmarks: [[{ x: 0.5, y: 0.5, visibility: 0.4 }]] };
      }),
    };
    const result = estimateFrameWithRetry(landmarker, makeCanvasWithCtx(), 1.0);
    expect(result).not.toBeNull();
    // Should stop after 2 calls (initial + 1 retry that had fewer kps).
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
  });

  it("limits retries to maxRetries", () => {
    stubCanvasCreation();
    const landmarker = mockLandmarker([
      [{ x: 0.5, y: 0.5, visibility: 0.4 }],
    ]);
    estimateFrameWithRetry(landmarker, makeCanvasWithCtx(), 1.0, 0.3, {
      maxRetries: 1,
      retryThreshold: 0.9,
    });
    // 1 initial + 1 retry = 2 calls.
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
  });

  it("accepts keepable result with mean confidence above discard threshold", () => {
    const landmarker = mockLandmarker([
      [{ x: 0.5, y: 0.5, visibility: 0.4 }],
    ]);
    const result = estimateFrameWithRetry(landmarker, makeCanvas(), 1.0, 0.3, {
      retryThreshold: 0.9,
      discardThreshold: 0.35,
      maxRetries: 0,
    });
    expect(result).not.toBeNull();
    expect(result!.keypoints[0].score).toBe(0.4);
  });
});
