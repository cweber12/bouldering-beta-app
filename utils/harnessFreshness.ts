/**
 * Calibration freshness — the hash-chain predicates that decide whether saved
 * Ground Truth and posted detection runs are still valid evidence under the
 * current Scan Setup.
 *
 * The analysis harness pairs a run with a video's Ground Truth **iff** the
 * run's stamped `setupHash` equals the truth's self-reported `setupHash`
 * (harness ADR 0004; legacy truths without one fall back to the bundle's
 * current `setup.json`). An "accepted" annotation is therefore only valid
 * evidence while its stamped hash equals the calibration runs are scanned
 * under — these helpers are the scanner-side mirror of that contract, shared
 * by the corpus listing (server), the calibration page, and Analyze (client).
 *
 * Staleness has **two axes**, because two different things a truth was authored
 * against can move underneath it: the calibration ({@link truthIsStale}, keyed
 * on `setupHash`) and the ViTPose scaffold ({@link truthScaffoldIsStale}, keyed
 * on the ADR 0007 `seedHash`). A re-seed moves the second while leaving the
 * first untouched, so neither predicate subsumes the other. Every predicate here
 * fails **open** on a missing stamp: unknown provenance is never a failure.
 *
 * Framework-agnostic — no React imports.
 */

import { scaffoldHasPose, type ViTPoseScaffold } from "@/utils/harnessViTPose";

/**
 * The hash a run must stamp to pair with the bundle's Ground Truth: the
 * truth's own `setupHash`, or — for legacy truth files that never stamped one
 * — the bundle's current `setup.json` hash. Empty when neither exists.
 */
export function effectiveTruthHash(
  truthSetupHash: string | null | undefined,
  setupHash: string | null | undefined,
): string {
  return truthSetupHash || setupHash || "";
}

/**
 * True when saved Ground Truth no longer pairs with the current Scan Setup:
 * the truth stamps a hash and the current `setup.json` stamps a different
 * one. Legacy truth without a stamped hash falls back to the current setup
 * (never stale), matching the harness's evaluate pairing rule.
 */
export function truthIsStale(
  truthSetupHash: string | null | undefined,
  setupHash: string | null | undefined,
): boolean {
  return !!truthSetupHash && !!setupHash && truthSetupHash !== setupHash;
}

/**
 * True when saved Ground Truth was authored from a **superseded ViTPose
 * scaffold**: the truth stamps a `scaffoldSeedHash` and the scaffold on disk
 * stamps a different `seedHash` (harness ADR 0007, their issue #119).
 *
 * The scaffold axis of staleness, and the one {@link truthIsStale} structurally
 * cannot see: `setupHash` tracks the *calibration*, and re-seeding does not
 * change the calibration, so truth authored from a two-week-old scaffold still
 * matches. Every frame the new scaffold poses that the old truth calls absent
 * then lands in the truth-absent population and is scored as a scanner
 * hallucination.
 *
 * Fails open on either side, matching {@link truthIsStale} and
 * {@link scaffoldIsStale}: truth written before the stamp existed, or authored
 * from a pre-ADR 0007 scaffold, has *unknown* provenance — never stale.
 */
export function truthScaffoldIsStale(
  truthScaffoldSeedHash: string | null | undefined,
  scaffoldSeedHash: string | null | undefined,
): boolean {
  return (
    !!truthScaffoldSeedHash && !!scaffoldSeedHash && truthScaffoldSeedHash !== scaffoldSeedHash
  );
}

/** Which axis an accepted Ground Truth has gone stale on, if any. */
export type TruthStaleAxis = "none" | "calibration" | "scaffold";

/**
 * The composite staleness verdict for accepted Ground Truth, across both axes —
 * shared by the corpus listing (which needs only the boolean) and the
 * Calibrator (which words its banner from the axis). Callers gate on the truth
 * actually being accepted; this only compares stamps.
 *
 * `calibration` wins when both have moved: re-calibrating is the larger remedy
 * and subsumes the re-seed, so naming the scaffold there would send the operator
 * after the smaller of two problems.
 */
export function truthStaleAxis(stamps: {
  /** `setupHash` the truth stamps. */
  truthSetupHash?: string | null;
  /** `setupHash` the bundle's current `setup.json` stamps. */
  setupHash?: string | null;
  /** `scaffoldSeedHash` the truth stamps. */
  truthScaffoldSeedHash?: string | null;
  /** `seedHash` of the ViTPose scaffold now in hand. */
  scaffoldSeedHash?: string | null;
}): TruthStaleAxis {
  if (truthIsStale(stamps.truthSetupHash, stamps.setupHash)) return "calibration";
  if (truthScaffoldIsStale(stamps.truthScaffoldSeedHash, stamps.scaffoldSeedHash)) {
    return "scaffold";
  }
  return "none";
}

/**
 * True when a ViTPose scaffold was generated under a different calibration
 * than the current `setup.json` — seeding Ground Truth from it would stamp a
 * hash no future run can pair with (the export race, harness issue #21).
 * Legacy scaffolds without a stamped hash are trusted against the current
 * setup, matching {@link truthIsStale}.
 */
export function scaffoldIsStale(
  scaffoldSetupHash: string | null | undefined,
  setupHash: string | null | undefined,
): boolean {
  return !!scaffoldSetupHash && !!setupHash && scaffoldSetupHash !== setupHash;
}

/**
 * True when a bundle's ViTPose scaffold can seed Ground Truth review right
 * now, with no new job: the scaffold exists, stamps the current `setup.json`
 * hash (legacy unstamped scaffolds qualify via the {@link scaffoldIsStale}
 * fallback), and poses at least one Detection Frame. A scaffold that tracked
 * no Climber is never seed-ready — authoring would refuse it anyway. Shared
 * definition for the corpus lister's badge, the re-seed sweep's queue
 * (stale-truth bundles that are *not* seed-ready), and the calibrator's
 * smart-button affordance.
 */
export function scaffoldIsSeedReady(
  scaffold: ViTPoseScaffold | null | undefined,
  setupHash: string | null | undefined,
): boolean {
  return !!scaffold && !scaffoldIsStale(scaffold.setupHash, setupHash) && scaffoldHasPose(scaffold);
}

/**
 * True when a bundle's ViTPose scaffold marks it **Untrackable**: the scaffold
 * exists, belongs to the *current* calibration (not stale — legacy unstamped
 * scaffolds qualify via the {@link scaffoldIsStale} fallback), and poses **no**
 * Detection Frame. That is the deterministic "the tracker matched no Climber to
 * this seed" outcome — re-running the same seed fails identically, so the batch
 * calibration and re-seed sweeps hold such a bundle out until a re-seed lands
 * landmarks. The exact poseless complement of {@link scaffoldIsSeedReady} among
 * current scaffolds.
 *
 * A *stale* poseless scaffold is **not** Untrackable: the scan-affecting inputs
 * changed since it was posed, so the failure may not recur — it is the ordinary
 * "re-run ViTPose" case. Only the poseless-artifact signal marks Untrackable; a
 * bare job-error sidecar (job died with no artifact) stays retryable, and a
 * silent timeout leaves no disk trace to derive from at all.
 */
export function scaffoldIsUntrackable(
  scaffold: ViTPoseScaffold | null | undefined,
  setupHash: string | null | undefined,
): boolean {
  return (
    !!scaffold && !scaffoldIsStale(scaffold.setupHash, setupHash) && !scaffoldHasPose(scaffold)
  );
}

/**
 * True when a detection run's stamped hash pairs with the bundle's Ground
 * Truth — i.e. the run produces evaluation evidence. Only meaningful when the
 * bundle has truth at all; a truthless bundle is its own (already-surfaced)
 * state. Missing stamps compare as empty strings so degenerate legacy bundles
 * (no hashes anywhere) read as paired rather than alarming.
 */
export function runPairsWithTruth(
  runSetupHash: string | null | undefined,
  truthSetupHash: string | null | undefined,
  setupHash: string | null | undefined,
): boolean {
  return (runSetupHash || "") === effectiveTruthHash(truthSetupHash, setupHash);
}
