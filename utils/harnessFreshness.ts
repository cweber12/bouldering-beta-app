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
