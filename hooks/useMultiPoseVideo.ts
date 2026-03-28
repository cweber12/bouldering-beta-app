"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  renderMultiPoseVideo,
  type MultiPoseLayer,
} from "@/pipeline/multiPoseVideoRenderer";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export type MultiPoseVideoStatus = "idle" | "rendering" | "ready" | "error";

export interface MultiPoseInput {
  attempt: RouteAttempt;
  matchResult: ImageMatchResult;
  skeletonStyle?: SkeletonStyle;
}

export interface MultiPoseVideoResult {
  videoUrl: string | null;
  status: MultiPoseVideoStatus;
  errorMessage: string | null;
  /** Revoke the current video URL and reset to idle. */
  clearVideo: () => void;
  /** Render progress 0–100. Resets to 0 when a new render starts. */
  renderProgress: number;
}

/**
 * Stable serialization key for the inputs array. Used to detect when the
 * underlying match data changes and a new render should be triggered. Skeleton
 * styles are intentionally excluded so that a color change alone does not
 * auto-trigger re-rendering; styles are read via a ref at render time.
 */
function inputsKey(inputs: MultiPoseInput[]): string {
  return inputs
    .map((inp) => `${inp.attempt.id}:${inp.matchResult.matches.length}`)
    .join("|");
}

/**
 * Automatically renders a composite pose-skeleton overlay video whenever the
 * set of matched attempts changes.
 *
 * A new render starts when:
 *  - `cv`, `imageFile`, or the match data in `inputs` (detected via attempt id
 *    + match count) changes.
 *
 * Skeleton styles (colors) are read from the latest `inputs` at render time via
 * a ref, so updating colors does NOT trigger a re-render on its own — the new
 * colors take effect on the next match-triggered render.
 *
 * The previous video URL is revoked whenever a new render begins.
 * The returned `clearVideo()` callback revokes the URL on demand.
 */
export function useMultiPoseVideo(
  cv: CV,
  imageFile: File | null,
  inputs: MultiPoseInput[],
): MultiPoseVideoResult {
  const [status, setStatus] = useState<MultiPoseVideoStatus>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const prevUrlRef = useRef<string | null>(null);

  // Stable ref so the render effect always reads the latest styles without
  // needing them as effect dependencies.
  const inputsRef = useRef<MultiPoseInput[]>(inputs);
  useEffect(() => {
    inputsRef.current = inputs;
  }, [inputs]);

  // Only re-run the render when match data meaningfully changes.
  const depsKey = useMemo(
    () => (cv && imageFile && inputs.length > 0 ? inputsKey(inputs) : null),
    [cv, imageFile, inputs],
  );

  useEffect(() => {
    if (!cv || !imageFile || inputs.length === 0) return;

    // Build layers from the attempt objects supplied in the latest inputs.
    const latestInputs = inputsRef.current;
    const layers: MultiPoseLayer[] = [];
    for (const inp of latestInputs) {
      if (!inp.attempt.orbFeatures) {
        // Attempt's ORB features not yet extracted; skip this render cycle.
        return;
      }
      layers.push({
        frames: inp.attempt.frames,
        videoMeta: inp.attempt.videoMeta,
        orbFeatures: inp.attempt.orbFeatures,
        queryOrb: inp.matchResult.queryOrb,
        matches: inp.matchResult.matches,
        skeletonStyle: inp.skeletonStyle,
      });
    }

    // Revoke the previous blob URL before creating a new one.
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }

    setStatus("rendering");
    setVideoUrl(null);
    setErrorMessage(null);
    setRenderProgress(0);

    let cancelled = false;

    renderMultiPoseVideo({
      cv,
      imageFile,
      layers,
      targetFps: 15,
      onProgress: (rendered, total) => {
        if (!cancelled) setRenderProgress(Math.round((rendered / total) * 100));
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
        console.info("[useMultiPoseVideo] Overlay video ready.");
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useMultiPoseVideo] Render failed:", err);
        setStatus("error");
        setErrorMessage(msg);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cv, imageFile, depsKey]);

  const clearVideo = useCallback(() => {
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    setVideoUrl(null);
    setStatus("idle");
    setErrorMessage(null);
    setRenderProgress(0);
  }, []);

  // Revoke on unmount.
  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    };
  }, []);

  return { videoUrl, status, errorMessage, clearVideo, renderProgress };
}
