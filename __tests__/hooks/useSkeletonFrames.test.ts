import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/pipeline/skeletonRenderer", () => ({
  buildSkeletonFrames: vi.fn(),
}));

vi.mock("@/storage/sessionStore", () => ({
  getAttempt: vi.fn(),
}));

import { buildSkeletonFrames } from "@/pipeline/skeletonRenderer";
import { getAttempt } from "@/storage/sessionStore";
import type { OrbFeatures } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockCv = {};

function fakeMatchResult(nMatches = 10) {
  return {
    queryOrb: { keypoints: [], descriptors: new Uint8Array(0) },
    matches: Array.from({ length: nMatches }, (_, i) => ({
      queryIdx: i,
      trainIdx: i,
      distance: 10,
    })),
    queryKeypoints: nMatches,
    referenceKeypoints: nMatches,
    reanchorApplied: false,
  };
}

function fakeAttempt() {
  return {
    id: "a1",
    frames: [{ timestamp: 0, keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }] }],
    videoMeta: { width: 640, height: 480, duration: 1, name: "test.mp4", fps: 30 },
    orbFeatures: { keypoints: [], descriptors: new Uint8Array(0) } as OrbFeatures | null,
    matchesPerFrame: null,
    state: "",
    area: "",
    route: "",
    frameCaptures: null,
  };
}

const FAKE_RESULT = {
  frames: [{ timestamp: 0, keypoints: { nose: { x: 320, y: 240 } } }],
  duration: 1,
  fps: 30,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(buildSkeletonFrames).mockReturnValue(FAKE_RESULT);
  vi.mocked(getAttempt).mockReturnValue(fakeAttempt());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSkeletonFrames", () => {
  it("stays idle when cv is null", () => {
    const { result } = renderHook(() =>
      useSkeletonFrames(null, "a1", fakeMatchResult()),
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeNull();
  });

  it("stays idle when attemptId is null", () => {
    const { result } = renderHook(() =>
      useSkeletonFrames(mockCv, null, fakeMatchResult()),
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeNull();
  });

  it("stays idle when matchResult is null", () => {
    const { result } = renderHook(() =>
      useSkeletonFrames(mockCv, "a1", null),
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeNull();
  });

  it("returns ready with skeleton data on valid inputs", () => {
    const { result } = renderHook(() =>
      useSkeletonFrames(mockCv, "a1", fakeMatchResult()),
    );
    expect(result.current.status).toBe("ready");
    expect(result.current.data).toBe(FAKE_RESULT);
    expect(result.current.errorMessage).toBeNull();
  });

  it("returns error when attempt has no orbFeatures", () => {
    vi.mocked(getAttempt).mockReturnValue({
      ...fakeAttempt(),
      orbFeatures: null,
    });
    const { result } = renderHook(() =>
      useSkeletonFrames(mockCv, "a1", fakeMatchResult()),
    );
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/ORB/i);
  });

  it("returns error when buildSkeletonFrames throws", () => {
    vi.mocked(buildSkeletonFrames).mockImplementation(() => {
      throw new Error("homography failed");
    });
    const { result } = renderHook(() =>
      useSkeletonFrames(mockCv, "a1", fakeMatchResult()),
    );
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("homography failed");
  });

  it("resets to idle when matchResult becomes null", () => {
    const mr = fakeMatchResult();
    const { result, rerender } = renderHook(
      ({ match }) => useSkeletonFrames(mockCv, "a1", match),
      { initialProps: { match: mr as ReturnType<typeof fakeMatchResult> | null } },
    );
    expect(result.current.status).toBe("ready");

    rerender({ match: null });
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeNull();
  });

  it("calls buildSkeletonFrames with the supplied targetFps", () => {
    renderHook(() =>
      useSkeletonFrames(mockCv, "a1", fakeMatchResult(), 15),
    );
    expect(buildSkeletonFrames).toHaveBeenCalledWith(
      expect.objectContaining({ targetFps: 15 }),
    );
  });
});
