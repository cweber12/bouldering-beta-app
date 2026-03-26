"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { renderPoseVideo } from "@/pipeline/poseVideoRenderer";
import { getAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export type PoseVideoStatus = "idle" | "rendering" | "ready" | "error";

export interface PoseVideoResult {
  videoUrl: string | null;
  status: PoseVideoStatus;
  errorMessage: string | null;
  /** Revoke the current video URL and reset to idle. */
  clearVideo: () => void;
  /** Render progress 0–100. Resets to 0 when a new render starts. */
  renderProgress: number;
  /**
   * JPEG data-URL snapshot of the latest rendered frame, emitted every
   * 25 frames. Null before the first preview arrives.
   */
  previewFrame: string | null;
}

/**
 * Automatically renders an annotated pose-skeleton video whenever a completed
 * image match result is provided.
 *
 * The pipeline:
 *  1. Reads the stored attempt's frames, videoMeta, and orbFeatures.
 *  2. Passes them with the queryOrb and matches from matchResult to
 *     renderPoseVideo, which encodes a WebM blob.
 *  3. Exposes the resulting object URL for a <video> element.
 *
 * The previous video URL is revoked whenever a new render starts.
 * The returned clearVideo() callback revokes the URL when the component
 * unmounts or the user resets.
 */
export function usePoseVideo(
  cv: CV,
  imageFile: File | null,
  attemptId: string | null,
  matchResult: ImageMatchResult | null,
): PoseVideoResult {
  const [status, setStatus] = useState<PoseVideoStatus>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [previewFrame, setPreviewFrame] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!cv || !imageFile || !attemptId || !matchResult) return;

    const attempt = getAttempt(attemptId);
    if (!attempt?.orbFeatures) return;

    // Revoke the previous blob URL before creating a new one.
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- batched by React 19; legitimate render-cycle start
    setStatus("rendering");
    setVideoUrl(null);
    setErrorMessage(null);
    setRenderProgress(0);
    setPreviewFrame(null);

    let cancelled = false;

    renderPoseVideo({
      cv,
      imageFile,
      frames: attempt.frames,
      videoMeta: attempt.videoMeta,
      orbFeatures: attempt.orbFeatures,
      queryOrb: matchResult.queryOrb,
      matches: matchResult.matches,
      onProgress: (rendered, total) => {
        if (!cancelled) setRenderProgress(Math.round((rendered / total) * 100));
      },
      onFramePreview: (_idx, dataUrl) => {
        if (!cancelled) setPreviewFrame(dataUrl);
      },
    })
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        prevUrlRef.current = url;
        setVideoUrl(url);
        setStatus("ready");
        console.info("[usePoseVideo] Video ready.");
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[usePoseVideo] Render failed:", err);
        setStatus("error");
        setErrorMessage(msg);
      });

    return () => {
      cancelled = true;
    };
  }, [cv, imageFile, attemptId, matchResult]);

  const clearVideo = useCallback(() => {
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    setVideoUrl(null);
    setStatus("idle");
    setErrorMessage(null);
    setRenderProgress(0);
    setPreviewFrame(null);
  }, []);

  return { videoUrl, status, errorMessage, clearVideo, renderProgress, previewFrame };
}
