import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderMultiPoseVideo } from "@/pipeline/multiPoseVideoRenderer";
import type { MultiPoseLayer } from "@/pipeline/multiPoseVideoRenderer";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/pipeline/homography", () => ({
  computeHomography: vi.fn(),
}));

vi.mock("@/pipeline/skeletonOverlay", () => ({
  buildTransformedKeypoints: vi.fn().mockReturnValue(new Map()),
  drawSkeleton: vi.fn(),
}));

import { computeHomography } from "@/pipeline/homography";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal MultiPoseLayer with n matches. */
function fakeLayer(matchCount = 10, frameCount = 2): MultiPoseLayer {
  const frames = Array.from({ length: frameCount }, (_, i) => ({
    timestamp: i * 0.1,
    keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }],
  }));

  const keypoints = Array.from({ length: matchCount }, (_, i) => ({
    pt: { x: i, y: i },
    size: 3,
    angle: 0,
    response: 0.5,
    octave: 0,
  }));

  return {
    frames,
    videoMeta: { name: "v.mp4", duration: 1, fps: 10, width: 640, height: 480 },
    orbFeatures: { keypoints, descriptors: new Uint8Array(matchCount * 32) },
    queryOrb: { keypoints, descriptors: new Uint8Array(matchCount * 32) },
    matches: Array.from({ length: matchCount }, (_, i) => ({
      queryIdx: i,
      trainIdx: i,
      distance: 10,
    })),
  };
}

const mockCv = {};

function fakeFile(name = "wall.jpg"): File {
  return new File(["fake"], name, { type: "image/jpeg" });
}

const fakeH = new Float64Array(9).fill(0);
fakeH[0] = 1;
fakeH[4] = 1;
fakeH[8] = 1;

// ---------------------------------------------------------------------------
// MediaRecorder mock (only used in success tests)
// ---------------------------------------------------------------------------

class FakeMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(false);
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn().mockImplementation(() => {
    this.onstop?.();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderMultiPoseVideo — error paths", () => {
  it("throws immediately when MediaRecorder is unavailable", async () => {
    // jsdom does not provide MediaRecorder, so no stub needed.
    await expect(
      renderMultiPoseVideo({ cv: mockCv, imageFile: fakeFile(), layers: [fakeLayer()] }),
    ).rejects.toThrow("MediaRecorder is not supported");
  });

  it("throws immediately when layers array is empty", async () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    await expect(
      renderMultiPoseVideo({ cv: mockCv, imageFile: fakeFile(), layers: [] }),
    ).rejects.toThrow("at least one layer is required");
    vi.unstubAllGlobals();
  });

  it("throws when computeHomography returns null (insufficient matches)", async () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.mocked(computeHomography).mockReturnValue(null);
    await expect(
      renderMultiPoseVideo({ cv: mockCv, imageFile: fakeFile(), layers: [fakeLayer(3)] }),
    ).rejects.toThrow("homography");
    vi.unstubAllGlobals();
  });
});

describe("renderMultiPoseVideo — success", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(computeHomography).mockClear();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({
      width: 100,
      height: 80,
      close: vi.fn(),
    }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:fake-overlay"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(computeHomography).mockReturnValue(fakeH);

    // Override canvas methods so getContext doesn't return null.
    const mockCtx = { drawImage: vi.fn() };
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx);
    HTMLCanvasElement.prototype.captureStream = vi.fn().mockReturnValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves with a blob URL for a single layer", async () => {
    const promise = renderMultiPoseVideo({
      cv: mockCv,
      imageFile: fakeFile(),
      layers: [fakeLayer(10, 1)],
      targetFps: 30,
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("blob:fake-overlay");
  });

  it("resolves with a blob URL for multiple layers", async () => {
    const promise = renderMultiPoseVideo({
      cv: mockCv,
      imageFile: fakeFile(),
      layers: [fakeLayer(10, 1), fakeLayer(10, 1)],
      targetFps: 30,
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("blob:fake-overlay");
  });

  it("calls computeHomography once per layer", async () => {
    const promise = renderMultiPoseVideo({
      cv: mockCv,
      imageFile: fakeFile(),
      layers: [fakeLayer(10, 1), fakeLayer(10, 1)],
      targetFps: 30,
    });

    await vi.runAllTimersAsync();
    await promise;
    expect(computeHomography).toHaveBeenCalledTimes(2);
  });

  it("invokes onProgress at least once", async () => {
    const onProgress = vi.fn();
    const promise = renderMultiPoseVideo({
      cv: mockCv,
      imageFile: fakeFile(),
      layers: [fakeLayer(10, 1)],
      targetFps: 30,
      onProgress,
    });

    await vi.runAllTimersAsync();
    await promise;
    expect(onProgress).toHaveBeenCalled();
  });
});
