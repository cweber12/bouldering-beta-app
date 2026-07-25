import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReplayImages } from "@/hooks/useReplayImages";
import type { LandingReplayItem } from "@/pipeline/overlay/landingReplayItem";

// ---------------------------------------------------------------------------
// The hook's whole contract is decode *order*: item 0's backdrops first, every
// later item queued behind the one before it, and nothing in the chain able to
// strand what follows it. jsdom neither loads images nor implements decode(), so
// these tests install an Image stub that records the order srcs are requested in
// and settles each one by hand — which is also what makes "still pending"
// observable at all.
// ---------------------------------------------------------------------------

/** Whether the stubbed images offer `decode()`, as a real browser does. */
let withDecode: boolean;
/** Every image whose src has been set, in the order it was set. */
let started: FakeImage[];

/** A stubbed image whose load (or decode) is settled by the test, not the DOM. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode?: () => Promise<void>;
  private settleDecode: { ok: () => void; fail: () => void } | null = null;
  private value = "";

  constructor() {
    if (!withDecode) return;
    this.decode = () =>
      new Promise<void>((resolve, reject) => {
        this.settleDecode = { ok: resolve, fail: () => reject(new Error("decode failed")) };
      });
  }

  get src(): string {
    return this.value;
  }

  set src(next: string) {
    this.value = next;
    started.push(this);
  }

  /** Report the bitmap as ready to paint. */
  succeed(): void {
    if (this.settleDecode) this.settleDecode.ok();
    else this.onload?.();
  }

  /** Report the image as unusable. */
  fail(): void {
    if (this.settleDecode) this.settleDecode.fail();
    else this.onerror?.();
  }
}

/** Drain the decode chain's microtasks and apply the React updates they cause. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

/** The srcs requested so far, in request order. */
function startedSrcs(): string[] {
  return started.map((img) => img.src);
}

/** Settle every image requested so far and let the chain advance. */
async function settleAll(): Promise<void> {
  for (const img of [...started]) img.succeed();
  await flush();
}

function itemNamed(id: string, withStill = true): LandingReplayItem {
  return {
    id,
    label: { area: "Rocktown", route: id, rating: "V4" },
    duration: 14,
    source: { w: 1080, h: 1920, ...(withStill ? { webp: `${id}-still` } : {}) },
    photo: { w: 1200, h: 1600, webp: `${id}-photo` },
    starfield: [{ x: 0.2, y: 0.3 }],
    matches: [{ sx: 0.2, sy: 0.3, px: 0.25, py: 0.35 }],
    poses: [{ t: 0, source: [[15, 0.4, 0.3, 0.9]], photo: [[15, 0.5, 0.4, 0.9]] }],
    holds: [],
  };
}

const THREE = [itemNamed("clip-a"), itemNamed("clip-b"), itemNamed("clip-c")];

beforeEach(() => {
  started = [];
  withDecode = false;
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useReplayImages", () => {
  it("decodes item 0's backdrops and nothing else until they land", async () => {
    renderHook(() => useReplayImages(THREE));
    await flush();

    // Both of the first clip's backdrops are in flight; the four belonging to
    // clips twelve and twenty-four seconds away are not competing with them.
    expect(startedSrcs()).toEqual(["clip-a-photo", "clip-a-still"]);
  });

  it("queues each later item behind the one before it, in play order", async () => {
    renderHook(() => useReplayImages(THREE));
    await flush();
    expect(startedSrcs()).toEqual(["clip-a-photo", "clip-a-still"]);

    await settleAll();
    expect(startedSrcs().slice(2)).toEqual(["clip-b-photo", "clip-b-still"]);

    await settleAll();
    expect(startedSrcs().slice(4)).toEqual(["clip-c-photo", "clip-c-still"]);

    await settleAll();
    expect(started).toHaveLength(6); // the playlist is exhausted, not looping
  });

  it("publishes each item's images keyed by its id, as they land", async () => {
    const { result } = renderHook(() => useReplayImages(THREE));
    await flush();
    expect(result.current).toEqual({});

    await settleAll();
    expect(Object.keys(result.current)).toEqual(["clip-a"]);
    expect(result.current["clip-a"].photo).toBeTruthy();
    expect(result.current["clip-a"].frame).toBeTruthy();

    await settleAll();
    expect(Object.keys(result.current)).toEqual(["clip-a", "clip-b"]);
  });

  it("waits on decode() rather than onload where the browser has it", async () => {
    withDecode = true;
    const { result } = renderHook(() => useReplayImages(THREE));
    await flush();

    // onload firing is not the signal: the bitmap is only paintable once decode
    // resolves, which is what keeps the first drawImage off the decoder.
    for (const img of started) img.onload?.();
    await flush();
    expect(result.current).toEqual({});
    expect(started).toHaveLength(2);

    await settleAll();
    expect(result.current["clip-a"].photo).toBeTruthy();
    expect(startedSrcs().slice(2)).toEqual(["clip-b-photo", "clip-b-still"]);
  });

  it("skips a still an item was never authored with, without stalling", async () => {
    // One list, held across re-renders — the hero's playlist is state, and a new
    // array identity per render would restart the chain from item 0.
    const stillless = [itemNamed("clip-a", false), itemNamed("clip-b")];
    renderHook(() => useReplayImages(stillless));
    await flush();
    expect(startedSrcs()).toEqual(["clip-a-photo"]);

    await settleAll();
    expect(startedSrcs().slice(1)).toEqual(["clip-b-photo", "clip-b-still"]);
  });

  it("lets the chain past a backdrop that fails to decode", async () => {
    const { result } = renderHook(() => useReplayImages(THREE));
    await flush();

    for (const img of started) img.fail();
    await flush();

    // The failed clip simply has no backdrops — it still plays, against the dark
    // stage — and the clips behind it are not stranded by it.
    expect(result.current["clip-a"]).toBeUndefined();
    expect(startedSrcs().slice(2)).toEqual(["clip-b-photo", "clip-b-still"]);
  });

  it("stops the chain when the hero unmounts", async () => {
    const { unmount } = renderHook(() => useReplayImages(THREE));
    await flush();

    unmount();
    await settleAll();

    expect(started).toHaveLength(2); // item 1 never started
  });

  it("starts nothing for an empty playlist", async () => {
    const { result } = renderHook(() => useReplayImages([]));
    await flush();

    expect(started).toHaveLength(0);
    expect(result.current).toEqual({});
  });
});
