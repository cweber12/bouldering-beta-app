import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FramePlayer from "@/components/skeleton/FramePlayer";

describe("FramePlayer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps seek time to video currentTime with videoTimeOffset", async () => {
    const originalCreateElement = document.createElement.bind(document);
    const fakeVideo = originalCreateElement("video") as HTMLVideoElement;

    let currentTime = 0;
    Object.defineProperty(fakeVideo, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });
    Object.defineProperty(fakeVideo, "videoWidth", { configurable: true, value: 640 });
    Object.defineProperty(fakeVideo, "videoHeight", { configurable: true, value: 360 });
    Object.defineProperty(fakeVideo, "duration", { configurable: true, value: 30 });
    vi.spyOn(fakeVideo, "play").mockResolvedValue(undefined);
    vi.spyOn(fakeVideo, "pause").mockImplementation(() => undefined);

    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === "video") return fakeVideo;
      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    render(
      <FramePlayer
        videoSrc="blob:scan-video"
        videoTimeOffset={0.5}
        layers={[{ frames: [] }]}
        duration={3}
      />,
    );

    act(() => {
      fakeVideo.dispatchEvent(new Event("loadedmetadata"));
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Seek")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Seek"), { target: { value: "1.25" } });
    expect(currentTime).toBeCloseTo(1.75, 6);
  });

  it("loads the static image path when video is not provided", async () => {
    const close = vi.fn();
    const bitmap = { width: 320, height: 180, close } as unknown as ImageBitmap;
    const imageFile = new File(["x"], "frame.png", { type: "image/png" });

    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));

    const { unmount } = render(
      <FramePlayer
        imageFile={imageFile}
        layers={[{ frames: [] }]}
        duration={1}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Seek")).toBeTruthy();
    });

    expect(createImageBitmap).toHaveBeenCalledWith(imageFile);

    unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
