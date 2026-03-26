/**
 * Main-thread interface for ORB descriptor matching.
 *
 * Reuses the shared ORB worker (via sendOrbRequest) to run BFMatcher inside
 * the WASM runtime — matching is too CPU-intensive to run on the main thread.
 *
 * The worker applies a Lowe ratio test (k=2, ratio=0.75) so only high-quality
 * correspondences are returned.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

import { sendOrbRequest } from "@/pipeline/orbFeatures";
import type { OrbResult } from "@/pipeline/orbFeatures";

export interface OrbMatch {
  /** Index into the reference (query) keypoints array. */
  queryIdx: number;
  /** Index into the frame (train) keypoints array. */
  trainIdx: number;
  /** Hamming distance — lower is a better match. */
  distance: number;
}

/** ORB descriptors are 256-bit = 32 bytes each. */
const ORB_DESCRIPTOR_BYTES = 32;

/**
 * Match two sets of ORB descriptors using BFMatcher inside the shared worker.
 *
 * Returns an empty array immediately (no worker round-trip) when either result
 * has no keypoints, since there is nothing to match against.
 *
 * Descriptors are NOT transferred — the reference OrbResult may be reused
 * across many subsequent frames.
 */
export async function matchFeatures(
  ref: OrbResult,
  query: OrbResult,
): Promise<OrbMatch[]> {
  const refRows = ref.descriptors.length / ORB_DESCRIPTOR_BYTES;
  const frameRows = query.descriptors.length / ORB_DESCRIPTOR_BYTES;

  // Skip the worker round-trip when there is nothing to match.
  if (refRows === 0 || frameRows === 0) return [];

  const resp = await sendOrbRequest<{ matches: OrbMatch[] }>({
    type: "match",
    refDescriptors: ref.descriptors,
    refRows,
    frameDescriptors: query.descriptors,
    frameRows,
  });

  return resp.matches;
}
