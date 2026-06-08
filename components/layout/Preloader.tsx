"use client";

import { useOpenCV } from "@/hooks/useOpenCV";

/**
 * Invisible component placed in the root layout.
 *
 * Starts loading OpenCV.js in the background as soon as any page is visited.
 * The hook guards against double-loading at the module level, so calling it
 * here AND inside LoadingGate is safe.
 *
 * By the time the user navigates to Upload or Match, the runtime is often
 * already initialised, eliminating the LoadingGate spinner entirely.
 */
export default function Preloader() {
  useOpenCV();
  return null;
}
