import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReplayClock } from "@/hooks/useReplayClock";

// ---------------------------------------------------------------------------
// The clock's whole contract is "one source of elapsed time, every pause input
// feeds it". These tests drive requestAnimationFrame by hand so a frozen clock
// is observable: wall-clock time keeps moving while the clock must not.
// ---------------------------------------------------------------------------

let pending: Map<number, FrameRequestCallback>;
let nextHandle: number;
let observerCallbacks: IntersectionObserverCallback[];
let disconnected: number;
let reducedMotion: boolean;

/** Run one animation frame at wall-clock `now`. */
function frame(now: number): void {
  act(() => {
    const batch = [...pending.values()];
    pending.clear();
    for (const cb of batch) cb(now);
  });
}

/** Report the observed stage as on/offscreen. */
function setOnscreen(isIntersecting: boolean): void {
  act(() => {
    for (const cb of observerCallbacks) {
      cb(
        [{ isIntersecting } as IntersectionObserverEntry],
        null as unknown as IntersectionObserver,
      );
    }
  });
}

/** Flip the tab's visibility and fire the event the clock listens for. */
function setTabHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function renderClock(options?: { enabled?: boolean; staticElapsedMs?: number }) {
  const targetRef = { current: document.createElement("div") };
  return renderHook(() =>
    useReplayClock({
      targetRef,
      enabled: options?.enabled ?? true,
      staticElapsedMs: options?.staticElapsedMs ?? 0,
    }),
  );
}

beforeEach(() => {
  pending = new Map();
  nextHandle = 1;
  observerCallbacks = [];
  disconnected = 0;
  reducedMotion = false;

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const handle = nextHandle++;
    pending.set(handle, cb);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    pending.delete(handle);
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        observerCallbacks.push(cb);
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
      unobserve() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") && reducedMotion,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useReplayClock", () => {
  it("accumulates frame deltas, ignoring the wall-clock offset of the first frame", () => {
    const { result } = renderClock();

    frame(10_000); // anchors the baseline — contributes nothing
    expect(result.current.elapsedMs).toBe(0);

    frame(10_016);
    expect(result.current.elapsedMs).toBeCloseTo(16, 6);

    frame(10_032);
    expect(result.current.elapsedMs).toBeCloseTo(32, 6);
    expect(result.current.running).toBe(true);
  });

  it("freezes on user pause and resumes from the same value with no jump", () => {
    const { result } = renderClock();
    frame(1000);
    frame(1016);
    expect(result.current.elapsedMs).toBeCloseTo(16, 6);

    act(() => result.current.togglePaused());
    expect(result.current.running).toBe(false);
    expect(result.current.paused).toBe(true);

    // Five seconds of wall clock pass while paused.
    frame(6000);
    expect(result.current.elapsedMs).toBeCloseTo(16, 6);

    act(() => result.current.togglePaused());
    expect(result.current.running).toBe(true);
    frame(6000); // re-anchor
    expect(result.current.elapsedMs).toBeCloseTo(16, 6);
    frame(6016);
    expect(result.current.elapsedMs).toBeCloseTo(32, 6); // continues, never jumps
  });

  it("freezes while the stage is offscreen and resumes where it stopped", () => {
    const { result } = renderClock();
    frame(1000);
    frame(1016);

    setOnscreen(false);
    expect(result.current.running).toBe(false);
    frame(9000);
    expect(result.current.elapsedMs).toBeCloseTo(16, 6);

    setOnscreen(true);
    expect(result.current.running).toBe(true);
    frame(9000);
    frame(9016);
    expect(result.current.elapsedMs).toBeCloseTo(32, 6);
  });

  it("freezes while the tab is hidden and resumes where it stopped", () => {
    const { result } = renderClock();
    frame(1000);
    frame(1016);

    setTabHidden(true);
    expect(result.current.running).toBe(false);
    frame(20_000);
    expect(result.current.elapsedMs).toBeCloseTo(16, 6);

    setTabHidden(false);
    frame(20_000);
    frame(20_016);
    expect(result.current.elapsedMs).toBeCloseTo(32, 6);
  });

  it("stays frozen while any one input is paused, not just the last one set", () => {
    const { result } = renderClock();
    frame(1000);
    frame(1016);

    setOnscreen(false);
    act(() => result.current.togglePaused()); // user pauses too
    setOnscreen(true); // back on screen, but the user is still paused
    expect(result.current.running).toBe(false);
    frame(5000);
    expect(result.current.elapsedMs).toBeCloseTo(16, 6);

    act(() => result.current.togglePaused());
    expect(result.current.running).toBe(true);
  });

  it("holds still until it is enabled", () => {
    const { result, rerender } = renderClock({ enabled: false });
    expect(result.current.running).toBe(false);
    frame(1000);
    frame(1016);
    expect(result.current.elapsedMs).toBe(0);
    rerender();
  });

  it("parks on the static frame under reduced motion and stays paused", () => {
    reducedMotion = true;
    const { result } = renderClock({ staticElapsedMs: 8000 });

    expect(result.current.reducedMotion).toBe(true);
    expect(result.current.paused).toBe(true);
    expect(result.current.running).toBe(false);
    expect(result.current.elapsedMs).toBe(8000);

    frame(1000);
    frame(1016);
    expect(result.current.elapsedMs).toBe(8000);
  });

  it("plays from the static frame once reduced motion is overridden explicitly", () => {
    reducedMotion = true;
    const { result } = renderClock({ staticElapsedMs: 8000 });

    act(() => result.current.togglePaused());
    expect(result.current.running).toBe(true);

    frame(1000);
    frame(1016);
    expect(result.current.elapsedMs).toBeCloseTo(8016, 6);
  });

  it("stops observing the stage on unmount", () => {
    const { unmount } = renderClock();
    unmount();
    expect(disconnected).toBe(1);
  });
});
