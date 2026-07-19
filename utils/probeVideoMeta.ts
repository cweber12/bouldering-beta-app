/**
 * Probe a video blob URL's metadata — duration and native dimensions — without
 * decoding any frames. The duration is the sole input to the Detection Frame
 * grid and the dimensions size reviewer canvases, so harness flows probe before
 * doing anything else with a Test Video. Browser-only (creates a detached
 * `<video>` element); no React imports.
 */

/** Native video dimensions + duration, read from the loaded video element. */
export interface VideoMeta {
  width: number;
  height: number;
  duration: number;
}

/** Read a video blob's duration and native dimensions without decoding frames. */
export function probeVideoMeta(url: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };
    video.onloadedmetadata = () => {
      const meta = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      };
      cleanup();
      resolve(meta);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Failed to read the video's duration."));
    };
    video.src = url;
  });
}
