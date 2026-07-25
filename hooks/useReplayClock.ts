"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// useReplayClock — the landing replay's single source of elapsed time.
//
// There is exactly one clock, and every reason the animation should stop is an
// input to it rather than a separate effect: the user pressing pause, the stage
// scrolling offscreen, the tab going hidden, and the reduced-motion preference
// all resolve into one `running` flag. Splitting them is how freeze/resume drift
// gets in — two timers that each think they own "now" disagree the moment one of
// them is suspended.
//
// Elapsed time accumulates from frame deltas, never from a start timestamp, so a
// pause simply stops adding. The first frame after a resume only re-anchors the
// delta baseline; it never contributes the wall-clock time that passed while the
// clock was stopped, so phase progression, pose progression and crossfades all
// continue from exactly the value they froze at.
//
// Reduced motion parks the clock on `staticElapsedMs` (the renderer passes the
// clip duration, i.e. the finished Route Overlay) and holds it paused until the
// visitor explicitly presses play.
// ---------------------------------------------------------------------------

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface ReplayClockOptions {
  /**
   * The stage element whose on-screen visibility gates the clock. When the ref
   * is empty, or the environment has no IntersectionObserver, the stage counts
   * as visible.
   */
  targetRef: React.RefObject<HTMLElement | null>;
  /** While false the clock holds still (e.g. the replay asset has not loaded). */
  enabled?: boolean;
  /** Elapsed value the clock starts and parks at under reduced motion. Default 0. */
  staticElapsedMs?: number;
}

export interface ReplayClock {
  /** Milliseconds of replay time elapsed — the only clock the renderer reads. */
  elapsedMs: number;
  /** True while the clock is actually advancing. */
  running: boolean;
  /** True when the visitor has paused (or reduced motion has paused for them). */
  paused: boolean;
  /** Whether the visitor prefers reduced motion. */
  reducedMotion: boolean;
  /** Toggle the visitor's pause. Any explicit toggle releases the reduced-motion hold. */
  togglePaused: () => void;
}

/** Subscribe to the reduced-motion media query. */
function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Current reduced-motion preference; false where matchMedia is unavailable. */
function reducedMotionSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** True when the visitor has asked for reduced motion (client-only). */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    () => false, // server snapshot — assume motion is fine until hydrated
  );
}

export function useReplayClock({
  targetRef,
  enabled = true,
  staticElapsedMs = 0,
}: ReplayClockOptions): ReplayClock {
  const reducedMotion = usePrefersReducedMotion();

  // `null` until the visitor touches the control: while it is null the
  // reduced-motion preference decides, and from the first explicit play/pause on,
  // the visitor does. Derived rather than written by an effect, so the preference
  // arriving after hydration cannot race the first frame.
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const [onscreen, setOnscreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [tickElapsed, setTickElapsed] = useState(0);

  // The authoritative accumulated value; React state mirrors it for rendering.
  const elapsedRef = useRef(0);

  /** Reduced motion is holding the static frame and no one has pressed play. */
  const parked = userPaused === null && reducedMotion;
  const paused = userPaused ?? reducedMotion;
  const elapsedMs = parked ? staticElapsedMs : tickElapsed;

  // Offscreen and hidden-tab inputs.
  useEffect(() => {
    const el = targetRef.current;
    const syncVisibility = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", syncVisibility);

    let observer: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(([entry]) => setOnscreen(entry.isIntersecting));
      observer.observe(el);
    }

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      observer?.disconnect();
    };
  }, [targetRef]);

  const running = enabled && !paused && onscreen && tabVisible;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    // Null until the first frame of this run, so the gap that a pause, an
    // offscreen scroll or a hidden tab left behind is never accumulated.
    let last: number | null = null;
    const tick = (now: number) => {
      if (last !== null) {
        elapsedRef.current += now - last;
        setTickElapsed(elapsedRef.current);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const togglePaused = useCallback(() => {
    // Leaving the reduced-motion park: adopt the static frame as the starting
    // point so play continues the story rather than restarting it.
    if (parked) {
      elapsedRef.current = staticElapsedMs;
      setTickElapsed(staticElapsedMs);
    }
    setUserPaused(!paused);
  }, [parked, paused, staticElapsedMs]);

  return { elapsedMs, running, paused, reducedMotion, togglePaused };
}
