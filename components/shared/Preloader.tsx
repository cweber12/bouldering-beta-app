"use client";

import { useOpenCV } from "@/hooks/useOpenCV";
import { useTFModel } from "@/hooks/useTFModel";

/**
 * Invisible component placed in the root layout.
 *
 * Starts loading OpenCV.js and the TF.js pose model in the background as soon
 * as any page is visited. Both hooks guard against double-loading at the
 * module level, so calling them here AND inside LoadingGate is safe.
 *
 * By the time the user navigates to Upload or Match, the runtimes are often
 * already initialised, eliminating the LoadingGate spinner entirely.
 */
export default function Preloader() {
  useOpenCV();
  useTFModel();
  return null;
}
