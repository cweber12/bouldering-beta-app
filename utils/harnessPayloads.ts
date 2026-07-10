/**
 * Harness detection-run payloads.
 *
 * Shapes the `pose` and `orb` bodies pushed to the downloader's POST
 * /api/detections for one Test Video run (see docs/adr/0017). Both reuse the
 * self-contained ScanDiagnostics record — no new metrics — and carry the
 * `setupHash` that ties the run to the Scan Setup it replayed. Attribution
 * (appVersion, resolved config) already lives inside ScanDiagnostics.
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
