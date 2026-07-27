/**
 * Client-side view of one Test Video bundle, mirroring the /api/dev/corpus
 * response shape (see the server-side `CorpusItem` in `app/api/dev/shared.ts`).
 *
 * Framework-agnostic — no React imports. Shared by the harness page and the
 * per-video act components (SetupEditor, Calibrator, Analyzer) so the three acts
 * agree on the corpus row shape without importing the server module.
 */

/** One Test Video bundle as consumed by the dev harness UI. */
export interface CorpusItem {
  key: string;
  routeFolder: string;
  videoKey: string;
  title: string | null;
  videoPath: string;
  hasSetup: boolean;
  hasGroundTruth: boolean;
  /** Truth exists but stamps an older calibration's hash — stale evidence. */
  truthStale: boolean;
  /** A fresh, posed ViTPose scaffold is on disk — review needs no new job. */
  seedReady: boolean;
  /**
   * Untrackable: the current-calibration ViTPose scaffold posed no Detection
   * Frame and the bundle has no fresh truth, so the tracker matched no Climber
   * to this seed. Held out of the batch calibration and re-seed sweeps until a
   * re-seed lands landmarks (utils/harnessFreshness, scoped in app/api/dev/shared).
   */
  untrackable: boolean;
  /** The climb start: the *setup* tap's `t`, when the Setup carries one. */
  climbStart?: number;
  /** The end-of-climb marker; absent means the window is open on that side. */
  climbEnd?: number;
  runCount: number;
  /** Runs whose stamped hash pairs with the truth — real evidence; 0 ⇒ un-analyzed. */
  pairedRunCount: number;
  /** Runs whose stamped hash pairs with no truth — they produce no evidence. */
  unpairedRunCount: number;
  analysisInputs: unknown;
}

/** Which act the corpus list opened a video for — the three are kept separate. */
export type HarnessMode = "setup" | "calibrate" | "analyze";
