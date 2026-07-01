import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recordOverlayVideo } from "@/pipeline/render/overlayVideoRecorder";

// ---------------------------------------------------------------------------
// MediaRecorder mock — stop() fires onstop synchronously so fake timers can
// drive the whole record loop to completion.
// ---------------------------------------------------------------------------

class FakeMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(false);
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn().mockImplementation(function (this: FakeMediaRecorder) {
    this.onstop?.();
  });
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 100;
  c.height = 80;
  return c;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("recordOverlayVideo — error paths", () => {
  it("throws when MediaRecorder is unavailable", async () => {
    // jsdom does not provide MediaRecorder, so no stub is needed here.
    await expect(
      recordOverlayVideo({
        canvas: makeCanvas(),
        fps: 30,
        totalFrames: 1,
        firstTimestamp: 0,
        drawFrame: vi.fn(),
      }),
    ).rejects.toThrow("MediaRecorder is not supported");
  });
});

describe("recordOverlayVideo — success", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:fake-overlay"),
      revokeObjectURL: vi.fn(),
    });
    HTMLCanvasElement.prototype.captureStream = vi.fn().mockReturnValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves with a blob URL", async () => {
    const promise = recordOverlayVideo({
      canvas: makeCanvas(),
      fps: 30,
      totalFrames: 3,
      firstTimestamp: 0,
      drawFrame: vi.fn(),
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("blob:fake-overlay");
  });

  it("calls drawFrame once per output frame with i and t = firstTimestamp + i / fps", async () => {
    const drawFrame = vi.fn();
    const promise = recordOverlayVideo({
      canvas: makeCanvas(),
      fps: 4,
      totalFrames: 3,
      firstTimestamp: 0,
      drawFrame,
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(drawFrame).toHaveBeenCalledTimes(3);
    expect(drawFrame).toHaveBeenNthCalledWith(1, 0, 0);
    expect(drawFrame).toHaveBeenNthCalledWith(2, 1, 0.25);
    expect(drawFrame).toHaveBeenNthCalledWith(3, 2, 0.5);
  });

  it("reports progress for every frame", async () => {
    const onProgress = vi.fn();
    const promise = recordOverlayVideo({
      canvas: makeCanvas(),
      fps: 30,
      totalFrames: 4,
      firstTimestamp: 0,
      drawFrame: vi.fn(),
      onProgress,
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenLastCalledWith(4, 4);
  });

  it("runs onCleanup exactly once on success", async () => {
    const onCleanup = vi.fn();
    const promise = recordOverlayVideo({
      canvas: makeCanvas(),
      fps: 30,
      totalFrames: 2,
      firstTimestamp: 0,
      drawFrame: vi.fn(),
      onCleanup,
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(onCleanup).toHaveBeenCalledTimes(1);
  });
});
