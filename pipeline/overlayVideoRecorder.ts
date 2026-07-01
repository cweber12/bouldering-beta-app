/**
 * Shared WebM recorder for canvas overlay videos.
 *
 * Owns the MediaRecorder lifecycle, MIME-type selection, the real-time-paced
 * output loop, single-run cleanup, and blob-URL production. The only thing that
 * varies between the single-layer (`poseVideoRenderer`) and multi-layer
 * (`multiPoseVideoRenderer`) paths is what each output frame paints — supplied
 * as the `drawFrame(frameIndex, timestampSec)` callback.
 *
 * Pacing: MediaRecorder samples `canvas.captureStream` in wall-clock real time,
 * so the loop measures each frame's draw work and subtracts it from the wait.
 * That keeps the output period tracking real time rather than drifting to
 * (work + frameDelay) and dragging the export past the clip's own duration.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

/** Preferred MIME type order; first supported type wins. */
const CANDIDATE_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

function chooseMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export interface RecordOverlayVideoParams {
  /** The canvas whose frames are captured. Must already be sized. */
  canvas: HTMLCanvasElement;
  /** Output frame rate (fps). */
  fps: number;
  /** Number of output frames to emit. */
  totalFrames: number;
  /** Timestamp (s) of output frame 0; frame `i` is at `firstTimestamp + i / fps`. */
  firstTimestamp: number;
  /**
   * Paint output frame `frameIndex` at `timestampSec` — background and overlay.
   * Called once per output frame, in order. Synchronous: all drawing must
   * complete before it returns so the captured frame is correct.
   */
  drawFrame: (frameIndex: number, timestampSec: number) => void;
  /**
   * Called after each frame is drawn. `framesRendered` is 1-based;
   * `totalFrames` is the full count.
   */
  onProgress?: (framesRendered: number, totalFrames: number) => void;
  /**
   * Released exactly once — on stop, encoder error, or a thrown draw — so the
   * caller can close ImageBitmaps and free per-render resources on every path.
   */
  onCleanup?: () => void;
}

/**
 * Record the canvas to a WebM blob and resolve with an object URL.
 *
 * The caller owns `URL.revokeObjectURL()` on the returned URL once the video
 * element no longer needs it.
 *
 * @throws If MediaRecorder is unavailable in this environment.
 */
export async function recordOverlayVideo({
  canvas,
  fps,
  totalFrames,
  firstTimestamp,
  drawFrame,
  onProgress,
  onCleanup,
}: RecordOverlayVideoParams): Promise<string> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not supported in this browser.");
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    onCleanup?.();
  };

  const frameDelay = Math.round(1000 / fps);
  const stream = canvas.captureStream(fps);
  const mimeType = chooseMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise<string>((resolve, reject) => {
    recorder.onstop = () => {
      cleanup();
      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      resolve(URL.createObjectURL(blob));
    };

    recorder.onerror = () => {
      cleanup();
      reject(new Error("MediaRecorder encountered an error during encoding."));
    };

    recorder.start();

    (async () => {
      for (let i = 0; i < totalFrames; i++) {
        const frameStart = performance.now();
        const t = firstTimestamp + i / fps;

        drawFrame(i, t);
        onProgress?.(i + 1, totalFrames);

        const elapsed = performance.now() - frameStart;
        await new Promise<void>((r) => setTimeout(r, Math.max(0, frameDelay - elapsed)));
      }

      recorder.stop();
    })().catch((err) => {
      cleanup();
      try {
        recorder.stop();
      } catch {
        // recorder may already be stopped; ignore
      }
      reject(err);
    });
  });
}
