import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDetectionThumbnails } from "@/hooks/useDetectionThumbnails";

/**
 * Build a fake <video> whose `currentTime` setter fires a `seeked` event (as a
 * real decoder would), plus a stubbed canvas context + `toDataURL`. jsdom has no
 * video pipeline, so the hook is exercised against these seams.
 */
function installVideoAndCanvasMocks(dataUrl = "data:image/png;base64,THUMB") {
  const originalCreateElement = document.createElement.bind(document);
  const fakeVideo = originalCreateElement("video") as HTMLVideoElement;

  let currentTime = 0;
  Object.defineProperty(fakeVideo, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
      queueMicrotask(() => fakeVideo.dispatchEvent(new Event("seeked")));
    },
  });
  Object.defineProperty(fakeVideo, "videoWidth", { configurable: true, value: 720 });
  Object.defineProperty(fakeVideo, "videoHeight", { configurable: true, value: 1280 });
  Object.defineProperty(fakeVideo, "duration", { configurable: true, value: 30 });
  vi.spyOn(fakeVideo, "pause").mockImplementation(() => undefined);
  vi.spyOn(fakeVideo, "load").mockImplementation(() => undefined);

  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName.toLowerCase() === "video") return fakeVideo;
    return originalCreateElement(tagName);
  }) as typeof document.createElement);

  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(dataUrl);

  return { fakeVideo, drawImage };
}

describe("useDetectionThumbnails", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("produces one thumbnail per frame once seeking completes", async () => {
    const { fakeVideo } = installVideoAndCanvasMocks();
    const frames = [{ timestamp: 0 }, { timestamp: 0.5 }, { timestamp: 1 }];

    const { result } = renderHook(() =>
      useDetectionThumbnails("blob:scan-video", frames, true),
    );

    act(() => {
      fakeVideo.dispatchEvent(new Event("loadedmetadata"));
    });

    await waitFor(() => {
      expect(result.current.filter(Boolean)).toHaveLength(frames.length);
    });
    expect(result.current).toEqual([
      "data:image/png;base64,THUMB",
      "data:image/png;base64,THUMB",
      "data:image/png;base64,THUMB",
    ]);
  });

  it("does nothing when disabled", () => {
    installVideoAndCanvasMocks();
    const { result } = renderHook(() =>
      useDetectionThumbnails("blob:scan-video", [{ timestamp: 0 }], false),
    );
    expect(result.current).toEqual([]);
  });

  it("tears down the offscreen video on unmount", () => {
    const { fakeVideo } = installVideoAndCanvasMocks();
    const { unmount } = renderHook(() =>
      useDetectionThumbnails("blob:scan-video", [{ timestamp: 0 }], true),
    );
    unmount();
    expect(fakeVideo.pause).toHaveBeenCalled();
  });
});
