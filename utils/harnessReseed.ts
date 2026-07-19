/**
 * Re-seed stale sweep planning — which stale-truth bundles a corpus-page sweep
 * submits ViTPose jobs for, and how one submitted job's poll results resolve
 * (batch re-seed PRD issue 03, Batch Analyze split precedent).
 *
 * The queue is the ViTPose backlog: bundles whose accepted Ground Truth is
 * stale (it stamps an older calibration's setupHash — ADR 0020) and whose
 * scaffold is **not** seed-ready, because a seed-ready bundle already holds a
 * fresh posed scaffold and only needs the calibrator's review, never a new
 * multi-minute GPU job. Truthless bundles are excluded outright: first-time
 * authoring stays a deliberate act, and the known ViTPose-can't-track bundle
 * must not burn a poll timeout every sweep.
 *
 * Framework-agnostic — no React imports.
 */

import { scaffoldHasPose, type ViTPoseScaffold } from "@/utils/harnessViTPose";

/** The per-bundle flags the sweep plan gates on (a subset of the corpus listing). */
export interface ReseedCandidate {
  hasSetup: boolean;
  hasGroundTruth: boolean;
  /** Truth stamps an older calibration's setupHash (utils/harnessFreshness). */
  truthStale: boolean;
  /** A fresh, posed ViTPose scaffold is already on disk (utils/harnessFreshness). */
  seedReady: boolean;
}

/** The sweep plan: which bundles get a job, and why the rest do not. */
export interface ReseedPlan<T extends ReseedCandidate> {
  /** Stale-truth bundles needing a ViTPose job, in corpus-list order. */
  queue: T[];
  /** Stale-truth bundles whose scaffold is already seed-ready — review, no job. */
  seedReady: number;
  /** Stale-truth bundles with no Scan Setup to build a job request from
   * (pathological — a stale hash comparison implies a saved Setup). */
  skippedNoSetup: number;
  /** Every stale-truth bundle: queue + seedReady + skippedNoSetup. */
  staleTotal: number;
  /** Every candidate considered, including fresh-truth and truthless bundles. */
  total: number;
}

/** Plan a re-seed sweep over the corpus listing. */
export function planReseedSweep<T extends ReseedCandidate>(
  items: readonly T[],
): ReseedPlan<T> {
  const queue: T[] = [];
  let seedReady = 0;
  let skippedNoSetup = 0;
  let staleTotal = 0;
  for (const item of items) {
    if (!item.hasGroundTruth || !item.truthStale) continue;
    staleTotal += 1;
    if (item.seedReady) seedReady += 1;
    else if (!item.hasSetup) skippedNoSetup += 1;
    else queue.push(item);
  }
  return { queue, seedReady, skippedNoSetup, staleTotal, total: items.length };
}

// ---------------------------------------------------------------------------
// Per-job step decision — one poll of the bundle resolved to land / fail /
// keep polling. Mirrors the calibrator's poll loop terminal conditions so a
// sweep job and a manual re-seed classify identically.
// ---------------------------------------------------------------------------

/** Why a submitted job is marked failed. No automatic retries — the
 * individual retry lives in the calibrator. */
export type ReseedFailure = "no-climber" | "error-sidecar" | "timeout";

/** What one poll of a submitted job resolves to. Terminal decisions (landed
 * and failed alike) advance the sweep to the next bundle. */
export type ReseedStepDecision =
  | { kind: "landed"; advance: true }
  | { kind: "failed"; failure: ReseedFailure; message: string; advance: true }
  | { kind: "poll"; advance: false };

/**
 * Resolve one poll of a submitted ViTPose job. A landed scaffold that posed no
 * Detection Frame is a tracker miss, not a seed — it fails rather than landing,
 * so the badge never invites a review that authoring would refuse. An error
 * sidecar is terminal (no artifact will ever land), and `timedOut` is the
 * caller's backstop clock for a downloader that died without writing one.
 */
export function decideReseedStep(
  poll: { scaffold: ViTPoseScaffold | null; error: string | null },
  timedOut: boolean,
): ReseedStepDecision {
  if (poll.scaffold) {
    if (!scaffoldHasPose(poll.scaffold)) {
      return {
        kind: "failed",
        failure: "no-climber",
        message: "ViTPose tracked no climber.",
        advance: true,
      };
    }
    return { kind: "landed", advance: true };
  }
  if (poll.error) {
    return { kind: "failed", failure: "error-sidecar", message: poll.error, advance: true };
  }
  if (timedOut) {
    return {
      kind: "failed",
      failure: "timeout",
      message: "The ViTPose job timed out.",
      advance: true,
    };
  }
  return { kind: "poll", advance: false };
}
