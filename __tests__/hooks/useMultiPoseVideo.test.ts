import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useMultiPoseVideo } from "@/hooks/useMultiPoseVideo";
import type { MultiPoseInput } from "@/hooks/useMultiPoseVideo";

// ---------------------------------------------------------------------------
// Module mock — never exercise the real WASM/MediaRecorder pipeline in tests.
// ---------------------------------------------------------------------------

vi.mock("@/pipeline/multiPoseVideoRenderer", () => ({
  renderMultiPoseVideo: vi.fn(),
}));

import { renderMultiPoseVideo } from "@/pipeline/multiPoseVideoRenderer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockCv = {};

function fakeFile(name = "wall.jpg"): File {
  return new File(["fake"], name, { type: "image/jpeg" });
}

function fakeInput(id = "attempt-1", matchCount = 10): MultiPoseInput {
  const keypoints = Array.from({ length: matchCount }, (_, i) => ({
    pt: { x: i, y: i },
    size: 3,
    angle: 0,
    response: 0.5,
    octave: 0,
  }));
  const orb = { keypoints, descriptors: new Uint8Array(matchCount * 32) };
  const matches = Array.from({ length: matchCount }, (_, i) => ({
    queryIdx: i,
    trainIdx: i,
    distance: 10,
  }));

  return {
    attempt: {
      id,
      videoMeta: { name: "v.mp4", duration: 1, fps: 10, width: 640, height: 480 },
      frames: [{ timestamp: 0, keypoints: [] }],
      orbFeatures: orb,
      matchesPerFrame: null,
      state: "CA",
      area: "Yosemite",
      route: "test-route",
      runType: "attempt" as const,
      frameCaptures: null,
    },
    matchResult: {
      queryOrb: orb,
      matches,
      queryKeypoints: matchCount,
      referenceKeypoints: matchCount,
      reanchorApplied: false,
    },
    skeletonStyle: { limbColor: "#ff0000", jointColor: "white" },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useMultiPoseVideo — initial state", () => {
  it("starts idle when cv is null", () => {
    const { result } = renderHook(() =>
      useMultiPoseVideo(null, fakeFile(), [fakeInput()]),
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.videoUrl).toBeNull();
  });

  it("starts idle when imageFile is null", () => {
    const { result } = renderHook(() =>
      useMultiPoseVideo(mockCv, null, [fakeInput()]),
    );
    expect(result.current.status).toBe("idle");
  });

  it("starts idle when inputs array is empty", () => {
    const { result } = renderHook(() =>
      useMultiPoseVideo(mockCv, fakeFile(), []),
    );
    expect(result.current.status).toBe("idle");
  });

  it("exposes renderProgress as 0 initially", () => {
    const { result } = renderHook(() =>
      useMultiPoseVideo(null, null, []),
    );
    expect(result.current.renderProgress).toBe(0);
  });
});

describe("useMultiPoseVideo — rendering", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:overlay"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(renderMultiPoseVideo).mockReset();
  });

  it("transitions to ready and sets videoUrl when render resolves", async () => {
    vi.mocked(renderMultiPoseVideo).mockResolvedValue("blob:overlay");

    const { result } = renderHook(() =>
      useMultiPoseVideo(mockCv, fakeFile(), [fakeInput()]),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.videoUrl).toBe("blob:overlay");
    expect(result.current.errorMessage).toBeNull();
  });

  it("transitions to error when renderMultiPoseVideo rejects", async () => {
    vi.mocked(renderMultiPoseVideo).mockRejectedValue(new Error("homography failed"));

    const { result } = renderHook(() =>
      useMultiPoseVideo(mockCv, fakeFile(), [fakeInput()]),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toBe("homography failed");
    expect(result.current.videoUrl).toBeNull();
  });

  it("skips rendering if attempt has no orbFeatures", () => {
    const input = fakeInput();
    input.attempt.orbFeatures = null;

    const { result } = renderHook(() =>
      useMultiPoseVideo(mockCv, fakeFile(), [input]),
    );

    // Should remain idle — no render attempt started.
    expect(result.current.status).toBe("idle");
    expect(renderMultiPoseVideo).not.toHaveBeenCalled();
  });

  it("clearVideo resets to idle and revokes the URL", async () => {
    vi.mocked(renderMultiPoseVideo).mockResolvedValue("blob:overlay");

    // Use stable references so re-renders don't change deps and re-trigger the effect.
    const file = fakeFile();
    const inputs = [fakeInput()];

    const { result } = renderHook(() =>
      useMultiPoseVideo(mockCv, file, inputs),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      result.current.clearVideo();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.videoUrl).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:overlay");
  });
});
