import { describe, it, expect, vi, afterEach } from "vitest";
import { seekVideo, SeekTimeoutError, SeekAbortedError } from "@/utils/videoSeek";

// ---------------------------------------------------------------------------
// Fake HTMLVideoElement — tracks listeners and records currentTime assignment.
// ---------------------------------------------------------------------------

class FakeVideo {
  listeners: Record<string, Set<EventListener>> = {};
  private _currentTime = 0;
  /** Number of times currentTime was assigned (i.e. a seek was triggered). */
  seekCount = 0;

  addEventListener(type: string, cb: EventListener) {
    (this.listeners[type] ??= new Set()).add(cb);
  }
  removeEventListener(type: string, cb: EventListener) {
    this.listeners[type]?.delete(cb);
  }
  emit(type: string) {
    // Copy to array — handlers remove themselves during iteration.
    [...(this.listeners[type] ?? [])].forEach(cb => cb(new Event(type)));
  }
  /** Total live listeners across all event types. */
  listenerCount() {
    return Object.values(this.listeners).reduce((n, s) => n + s.size, 0);
  }
  set currentTime(t: number) {
    this._currentTime = t;
    this.seekCount++;
  }
  get currentTime() {
    return this._currentTime;
  }
}

function makeVideo() {
  return new FakeVideo() as unknown as HTMLVideoElement & FakeVideo;
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe("seekVideo", () => {
  it("resolves when the seeked event fires and assigns currentTime", async () => {
    const video = makeVideo();
    const p = seekVideo(video, 4.2, { timeoutMs: 1000 });
    expect(video.currentTime).toBe(4.2);
    expect(video.seekCount).toBe(1);
    video.emit("seeked");
    await expect(p).resolves.toBeUndefined();
  });

  it("removes all listeners and clears the timer after resolving", async () => {
    const video = makeVideo();
    const p = seekVideo(video, 1, { timeoutMs: 1000 });
    video.emit("seeked");
    await p;
    expect(video.listenerCount()).toBe(0);
  });

  it("rejects with SeekTimeoutError when no seeked event arrives in time", async () => {
    vi.useFakeTimers();
    const video = makeVideo();
    const p = seekVideo(video, 2, { timeoutMs: 5000 });
    const assertion = expect(p).rejects.toBeInstanceOf(SeekTimeoutError);
    vi.advanceTimersByTime(5000);
    await assertion;
    expect(video.listenerCount()).toBe(0);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const video = makeVideo();
    const controller = new AbortController();
    controller.abort();
    await expect(seekVideo(video, 1, { signal: controller.signal })).rejects.toBeInstanceOf(
      SeekAbortedError,
    );
    // No seek was even attempted.
    expect(video.seekCount).toBe(0);
  });

  it("rejects with SeekAbortedError when aborted mid-flight, and cleans up", async () => {
    const video = makeVideo();
    const controller = new AbortController();
    const p = seekVideo(video, 3, { signal: controller.signal, timeoutMs: 1000 });
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(SeekAbortedError);
    expect(video.listenerCount()).toBe(0);
  });

  it("rejects with a generic Error on a video error event", async () => {
    const video = makeVideo();
    const p = seekVideo(video, 7, { timeoutMs: 1000 });
    video.emit("error");
    await expect(p).rejects.toThrow(/Seek failed at 7s/);
    expect(video.listenerCount()).toBe(0);
  });

  it("disables the timeout when timeoutMs is non-positive", async () => {
    vi.useFakeTimers();
    const video = makeVideo();
    const p = seekVideo(video, 1, { timeoutMs: 0 });
    vi.advanceTimersByTime(60_000);
    // Still pending — resolve it so the promise settles.
    video.emit("seeked");
    await expect(p).resolves.toBeUndefined();
  });
});
