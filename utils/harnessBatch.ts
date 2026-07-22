/**
 * Batch Analyze planning — which corpus Test Videos a sweep runs and which it
 * skips (calibration-analyze-split issue 05, amended by the calibration
 * freshness contract — ADR 0020).
 *
 * The gate keys on Ground Truth that is both accepted and **fresh**: truth
 * stamping an older calibration's setupHash pairs with no run scanned under
 * the current Setup, so sweeping it would only mint unpaired evidence the
 * harness skips. A truth-bearing bundle without a Scan Setup cannot replay a
 * run at all, so it is skipped under its own count rather than left to fail
 * mid-sweep; all skip counts are surfaced so an under-calibrated or stale
 * corpus is visible instead of silently thin.
 *
 * Framework-agnostic — no React imports.
 */

/** The per-video flags the plan gates on (a subset of the corpus listing). */
export interface BatchAnalyzeCandidate {
  hasSetup: boolean;
  hasGroundTruth: boolean;
  /** Truth stamps an older calibration's setupHash (utils/harnessFreshness). */
  truthStale: boolean;
  /** Detection runs already pairing with the truth (utils/harnessFreshness). */
  pairedRunCount: number;
}

/**
 * The sweep scope. "all" re-scores every fresh-truth bundle — the shape of a
 * pipeline-change re-run. "un-analyzed" narrows to bundles with no paired run
 * yet, so filling in never-analyzed videos skips ones already covered.
 */
export type BatchAnalyzeMode = "all" | "un-analyzed";

/** The sweep plan: what runs, what is skipped, and why. */
export interface BatchAnalyzePlan<T extends BatchAnalyzeCandidate> {
  /** Videos the sweep will Analyze, in corpus-list order. */
  queue: T[];
  /** Videos without accepted Ground Truth — the gate. */
  skippedNoTruth: number;
  /** Videos whose truth is stale — re-seed and re-accept before sweeping. */
  skippedStaleTruth: number;
  /** Truth-bearing videos with no Scan Setup to replay (pathological). */
  skippedNoSetup: number;
  /**
   * Fresh-truth, set-up videos excluded only because they already hold a paired
   * run — skipped by "un-analyzed" scope, never by "all" (always 0 there).
   */
  skippedAnalyzed: number;
  /** Every candidate considered: queue + all skip counts. */
  total: number;
}

/**
 * Plan a batch Analyze sweep over the corpus listing. The gate keys on
 * fresh, accepted Ground Truth and a replayable Scan Setup; "un-analyzed" scope
 * additionally drops bundles that already hold a paired run.
 */
export function planBatchAnalyze<T extends BatchAnalyzeCandidate>(
  items: readonly T[],
  mode: BatchAnalyzeMode = "all",
): BatchAnalyzePlan<T> {
  const queue: T[] = [];
  let skippedNoTruth = 0;
  let skippedStaleTruth = 0;
  let skippedNoSetup = 0;
  let skippedAnalyzed = 0;
  for (const item of items) {
    if (!item.hasGroundTruth) skippedNoTruth += 1;
    else if (item.truthStale) skippedStaleTruth += 1;
    else if (!item.hasSetup) skippedNoSetup += 1;
    else if (mode === "un-analyzed" && item.pairedRunCount > 0) skippedAnalyzed += 1;
    else queue.push(item);
  }
  return {
    queue,
    skippedNoTruth,
    skippedStaleTruth,
    skippedNoSetup,
    skippedAnalyzed,
    total: items.length,
  };
}
