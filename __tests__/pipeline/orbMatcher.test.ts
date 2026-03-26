import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { matchFeatures, type OrbMatch } from "@/pipeline/orbMatcher";
import { terminateOrbWorker } from "@/pipeline/orbFeatures";
import type { OrbResult } from "@/pipeline/orbFeatures";

// ---------------------------------------------------------------------------
// Fake Worker — handles both 'detectAndCompute' and 'match' messages
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
    queueMicrotask(() => this._emit({ type: "ready" }));
  }

  postMessage(data: unknown): void {
    this.posted.push({ data });
    const msg = data as { type: string; id: string };

    if (msg.type === "match") {
      const matchMsg = data as {
        type: string;
        id: string;
        refRows: number;
        frameRows: number;
      };
      // Return two fake matches when both sides have rows.
      const matches: OrbMatch[] =
        matchMsg.refRows > 0 && matchMsg.frameRows > 0
          ? [
              { queryIdx: 0, trainIdx: 1, distance: 30 },
              { queryIdx: 2, trainIdx: 0, distance: 45 },
            ]
          : [];
      queueMicrotask(() =>
        this._emit({ type: "matchResult", id: msg.id, matches }),
      );
    }
  }

  terminate(): void {
    latestWorker = null;
  }

  simulateError(id: string, message: string): void {
    queueMicrotask(() => this._emit({ type: "error", id, message }));
  }

  private _emit(data: unknown): void {
    this.onmessage?.({ data } as unknown as MessageEvent);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOrbResult(nKeypoints: number): OrbResult {
  return {
    keypoints: Array.from({ length: nKeypoints }, (_, i) => ({
      pt: { x: i * 10, y: i * 5 },
      size: 3,
      angle: 0,
      response: 0.5,
      octave: 0,
    })),
    // 32 bytes per keypoint
    descriptors: new Uint8Array(nKeypoints * 32).fill(0xab),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  workerConstructions = 0;
  latestWorker = null;
  terminateOrbWorker();
  vi.stubGlobal("Worker", FakeOrbWorker);
});

afterEach(() => {
  terminateOrbWorker();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("matchFeatures — happy path", () => {
  it("returns an array of OrbMatch objects", async () => {
    const ref = makeOrbResult(10);
    const query = makeOrbResult(8);
    const matches = await matchFeatures(ref, query);

    expect(Array.isArray(matches)).toBe(true);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toMatchObject({
      queryIdx: expect.any(Number),
      trainIdx: expect.any(Number),
      distance: expect.any(Number),
    });
  });

  it("sends correct refRows and frameRows derived from descriptor lengths", async () => {
    const ref = makeOrbResult(5); // 5 * 32 = 160 bytes
    const query = makeOrbResult(3); // 3 * 32 = 96 bytes
    await matchFeatures(ref, query);

    const msg = latestWorker!.posted[0].data as {
      type: string;
      refRows: number;
      frameRows: number;
      refDescriptors: Uint8Array;
      frameDescriptors: Uint8Array;
    };
    expect(msg.type).toBe("match");
    expect(msg.refRows).toBe(5);
    expect(msg.frameRows).toBe(3);
  });

  it("sends descriptor bytes by value (not transferred), so ref is reusable", async () => {
    const ref = makeOrbResult(4);
    const query = makeOrbResult(4);
    const originalLength = ref.descriptors.length;

    await matchFeatures(ref, query);

    // Buffer should NOT be neutered — ref.descriptors still readable.
    expect(ref.descriptors.length).toBe(originalLength);
    expect(ref.descriptors[0]).toBe(0xab);
  });
});

describe("matchFeatures — zero-keypoint shortcuts", () => {
  it("returns [] without a worker round-trip when ref has zero keypoints", async () => {
    const ref = makeOrbResult(0);
    const query = makeOrbResult(5);
    const matches = await matchFeatures(ref, query);

    expect(matches).toEqual([]);
    // Worker never constructed because we short-circuit before getReadyWorker().
    expect(workerConstructions).toBe(0);
  });

  it("returns [] without a worker round-trip when query has zero keypoints", async () => {
    const ref = makeOrbResult(5);
    const query = makeOrbResult(0);
    const matches = await matchFeatures(ref, query);

    expect(matches).toEqual([]);
    expect(workerConstructions).toBe(0);
  });
});

describe("matchFeatures — worker lifecycle", () => {
  it("reuses the same worker across multiple matchFeatures calls", async () => {
    const ref = makeOrbResult(4);
    await matchFeatures(ref, makeOrbResult(4));
    await matchFeatures(ref, makeOrbResult(4));
    await matchFeatures(ref, makeOrbResult(4));

    expect(workerConstructions).toBe(1);
  });
});

describe("matchFeatures — error handling", () => {
  it("rejects when the worker posts an error for a match request", async () => {
    // Override postMessage to simulate an error for match messages.
    FakeOrbWorker.prototype.postMessage = function (data: unknown) {
      this.posted.push({ data });
      const msg = data as { type: string; id: string };
      if (msg.type === "match") {
        this.simulateError(msg.id, "BFMatcher WASM error");
      }
    };

    const ref = makeOrbResult(4);
    await expect(matchFeatures(ref, makeOrbResult(4))).rejects.toThrow(
      "BFMatcher WASM error",
    );
  });
});
