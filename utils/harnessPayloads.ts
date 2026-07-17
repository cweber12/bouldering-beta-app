/**
 * Harness detection-run payloads.
 *
 * Shapes the `pose` and `orb` bodies pushed to the downloader's POST
 * /api/detections for one Test Video run (see docs/adr/0017). Both reuse the
 * self-contained ScanDiagnostics record — no new metrics — and carry the
 * `setupHash` that ties the run to the Scan Setup it replayed. Attribution
 * (appVersion, resolved config) already lives inside ScanDiagnostics.
 *
 * Posting is append-only: each Analyze run adds a row, and a run superseded by a
 * later Setup edit or code change is left in place to be told apart by its
 * stamps rather than deleted (ADR 0018).
 *
 * Framework-agnostic — no React imports.
 */

import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import type { ScanDiagnostics, ReferenceFrameMeta } from "@/pipeline/analysis/diagnostics";

/** The `pose` half: full diagnostics record + the dense pose frames. */
export interface HarnessPosePayload {
  setupHash: string;
  diagnostics: ScanDiagnostics;
  frames: PoseFrame[];
}

/** The `orb` half: capture-time extraction data (Reference Frame Metadata + summary). */
export interface HarnessOrbPayload {
  setupHash: string;
  appVersion: string;
  referenceFrameMeta: ReferenceFrameMeta | null;
  summary: ScanDiagnostics["result"]["orb"];
}

/** Build the pose + orb payloads for one detection run. */
export function buildHarnessPayloads(args: {
  diagnostics: ScanDiagnostics;
  frames: PoseFrame[];
  referenceFrameMeta: ReferenceFrameMeta | null;
  setupHash: string;
}): { pose: HarnessPosePayload; orb: HarnessOrbPayload } {
  const { diagnostics, frames, referenceFrameMeta, setupHash } = args;
  return {
    pose: { setupHash, diagnostics, frames },
    orb: {
      setupHash,
      appVersion: diagnostics.appVersion,
      referenceFrameMeta,
      summary: diagnostics.result.orb,
    },
  };
}

/**
 * Post one Analyze run to the downloader through the dev relay, which forwards
 * it server-to-server so the page never crosses an origin boundary. Resolves
 * with the run identifier the downloader assigned, when it reports one.
 */
export async function postDetectionRun(args: {
  videoPath: string;
  pose: HarnessPosePayload;
  orb: HarnessOrbPayload;
}): Promise<{ runId: string | null }> {
  const res = await fetch("/api/dev/detections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_path: args.videoPath, pose: args.pose, orb: args.orb }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // The relay passes the downloader's body through verbatim, so a non-JSON
    // body is possible; the status still decides success.
  }
  if (!res.ok) {
    const error = typeof body.error === "string" ? body.error : null;
    throw new Error(error ?? `Failed to post the detection run (${res.status}).`);
  }
  return { runId: typeof body.run_id === "string" ? body.run_id : null };
}
