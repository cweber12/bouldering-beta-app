"use client";

import { useEffect, useState } from "react";

/** Displayed strip height (px). Thumbnails render at 2× for crispness. */
const STRIP_HEIGHT = 72;
const THUMB_PIXEL_HEIGHT = STRIP_HEIGHT * 2;

interface ThumbnailFrame {
  timestamp: number;
}

/**
 * Lazily generate a small thumbnail image for each Detection Frame by seeking an
 * offscreen `<video>` (loaded from `videoUrl`) to the frame's timestamp and
 * drawing it to a canvas. Returns a data-URL per frame index (`undefined` until
 * that frame's thumbnail has been produced); the array fills in incrementally as
 * seeking progresses, so a consumer strip can show placeholders that resolve to
 * stills over ~1–3s on a long clip.
 *
 * Detection Frame timestamps are absolute video time (`video.currentTime` at
 * capture), so no offset is applied. The scan pipeline is untouched — this runs
 * entirely from the recorded video after the fact.
 *
 * @param videoUrl - Blob/object URL of the scanned video, or null.
 * @param frames   - Detection Frames (timestamp only is read), in play order.
 * @param enabled  - When false, no work is done and an empty result is returned.
 */
export function useDetectionThumbnails(
  videoUrl: string | null,
  frames: ThumbnailFrame[],
  enabled: boolean,
): (string | undefined)[] {
  const [thumbnails, setThumbnails] = useState<(string | undefined)[]>([]);

  // Stable dependency key: regenerate only when the video or the frame
  // timestamps actually change, not on every array-identity change.
  const framesKey = frames.map((f) => f.timestamp).join(",");

  useEffect(() => {
    if (!enabled || !videoUrl || frames.length === 0) {
      setThumbnails([]);
      return;
    }

    let cancelled = false;
    setThumbnails(new Array(frames.length).fill(undefined));

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = videoUrl;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const teardown = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    /** Await the next `seeked` event, or resolve immediately if already there. */
    const seekTo = (t: number): Promise<void> =>
      new Promise((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
        // Clamp to the decodable range; seeking past duration never fires seeked.
        video.currentTime = Math.max(0, Math.min(video.duration || t, t));
      });

    const run = async () => {
      // Size the canvas once metadata (and thus intrinsic size) is known.
      const scale = THUMB_PIXEL_HEIGHT / (video.videoHeight || THUMB_PIXEL_HEIGHT);
      canvas.height = THUMB_PIXEL_HEIGHT;
      canvas.width = Math.max(1, Math.round((video.videoWidth || 1) * scale));
      if (!ctx) return;

      for (let i = 0; i < frames.length; i += 1) {
        if (cancelled) return;
        await seekTo(frames[i].timestamp);
        if (cancelled) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/png");
        if (cancelled) return;
        setThumbnails((prev) => {
          if (prev.length !== frames.length) return prev;
          const next = prev.slice();
          next[i] = url;
          return next;
        });
      }
    };

    const onLoadedMetadata = () => {
      void run().finally(() => {
        if (!cancelled) teardown();
      });
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      teardown();
    };
    // framesKey captures the frame timestamps; frames.length is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, framesKey, enabled]);

  return thumbnails;
}
