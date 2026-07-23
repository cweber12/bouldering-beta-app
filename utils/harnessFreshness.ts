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
