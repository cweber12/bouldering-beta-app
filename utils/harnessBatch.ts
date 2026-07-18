/**
 * Batch Analyze planning — which corpus Test Videos a sweep runs and which it
 * skips (calibration-analyze-split issue 05, amending the old batch-GT-gate).
 *
 * The gate keys on accepted Ground Truth existing, nothing else: no run-count,
 * staleness, or hash checks — stamp comparison at analysis time is what tells
 * runs apart (ADR 0018). A truth-bearing bundle without a Scan Setup cannot
 * replay a run at all, so it is skipped under its own count rather than left to
 * fail mid-sweep; both skip counts are surfaced so an under-calibrated corpus
 * is visible instead of silently thin.
 *
 * Framework-agnostic — no React imports.
 */

/** The per-video flags the plan gates on (a subset of the corpus listing). */
export interface BatchAnalyzeCandidate {
  hasSetup: boolean;
  hasGroundTruth: boolean;
}

/** The sweep plan: what runs, what is skipped, and why. */
export interface BatchAnalyzePlan<T extends BatchAnalyzeCandidate> {
  /** Videos the sweep will Analyze, in corpus-list order. */
  queue: T[];
  /** Videos without accepted Ground Truth — the gate. */
  skippedNoTruth: number;
  /** Truth-bearing videos with no Scan Setup to replay (pathological). */
  skippedNoSetup: number;
  /** Every candidate considered: queue + both skip counts. */
  total: number;
}

/** Plan a batch Analyze sweep over the corpus listing. */
export function planBatchAnalyze<T extends BatchAnalyzeCandidate>(
  items: readonly T[],
): BatchAnalyzePlan<T> {
  const queue: T[] = [];
  let skippedNoTruth = 0;
  let skippedNoSetup = 0;
  for (const item of items) {
    if (!item.hasGroundTruth) skippedNoTruth += 1;
    else if (!item.hasSetup) skippedNoSetup += 1;
    else queue.push(item);
  }
  return { queue, skippedNoTruth, skippedNoSetup, total: items.length };
}
