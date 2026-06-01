/**
 * Bounded video seeking.
 *
 * Seeking an `HTMLVideoElement` by assigning `currentTime` and awaiting the
 * `seeked` event can hang indefinitely when a decoder stalls, and a plain
 * `await` cannot be interrupted by a user cancel. {@link seekVideo} races the
 * `seeked` event against a timeout and an optional `AbortSignal` so the frame
 * loop always makes progress or terminates promptly.
 */

/** Thrown when a seek does not complete within the allotted time. */
export class SeekTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeekTimeoutError";
  }
}

/** Thrown when a seek is interrupted by an aborted signal. */
export class SeekAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeekAbortedError";
  }
}

export interface SeekOptions {
  /**
   * Maximum time (ms) to wait for the `seeked` event before rejecting with a
   * {@link SeekTimeoutError}. Non-positive disables the timeout. Default 10000.
   */
  timeoutMs?: number;
  /** When aborted, the seek rejects promptly with a {@link SeekAbortedError}. */
  signal?: AbortSignal;
}

/** Default per-seek timeout (ms). */
export const DEFAULT_SEEK_TIMEOUT_MS = 10_000;

/**
 * Seek `video` to `time` seconds and resolve when the `seeked` event fires.
 *
 * Rejects with:
 *  - {@link SeekAbortedError} if `signal` is (or becomes) aborted,
 *  - {@link SeekTimeoutError} if no `seeked` event arrives within `timeoutMs`,
 *  - a generic `Error` if the element fires an `error` event.
 *
 * All listeners and the timer are removed before the promise settles.
 */
export function seekVideo(
  video: HTMLVideoElement,
  time: number,
  options: SeekOptions = {},
): Promise<void> {
  const { timeoutMs = DEFAULT_SEEK_TIMEOUT_MS, signal } = options;

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SeekAbortedError("Seek aborted before it started."));
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (timer !== undefined) clearTimeout(timer);
    };

    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Seek failed at ${time}s`));
    };
    const onAbort = () => {
      cleanup();
      reject(new SeekAbortedError(`Seek aborted at ${time}s`));
    };

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(new SeekTimeoutError(`Seek timed out after ${timeoutMs}ms at ${time}s`));
      }, timeoutMs);
    }

    video.currentTime = time;
  });
}
