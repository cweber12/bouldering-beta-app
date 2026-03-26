import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImageMatcher } from "@/hooks/useImageMatcher";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/pipeline/orbDetector", () => ({
  extractFeatures: vi.fn(),
  matchOrbFeatures: vi.fn(),
}));

vi.mock("@/storage/sessionStore", () => ({
  getAttempt: vi.fn(),
}));

import { extractFeatures, matchOrbFeatures } from "@/pipeline/orbDetector";
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
  vi.clearAllMocks();
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
