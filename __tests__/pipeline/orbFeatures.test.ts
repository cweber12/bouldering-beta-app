import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectAndCompute, terminateOrbWorker, type OrbKeypoint } from "@/pipeline/orbFeatures";

// ---------------------------------------------------------------------------
// Fake Worker that speaks the orbWorker protocol
// ---------------------------------------------------------------------------

let latestWorker: FakeOrbWorker | null = null;
let workerConstructions = 0;

class FakeOrbWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  posted: Array<{ data: unknown }> = [];

  constructor(_url: unknown) {
    workerConstructions++;
    latestWorker = this;
    // Emit 'ready' asynchronously — mirrors the real WASM initialisation delay.
    queueMicrotask(() => this._emit({ type: "ready" }));
  }

  postMessage(data: unknown): void {
    this.posted.push({ data });
    const msg = data as { type: string; id: string };

    if (msg.type === "detectAndCompute") {
      // Simulate the worker detecting one keypoint and producing 2 descriptor bytes.
      const descriptors = new Uint8Array([0xde, 0xad]);
      const kp: OrbKeypoint = {
        pt: { x: 10, y: 20 },
        size: 3,
        angle: 45,
        response: 0.9,
        octave: 0,
      };
      queueMicrotask(() =>
        this._emit({ type: "result", id: msg.id, keypoints: [kp], descriptors }),
      );
    }
  }

  terminate(): void {
    latestWorker = null;
  }

  /** Helper: retrieve all messages posted to this worker. */
  getPostedMessages(): Array<{ data: unknown }> {
    return this.posted;
  }

  /** Simulate an error response for the latest detectAndCompute request. */
  simulateError(id: string, message: string): void {
    queueMicrotask(() => this._emit({ type: "error", id, message }));
  }

  private _emit(data: unknown): void {
    this.onmessage?.({ data } as unknown as MessageEvent);
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let originalPostMessage: (data: unknown) => void;

beforeEach(() => {
  originalPostMessage = FakeOrbWorker.prototype.postMessage;
  workerConstructions = 0;
  latestWorker = null;
  terminateOrbWorker();
  vi.stubGlobal("Worker", FakeOrbWorker);
});

afterEach(() => {
  FakeOrbWorker.prototype.postMessage = originalPostMessage;
  terminateOrbWorker();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal ImageData-shaped object without relying on the constructor. */
function fakeImageData(w = 10, h = 10): ImageData {
  return {
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
    colorSpace: "srgb",
  } as ImageData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectAndCompute — happy path", () => {
  it("resolves with keypoints and a Uint8Array of descriptors", async () => {
    const imageData = fakeImageData();
    const result = await detectAndCompute(imageData);

    expect(result.keypoints).toHaveLength(1);
    expect(result.keypoints[0]).toMatchObject({
      pt: { x: 10, y: 20 },
      size: 3,
      angle: 45,
      response: 0.9,
      octave: 0,
    });
    expect(result.descriptors).toBeInstanceOf(Uint8Array);
    expect(result.descriptors[0]).toBe(0xde);
    expect(result.descriptors[1]).toBe(0xad);
  });

  it("sends a detectAndCompute message containing the imageData", async () => {
    const imageData = fakeImageData(8, 8);
    await detectAndCompute(imageData);

    const msgs = latestWorker!.getPostedMessages();
    expect(msgs).toHaveLength(1);
    expect((msgs[0].data as { type: string; imageData: ImageData }).type).toBe(
      "detectAndCompute",
    );
    expect((msgs[0].data as { type: string; imageData: ImageData }).imageData).toBe(imageData);
  });
});

describe("detectAndCompute — worker lifecycle", () => {
  it("creates only one worker across multiple calls", async () => {
    const img = fakeImageData(4, 4);
    await detectAndCompute(img);
    await detectAndCompute(img);
    await detectAndCompute(img);

    expect(workerConstructions).toBe(1);
  });

  it("creates a fresh worker after terminateOrbWorker()", async () => {
    const img = fakeImageData(4, 4);
    await detectAndCompute(img);
    expect(workerConstructions).toBe(1);

    terminateOrbWorker();
    await detectAndCompute(img);
    expect(workerConstructions).toBe(2);
  });
});

describe("detectAndCompute — error handling", () => {
  it("rejects when the worker posts an error response", async () => {
    // Override postMessage to emit an error instead of a result.
    FakeOrbWorker.prototype.postMessage = function (data: unknown) {
      this.posted = this.posted ?? [];
      this.posted.push({ data });
      const msg = data as { type: string; id: string };
      if (msg.type === "detectAndCompute") {
        queueMicrotask(() => this.simulateError(msg.id, "WASM allocation failed"));
      }
    };

    const imageData = fakeImageData(4, 4);
    await expect(detectAndCompute(imageData)).rejects.toThrow("WASM allocation failed");
  });

  it("rejects when the worker fires onerror before becoming ready", async () => {
    // Simulate importScripts() or WASM load failing inside the worker.
    class ErrorBeforeReadyWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      posted: Array<{ data: unknown }> = [];
      constructor(_url: unknown) {
        workerConstructions++;
        queueMicrotask(() =>
          this.onerror?.({ message: "importScripts failed" } as ErrorEvent),
        );
      }
      postMessage(data: unknown) {
        this.posted.push({ data });
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", ErrorBeforeReadyWorker);

    await expect(detectAndCompute(fakeImageData())).rejects.toThrow("importScripts failed");
  });

  it("allows a fresh worker after an init failure", async () => {
    // First: trigger init failure.
    class ErrorBeforeReadyWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      posted: Array<{ data: unknown }> = [];
      constructor(_url: unknown) {
        workerConstructions++;
        queueMicrotask(() =>
          this.onerror?.({ message: "first attempt failed" } as ErrorEvent),
        );
      }
      postMessage(data: unknown) {
        this.posted.push({ data });
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", ErrorBeforeReadyWorker);
    await expect(detectAndCompute(fakeImageData())).rejects.toThrow();

    // Second attempt: restore the working fake worker.
    vi.stubGlobal("Worker", FakeOrbWorker);
    const result = await detectAndCompute(fakeImageData());
    expect(result.keypoints).toHaveLength(1);
    expect(workerConstructions).toBe(2);
  });
});
