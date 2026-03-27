import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImageMatcher } from "@/hooks/useImageMatcher";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/pipeline/orbDetector", () => ({
  extractFeatures: vi.fn(),
  extractFeaturesFromCrop: vi.fn(),
  matchOrbFeatures: vi.fn(),
}));

vi.mock("@/pipeline/homography", () => ({
  computeHomography: vi.fn(),
  applyHomographyMatrix: vi.fn(),
}));

vi.mock("@/utils/cvHelpers", () => ({
  cropImageData: vi.fn().mockImplementation((src: ImageData) => src),
}));

vi.mock("@/storage/sessionStore", () => ({
  getAttempt: vi.fn(),
}));

import { extractFeatures, extractFeaturesFromCrop, matchOrbFeatures } from "@/pipeline/orbDetector";
import { computeHomography, applyHomographyMatrix } from "@/pipeline/homography";
import { getAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A cv object reference — passed through to mocked functions, not inspected. */
const mockCv = {};

/** A minimal fake File that satisfies the File interface for createObjectURL. */
function fakeImageFile(name = "wall.jpg"): File {
  return new File(["fake-bytes"], name, { type: "image/jpeg" });
}

/** Build a minimal OrbResult-shaped object. */
function orbResult(nKp: number) {
  return {
    keypoints: Array.from({ length: nKp }, (_, i) => ({
      pt: { x: i, y: i },
      size: 3,
      angle: 0,
      response: 0.5,
      octave: 0,
    })),
    descriptors: new Uint8Array(nKp * 32).fill(0xff),
  };
}

/** Minimal RouteAttempt with orbFeatures set. */
function fakeAttempt(nKp = 10) {
  return {
    id: "attempt-1",
    videoMeta: { name: "v.mp4", duration: 1, fps: 10, width: 640, height: 480 },
    frames: [],
    orbFeatures: orbResult(nKp),
    matchesPerFrame: null,
  };
}

// ---------------------------------------------------------------------------
// DOM stubs
// ---------------------------------------------------------------------------

// loadImageAsImageData uses Image + canvas. jsdom provides Image but not
// a real rendering pipeline, so we stub the relevant parts.
function stubLoadImageSuccess(width = 100, height = 80) {
  // Stub URL lifecycle
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue("blob:fake"),
    revokeObjectURL: vi.fn(),
  });

  // Make Image fire onload synchronously when src is set.
  const MockImage = class {
    naturalWidth = width;
    naturalHeight = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_: string) {
      queueMicrotask(() => this.onload?.());
    }
  };
  vi.stubGlobal("Image", MockImage);

  // Stub canvas getContext / getImageData.
  const fakeImageData = {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: "srgb",
  } as ImageData;

  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue(fakeImageData),
  });

  return fakeImageData;
}

function stubLoadImageError() {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue("blob:fake"),
    revokeObjectURL: vi.fn(),
  });
  const MockImage = class {
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_: string) {
      queueMicrotask(() => this.onerror?.());
    }
  };
  vi.stubGlobal("Image", MockImage);
}

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = () => null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useImageMatcher — initial state", () => {
  it("starts idle with null result", () => {
    const { result } = renderHook(() => useImageMatcher());
    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
    expect(result.current.errorMessage).toBeNull();
  });
});

describe("useImageMatcher — happy path", () => {
  it("transitions idle → matching → done and returns correct counts", async () => {
    const attempt = fakeAttempt(10);
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);

    const queryResult = orbResult(7);
    (extractFeatures as ReturnType<typeof vi.fn>).mockReturnValue(queryResult);

    const fakeMatches = [{ queryIdx: 0, trainIdx: 1, distance: 25 }];
    (matchOrbFeatures as ReturnType<typeof vi.fn>).mockReturnValue(fakeMatches);

    stubLoadImageSuccess();

    const { result } = renderHook(() => useImageMatcher());

    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(result.current.status).toBe("done");
    expect(result.current.result).toMatchObject({
      matches: fakeMatches,
      queryKeypoints: 7,
      referenceKeypoints: 10,
    });
  });

  it("calls extractFeatures with the ImageData from the loaded image", async () => {
    const attempt = fakeAttempt(5);
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    (extractFeatures as ReturnType<typeof vi.fn>).mockReturnValue(orbResult(5));
    (matchOrbFeatures as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const fakeImageData = stubLoadImageSuccess();

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(extractFeatures).toHaveBeenCalledWith(mockCv, fakeImageData);
  });

  it("calls matchOrbFeatures with the stored orbFeatures as ref", async () => {
    const attempt = fakeAttempt(8);
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    const queryResult = orbResult(4);
    (extractFeatures as ReturnType<typeof vi.fn>).mockReturnValue(queryResult);
    (matchOrbFeatures as ReturnType<typeof vi.fn>).mockReturnValue([]);

    stubLoadImageSuccess();

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(matchOrbFeatures).toHaveBeenCalledWith(mockCv, attempt.orbFeatures, queryResult);
  });
});

describe("useImageMatcher — error cases", () => {
  it("errors when attempt has no orbFeatures", async () => {
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue({
      ...fakeAttempt(),
      orbFeatures: null,
    });

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/No ORB reference features/);
  });

  it("errors when attempt does not exist", async () => {
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "missing-id", mockCv);
    });

    expect(result.current.status).toBe("error");
  });

  it("errors when the image fails to load", async () => {
    const attempt = fakeAttempt();
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    stubLoadImageError();

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/Failed to load image/);
  });

  it("errors when extractFeatures throws", async () => {
    const attempt = fakeAttempt();
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    (extractFeatures as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("OpenCV allocation failed");
    });
    stubLoadImageSuccess();

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("OpenCV allocation failed");
  });
});

describe("useImageMatcher — repeated calls", () => {
  it("resets result and error on a new matchImage call", async () => {
    const attempt = fakeAttempt(5);
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    (extractFeatures as ReturnType<typeof vi.fn>).mockReturnValue(orbResult(3));
    (matchOrbFeatures as ReturnType<typeof vi.fn>).mockReturnValue([]);
    stubLoadImageSuccess();

    const { result } = renderHook(() => useImageMatcher());

    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });
    expect(result.current.status).toBe("done");

    // Second call — make it error.
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(result.current.status).toBe("error");
    // Previous result cleared on new call.
    expect(result.current.result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useImageMatcher — reanchorApplied flag
// ---------------------------------------------------------------------------

describe("useImageMatcher — reanchorApplied", () => {
  it("is false when initial matches are sufficient (≥ 10)", async () => {
    const tenMatches = Array.from({ length: 10 }, (_, i) => ({ queryIdx: i, trainIdx: i, distance: 10 }));
    const attempt = fakeAttempt(15);
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    (extractFeatures as ReturnType<typeof vi.fn>).mockReturnValue(orbResult(15));
    (matchOrbFeatures as ReturnType<typeof vi.fn>).mockReturnValue(tenMatches);
    stubLoadImageSuccess();

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(result.current.result?.reanchorApplied).toBe(false);
  });

  it("is false when re-anchor improves nothing (fewer or equal matches)", async () => {
    const fewMatches = Array.from({ length: 5 }, (_, i) => ({ queryIdx: i, trainIdx: i, distance: 10 }));
    const cropBox = { x: 100, y: 50, width: 300, height: 400, srcWidth: 640, srcHeight: 480 };
    const attempt = { ...fakeAttempt(15), orbFeatures: { ...orbResult(15), cropBox } };
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    (extractFeatures as ReturnType<typeof vi.fn>).mockReturnValue(orbResult(8));
    // First call = initial match; second call (inside re-anchor) = fewer matches.
    (matchOrbFeatures as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(fewMatches)
      .mockReturnValueOnce([{ queryIdx: 0, trainIdx: 0, distance: 5 }]); // fewer
    (computeHomography as ReturnType<typeof vi.fn>).mockReturnValue(new Float64Array(9).fill(1));
    // Return 4 distinct corners so the crop bounding box is non-zero.
    (applyHomographyMatrix as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ x: 100, y: 80 })
      .mockReturnValueOnce({ x: 400, y: 80 })
      .mockReturnValueOnce({ x: 400, y: 350 })
      .mockReturnValueOnce({ x: 100, y: 350 });
    stubLoadImageSuccess(640, 480);

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(result.current.result?.reanchorApplied).toBe(false);
    expect(result.current.result?.matches).toHaveLength(5); // original kept
  });

  it("is true and uses re-anchor result when re-anchor finds more matches", async () => {
    const fewMatches = Array.from({ length: 5 }, (_, i) => ({ queryIdx: i, trainIdx: i, distance: 10 }));
    const moreMatches = Array.from({ length: 12 }, (_, i) => ({ queryIdx: i, trainIdx: i, distance: 8 }));
    const cropBox = { x: 100, y: 50, width: 300, height: 400, srcWidth: 640, srcHeight: 480 };
    const attempt = { ...fakeAttempt(15), orbFeatures: { ...orbResult(15), cropBox } };
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    (extractFeatures as ReturnType<typeof vi.fn>).mockReturnValue(orbResult(8));
    (matchOrbFeatures as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(fewMatches)
      .mockReturnValueOnce(moreMatches); // re-anchor gives more
    (computeHomography as ReturnType<typeof vi.fn>).mockReturnValue(new Float64Array(9).fill(1));
    // Return 4 distinct corners so the crop bounding box is non-zero.
    (applyHomographyMatrix as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ x: 100, y: 80 })
      .mockReturnValueOnce({ x: 400, y: 80 })
      .mockReturnValueOnce({ x: 400, y: 350 })
      .mockReturnValueOnce({ x: 100, y: 350 });
    stubLoadImageSuccess(640, 480);

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(result.current.result?.reanchorApplied).toBe(true);
    expect(result.current.result?.matches).toHaveLength(12);
  });

  it("does not attempt re-anchor when match count < 4", async () => {
    const threeMatches = [
      { queryIdx: 0, trainIdx: 0, distance: 5 },
      { queryIdx: 1, trainIdx: 1, distance: 5 },
      { queryIdx: 2, trainIdx: 2, distance: 5 },
    ];
    const cropBox = { x: 0, y: 0, width: 100, height: 100, srcWidth: 640, srcHeight: 480 };
    const attempt = { ...fakeAttempt(15), orbFeatures: { ...orbResult(15), cropBox } };
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    (extractFeatures as ReturnType<typeof vi.fn>).mockReturnValue(orbResult(5));
    (matchOrbFeatures as ReturnType<typeof vi.fn>).mockReturnValue(threeMatches);
    stubLoadImageSuccess();

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(result.current.result?.reanchorApplied).toBe(false);
    // computeHomography must not have been called.
    expect(computeHomography).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useImageMatcher — userCrop
// ---------------------------------------------------------------------------

describe("useImageMatcher — userCrop", () => {
  it("calls extractFeaturesFromCrop when userCrop is provided", async () => {
    const attempt = fakeAttempt(10);
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    const cropResult = orbResult(6);
    (extractFeaturesFromCrop as ReturnType<typeof vi.fn>).mockReturnValue(cropResult);
    (matchOrbFeatures as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const fakeImageData = stubLoadImageSuccess(200, 150);

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv, {
        x: 0.1,
        y: 0.2,
        w: 0.6,
        h: 0.5,
      });
    });

    expect(extractFeaturesFromCrop).toHaveBeenCalledWith(mockCv, fakeImageData, {
      x: Math.round(0.1 * 200),
      y: Math.round(0.2 * 150),
      width: Math.round(0.6 * 200),
      height: Math.round(0.5 * 150),
      srcWidth: 200,
      srcHeight: 150,
    });
    // extractFeatures should NOT be called when userCrop is set.
    expect(extractFeatures).not.toHaveBeenCalled();
    expect(result.current.status).toBe("done");
  });

  it("calls extractFeatures (no crop) when userCrop is not provided", async () => {
    const attempt = fakeAttempt(10);
    (getAttempt as ReturnType<typeof vi.fn>).mockReturnValue(attempt);
    (extractFeatures as ReturnType<typeof vi.fn>).mockReturnValue(orbResult(10));
    (matchOrbFeatures as ReturnType<typeof vi.fn>).mockReturnValue([]);
    stubLoadImageSuccess();

    const { result } = renderHook(() => useImageMatcher());
    await act(async () => {
      await result.current.matchImage(fakeImageFile(), "attempt-1", mockCv);
    });

    expect(extractFeatures).toHaveBeenCalled();
    expect(extractFeaturesFromCrop).not.toHaveBeenCalled();
  });
});
