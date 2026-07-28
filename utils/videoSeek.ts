/**
 * Bounded waits on an `HTMLVideoElement`.
 *
 * Awaiting a media event — `seeked`, `loadedmetadata` — can hang indefinitely
 * when a decoder stalls, and a plain `await` cannot be interrupted by a user
 * cancel. These helpers race the event against a timeout and an optional
 * `AbortSignal` so the caller always makes progress or terminates promptly.
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

/** Default wait for `loadedmetadata` (ms) — generous; decoding has not started. */
export const DEFAULT_METADATA_TIMEOUT_MS = 30_000;

/** `HTMLMediaElement.HAVE_METADATA` — not a global in every test environment. */
const HAVE_METADATA = 1;

/**
 * Resolve once `video` has reported its metadata (duration and dimensions).
 *
 * Bounded for the same reason as {@link seekVideo}, and for one specific
 * failure: a browser whose media-decoder pool is exhausted stops firing
 * `loadedmetadata` **silently** — no `error` event ever arrives. A batch sweep
 * that creates one element per video walks into this, and an unbounded await
 * then hangs the whole sweep on a run that has not decoded a single frame.
 *
 * Rejects with a plain `Error` — unlike a seek, neither a timeout nor an abort
 * is recoverable here, so the caller has no reason to tell them apart beyond
 * the message.
 */
export function loadVideoMetadata(
  video: HTMLVideoElement,
  options: SeekOptions = {},
): Promise<void> {
  const { timeoutMs = DEFAULT_METADATA_TIMEOUT_MS, signal } = options;

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Video metadata load aborted before it started."));
      return;
    }

    // Already there: a caller that assigned `src` earlier would otherwise wait
    // for an event that has already fired.
    if (video.readyState >= HAVE_METADATA) {
      resolve();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (timer !== undefined) clearTimeout(timer);
    };

    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to load video metadata."));
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Video metadata load aborted."));
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Video metadata did not load within ${timeoutMs}ms — the browser's ` +
              `media decoder pool may be exhausted.`,
          ),
        );
      }, timeoutMs);
    }
  });
}
