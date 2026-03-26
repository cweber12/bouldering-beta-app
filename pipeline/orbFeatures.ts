/**
 * Main-thread interface for the ORB feature detection Web Worker.
 *
 * Creates the worker once and reuses it across calls. Each call to
 * detectAndCompute() is identified by a unique request ID so that multiple
 * in-flight requests are matched to their correct promise resolutions.
 *
 * The descriptor Uint8Array arrives via a transferred ArrayBuffer (zero-copy).
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

export interface OrbKeypoint {
  pt: { x: number; y: number };
  size: number;
  angle: number;
  response: number;
  octave: number;
}

export interface OrbResult {
  keypoints: OrbKeypoint[];
  /**
   * Binary ORB descriptors. Shape: (nKeypoints × 32) bytes, flattened.
   * Arrives via transferable ArrayBuffer — no copy on receipt.
   */
  descriptors: Uint8Array;
}

// ---------------------------------------------------------------------------
// Module-level worker state (shared across all callers in the same page)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resolve = (value: any) => void;
type Reject = (reason: Error) => void;

interface Pending {
  resolve: Resolve;
  reject: Reject;
}

let worker: Worker | null = null;
let workerReady = false;
const readyCallbacks: Array<() => void> = [];
const readyRejecters: Array<(err: Error) => void> = [];
const pending = new Map<string, Pending>();
let counter = 0;

function handleWorkerMessage(event: MessageEvent): void {
  const data = event.data as { type: string; id?: string; message?: string };
  const { type, id } = data;

  if (type === "ready") {
    workerReady = true;
    const cbs = readyCallbacks.splice(0);
    cbs.forEach((cb) => cb());
    return;
  }

  if (!id) return;
  const req = pending.get(id);
  if (!req) return;
  pending.delete(id);

  if (type === "error") {
    req.reject(new Error(data.message ?? "ORB worker returned an unknown error"));
  } else {
    // Resolve with the full response object; callers extract what they need.
    req.resolve(event.data);
  }
}

function handleWorkerError(err: ErrorEvent): void {
  console.error("[orbFeatures] Worker error:", err.message);
  const error = new Error(err.message ?? "Worker error");
  // Reject all in-flight requests.
  pending.forEach(({ reject }) => reject(error));
  pending.clear();
  // Reject any callers waiting for the worker to become ready.
  const rejecters = readyRejecters.splice(0);
  readyCallbacks.length = 0; // discard paired resolve callbacks
  rejecters.forEach((rj) => rj(error));
  // Reset so the next call recreates the worker.
  worker = null;
  workerReady = false;
}

/** Returns a promise that resolves once the worker signals it is ready. */
function getReadyWorker(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    if (worker && workerReady) {
      resolve(worker);
      return;
    }

    if (!worker) {
      // webpack 5 / Next.js recognises this constructor pattern and bundles
      // orbWorker.js as a separate chunk with its own module scope.
      worker = new Worker(new URL("../workers/orbWorker.js", import.meta.url));
      worker.onmessage = handleWorkerMessage;
      worker.onerror = handleWorkerError;
    }

    readyCallbacks.push(() => resolve(worker!));
    readyRejecters.push((err) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a typed message to the shared ORB worker and wait for its response.
 *
 * The promise resolves with the full response object posted by the worker.
 * Exported for use by sibling modules in pipeline/ (e.g. orbMatcher) so they
 * can share the same worker lifecycle without duplicating infrastructure.
 */
export async function sendOrbRequest<T>(payload: Record<string, unknown>): Promise<T> {
  const w = await getReadyWorker();
  const id = `orb-${++counter}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...payload, id });
  });
}

/**
 * Detect ORB keypoints and compute binary descriptors for the given ImageData.
 *
 * The returned `descriptors` buffer is transferred from the worker (zero-copy).
 * Do not call this from a server component — it creates a Web Worker.
 */
export async function detectAndCompute(imageData: ImageData): Promise<OrbResult> {
  const resp = await sendOrbRequest<{ keypoints: OrbKeypoint[]; descriptors: Uint8Array }>(
    { type: "detectAndCompute", imageData },
  );
  return { keypoints: resp.keypoints, descriptors: resp.descriptors };
}

/**
 * Terminate the worker and reset all module state.
 * Useful in tests and if the app needs to release worker memory.
 */
export function terminateOrbWorker(): void {
  worker?.terminate();
  worker = null;
  workerReady = false;
  readyCallbacks.length = 0;
  readyRejecters.length = 0;
  pending.clear();
  counter = 0;
}
