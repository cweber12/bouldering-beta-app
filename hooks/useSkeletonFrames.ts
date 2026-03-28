"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildSkeletonFrames,
  type SkeletonFrameData,
} from "@/pipeline/skeletonRenderer";
import { getAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export type SkeletonFrameStatus = "idle" | "ready" | "error";

export interface SkeletonFrameResult {
  /** Pre-computed skeleton frame data, or null when not yet computed. */
  data: SkeletonFrameData | null;
  status: SkeletonFrameStatus;
  errorMessage: string | null;
}

/**
 * Pre-computes transformed skeleton keypoints for instant canvas playback.
 *
 * The underlying computation is synchronous pure math (homography + matrix
 * multiplication) — typically completes in < 1 ms. No canvas, MediaRecorder,
 * or video encoding is involved.
 *
 * Triggers automatically when matchResult changes.
 */
export function useSkeletonFrames(
  cv: CV,
  attemptId: string | null,
  matchResult: ImageMatchResult | null,
  targetFps = 30,
): SkeletonFrameResult {
  const [data, setData] = useState<SkeletonFrameData | null>(null);
  const [status, setStatus] = useState<SkeletonFrameStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Stable dependency key to avoid re-computing when only the matchResult
  // reference changes but the underlying data is the same.
  const depsKey = useMemo(() => {
    if (!cv || !attemptId || !matchResult) return null;
    return `${attemptId}:${matchResult.matches.length}`;
  }, [cv, attemptId, matchResult]);

  useEffect(() => {
    if (!cv || !attemptId || !matchResult) {
      setData(null);
      setStatus("idle");
      setErrorMessage(null);
      return;
    }

    const attempt = getAttempt(attemptId);
    if (!attempt?.orbFeatures) {
      setStatus("error");
      setErrorMessage("No ORB reference features found for this attempt.");
      return;
    }

    try {
      const result = buildSkeletonFrames({
        cv,
        frames: attempt.frames,
        videoMeta: attempt.videoMeta,
        orbFeatures: attempt.orbFeatures,
        queryOrb: matchResult.queryOrb,
        matches: matchResult.matches,
        targetFps,
      });
      setData(result);
      setStatus("ready");
      setErrorMessage(null);
    } catch (err) {
      setData(null);
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, targetFps]);

  return { data, status, errorMessage };
}
