"use client";

import { useEffect, useMemo, useState } from "react";
import {
  detectHolds,
  projectStoredHolds,
  computeProjectedBodyScale,
  type Hold,
  type HoldProjector,
} from "@/pipeline/holds/holdDetection";
import { applyHomographyMatrix, homographyAtTime } from "@/pipeline/matching/homography";
import { getAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export type HoldsStatus = "idle" | "ready" | "error";

export interface HoldsResult {
  /** Detected Holds in Route Photo space, `firstUseTime` rebased to the 0-based
   *  FramePlayer clock (so it matches the rendered skeleton timeline). */
  holds: Hold[];
  status: HoldsStatus;
}

/**
 * Resolves the **Holds** overlay for a Run, projected into Route Photo space —
 * mirroring {@link useSkeletonFrames}.
 *
 * Two sources, saved wins (ADR 0009): a Run that carries authored Holds
 * (`attempt.holds`, normalized video space, Fixed Capture) projects those
 * through the match homography; a Run without them (every legacy Run, every
 * Panning Capture Run) falls back to deriving Holds on the fly via
 * {@link detectHolds} over the smoothed `attempt.frames`. Either way the
 * projector is built from the match result — the single gated homography (Fixed
 * Capture) or the per-keyframe `homographyAtTime` path (Panning Capture).
 *
 * `cv` is taken for parity with {@link useSkeletonFrames}'s dependency key; the
 * projection itself is pure math and does not call OpenCV.
 */
export function useHolds(
  cv: CV,
  attemptId: string | null,
  matchResult: ImageMatchResult | null,
): HoldsResult {
  const [holds, setHolds] = useState<Hold[]>([]);
  const [status, setStatus] = useState<HoldsStatus>("idle");

  // Stable dependency key — recompute only when the underlying data changes,
  // not on every matchResult reference change (mirrors useSkeletonFrames).
  const depsKey = useMemo(() => {
    if (!cv || !attemptId || !matchResult) return null;
    const kf = matchResult.keyframeHomographies?.length ?? 0;
    // Re-resolve when authored Holds are added/removed/reset on the scan stage.
    const savedHolds = getAttempt(attemptId)?.holds;
    const holdsSig = savedHolds === undefined ? "auto" : `n${savedHolds.length}`;
    return `${attemptId}:${matchResult.matches.length}:${kf}:${holdsSig}`;
  }, [cv, attemptId, matchResult]);

  useEffect(() => {
    if (!cv || !attemptId || !matchResult) {
      setHolds([]);
      setStatus("idle");
      return;
    }

    const attempt = getAttempt(attemptId);
    const kfHomographies = matchResult.keyframeHomographies;
    if (!attempt || (!kfHomographies?.length && !matchResult.homography)) {
      setHolds([]);
      setStatus("error");
      return;
    }

    try {
      const { width, height } = attempt.videoMeta;
      // Project a normalized [0,1] pose point at video time `t` into photo pixels
      // via the same gated homography / per-keyframe path the Skeleton renders
      // through. Panning Capture interpolates the homography at absolute time `t`.
      const sortedKf = kfHomographies?.length
        ? [...kfHomographies].sort((a, b) => a.timestamp - b.timestamp)
        : null;
      const project: HoldProjector = (pt, t) => {
        const h = sortedKf ? homographyAtTime(sortedKf, t) : matchResult.homography!;
        return applyHomographyMatrix(h, pt.x * width, pt.y * height);
      };

      // Saved Holds win when present (including an authored empty array, which
      // means "no Holds" — not a fallback). Otherwise derive on the fly.
      const detected =
        attempt.holds !== undefined
          ? projectStoredHolds(attempt.holds, project)
          : detectHolds(
              attempt.frames,
              project,
              computeProjectedBodyScale(attempt.frames, project),
            );

      // Rebase firstUseTime to the player clock: the rendered skeleton frames
      // start at 0 (firstTs subtracted), so Holds must too for time-gating.
      const firstTs = attempt.frames.length
        ? Math.min(...attempt.frames.map((f) => f.timestamp))
        : 0;
      setHolds(detected.map((hold) => ({ ...hold, firstUseTime: hold.firstUseTime - firstTs })));
      setStatus("ready");
    } catch {
      setHolds([]);
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  return { holds, status };
}
