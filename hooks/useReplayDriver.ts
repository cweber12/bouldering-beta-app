"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { NormalizedPoint } from "@/pipeline/matching/orbDetector";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import type { ReplayData } from "@/pipeline/overlay/replayData.mjs";

// ---------------------------------------------------------------------------
// useReplayDriver — turns baked ReplayData into the { orbPreview, currentPose }
// stream that XrayStage consumes, so the landing-page demo reuses the exact scan
// loading-screen renderer. The starfield is emitted once; poses advance on a
// fixed cadence and loop forever, bumping `resetSignal` at each wrap so the
// motion trail clears instead of jumping across the restart.
//
// The cadence is deliberately fixed (not the source video's real timing): the
// loading-screen look is the glide + fading-trail rhythm, not absolute speed,
// and a fixed cadence gives a predictable loop length for any saved climb. The
// bake already subsamples poses to a punchy count (see replayData.mjs).
// ---------------------------------------------------------------------------

/**
 * One pose per glide, plus a small beat so the 300 ms XrayStage glide fully
 * completes and settles before the next pose supersedes it.
 */
const DRIVER_INTERVAL_MS = 340;

export interface ReplayDriverState {
  orbPreview: NormalizedPoint[] | null;
  currentPose: PoseFrame | null;
  resetSignal: number;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Subscribe to the reduced-motion media query. */
function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True when the user has asked for reduced motion (client-only). */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false, // server snapshot — assume motion is fine until hydrated
  );
}

/**
 * @param replayData     Baked replay, or null while loading.
 * @param active         Advance only while true (paused when offscreen / hidden).
 * @param onLoopComplete Fired each time the pose loop wraps — lets a caller
 *                       advance to the next run in a cycling playlist.
 */
export function useReplayDriver(
  replayData: ReplayData | null,
  active: boolean,
  onLoopComplete?: () => void,
): ReplayDriverState {
  const reduceMotion = usePrefersReducedMotion();

  // Keep the latest callback without re-subscribing the interval each render.
  const onLoopCompleteRef = useRef(onLoopComplete);
  useEffect(() => {
    onLoopCompleteRef.current = onLoopComplete;
  }, [onLoopComplete]);

  const orbPreview = useMemo<NormalizedPoint[] | null>(
    () => (replayData ? replayData.starfield.map((p) => ({ x: p.x, y: p.y })) : null),
    [replayData],
  );

  const poses = replayData?.poses ?? null;
  const [currentPose, setCurrentPose] = useState<PoseFrame | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const indexRef = useRef(0);

  // Build a PoseFrame from a baked pose index. `timestamp` is only an identity
  // marker for XrayStage (it keys glide/trail off each new object), so the index
  // suffices.
  const frameAt = (i: number): PoseFrame | null =>
    poses && poses[i] ? { timestamp: i, keypoints: poses[i].keypoints } : null;

  // Reset to the first pose whenever the source changes.
  useEffect(() => {
    indexRef.current = 0;
    setCurrentPose(frameAt(0));
    setResetSignal((s) => s + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayData]);

  useEffect(() => {
    if (!poses || poses.length === 0) return;
    // Reduced motion: hold a single representative pose, no loop.
    if (reduceMotion) {
      indexRef.current = Math.floor(poses.length / 2);
      setCurrentPose(frameAt(indexRef.current));
      return;
    }
    if (!active) return;

    const id = window.setInterval(() => {
      const next = indexRef.current + 1;
      if (next >= poses.length) {
        indexRef.current = 0;
        setResetSignal((s) => s + 1); // clear the trail at the loop boundary
        onLoopCompleteRef.current?.(); // advance a cycling playlist, if any
      } else {
        indexRef.current = next;
      }
      setCurrentPose(frameAt(indexRef.current));
    }, DRIVER_INTERVAL_MS);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poses, active, reduceMotion]);

  return { orbPreview, currentPose, resetSignal };
}
