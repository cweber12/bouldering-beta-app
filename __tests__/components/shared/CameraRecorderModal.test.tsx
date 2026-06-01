import { render, screen, fireEvent, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import CameraRecorderModal from "@/components/shared/CameraRecorderModal";

// ---------------------------------------------------------------------------
// Fakes for the media APIs jsdom does not provide.
// ---------------------------------------------------------------------------

/** A fake MediaStreamTrack that records when it was stopped. */
function makeTrack() {
  return { stop: vi.fn() };
}

/** A fake MediaStream backed by a single track. */
function makeStream() {
  const track = makeTrack();
  return { getTracks: () => [track], _track: track } as unknown as MediaStream & {
    _track: ReturnType<typeof makeTrack>;
  };
}

/**
 * Minimal MediaRecorder stand-in. `stop()` flips state to "inactive" and fires
 * the registered `onstop` synchronously, mirroring the real teardown order the
 * component relies on.
 */
class FakeMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(true);
  state: "recording" | "inactive" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: MediaStream, public options?: { mimeType?: string }) {}
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"], { type: "video/webm" }) });
    this.onstop?.();
  }
}

let currentStream: ReturnType<typeof makeStream>;

beforeEach(() => {
  currentStream = makeStream();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(currentStream),
    },
  });
  // jsdom canvas has no 2D context or toBlob; stub both for the photo path.
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() });
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(["img"], { type: "image/jpeg" }));
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Render the modal and wait until the camera stream is ready. */
async function renderReady(props: Partial<React.ComponentProps<typeof CameraRecorderModal>> = {}) {
  const onCapture = vi.fn();
  const onClose = vi.fn();
  const utils = render(<CameraRecorderModal onCapture={onCapture} onClose={onClose} {...props} />);
  // getUserMedia resolves on a microtask; let the ready state settle.
  await act(async () => {});
  return { onCapture, onClose, ...utils };
}

describe("CameraRecorderModal capture intent", () => {
  it("emits a capture when the user clicks Stop & save", async () => {
    const { onCapture } = await renderReady();

    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /stop & save/i }));
    });

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture.mock.calls[0][0]).toBeInstanceOf(File);
  });

  it("does NOT emit a capture when the modal is closed mid-recording (unmount)", async () => {
    const { onCapture, unmount } = await renderReady();

    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    // Closing the modal unmounts it — teardown must discard the recording.
    await act(async () => {
      unmount();
    });

    expect(onCapture).not.toHaveBeenCalled();
    // The camera track is still released on teardown.
    expect(currentStream._track.stop).toHaveBeenCalled();
  });

  it("does NOT emit a capture when Escape closes the modal mid-recording", async () => {
    const { onCapture, onClose } = await renderReady();

    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("emits a capture from the explicit Take photo action", async () => {
    const { onCapture } = await renderReady({ mode: "photo" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /take photo/i }));
    });

    expect(onCapture).toHaveBeenCalledTimes(1);
  });
});
