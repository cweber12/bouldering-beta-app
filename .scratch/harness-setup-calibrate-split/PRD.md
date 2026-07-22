# Harness Setup / Calibrate split: off-hash seed tap, batch calibrate, targeted batch analyze

Status: ready-for-agent

Spec inputs: `docs/adr/0020-calibration-freshness-hash-chain.md` (the setupHash pairing
contract this feature refines to "analysis inputs only"); `docs/adr/0019-vitpose-ground-truth-scaffold.md`
(the ViTPose seed contract this feature changes to `seedTap` + `seedRegion`);
`.scratch/calibration-analyze-split/PRD.md` (established the three-artifact model and the
Analyze step); `.scratch/batch-reseed-stale-truth/` (the ReseedSweeper pattern this
feature generalizes for first-time calibration). Design record:
`.claude/plans/i-want-to-starry-bubble.md`.
Glossary: CONTEXT.md — **Scan Setup**, **Climber tap**, **Climber Crop**, **Wall Crop**,
**Ground Truth**, **Detection Frame**, **Detection Error**. This feature adds **Seed tap**.

## Problem Statement

The dev detection-eval harness makes bulk calibration slow and makes re-calibration
destructive to the very thing it evaluates. Three frictions:

1. **The single Climber tap is overloaded and it is baked into `setupHash`.**
   `setup.climberPoint` serves both MediaPipe (person disambiguation + first Adaptive
   Crop seed, in Analyze) and the downloader's ByteTrack/ViTPose seed (in Calibrate).
   The ideal MediaPipe tap (early, inside the Climber Crop) and the ideal ViTPose seed
   (a later, unambiguous frame the tracker can track backward from) are different taps
   forced to be one. Because the tap is part of `canonicalSetupInput`
   (`utils/harnessSetup.ts`), re-tapping to improve the ViTPose seed changes the hash,
   so every prior run flips to *unpaired* (`runPairsWithTruth`, ADR 0020) and must be
   re-analyzed. Re-calibration corrupts analysis pairing it should never touch.

2. **First-time calibration is one-at-a-time and blocking.** The multi-minute ViTPose
   GPU job runs interactively per bundle. `ReseedSweeper` batches *stale-truth* bundles
   but deliberately excludes truthless ones, so a fresh corpus is calibrated by hand,
   video by video.

3. **Batch Analyze is all-or-nothing.** `planBatchAnalyze` sweeps every fresh-truth
   bundle, redundantly re-analyzing ones that already have a good paired run.

> Corrected assumption from the design session: calibration no longer runs MediaPipe at
> all (ADR 0019 removed the throwaway pass). ViTPose is the sole GT author; MediaPipe
> runs only in Analyze. The "tap a later frame backfills earlier frames" intuition is
> real, but it is the downloader's ByteTrack tracker seeded at time `t` tracking
> backward — a ViTPose-flow behaviour, not a MediaPipe one.

## Solution

Split the overloaded tap and redefine `setupHash` as "analysis inputs only." A new
off-hash **Seed tap** (`seedTap {x,y,t}`) feeds only the ViTPose job; the in-hash
`climberPoint` stays the MediaPipe analysis tap. Re-tapping the seed re-seeds ViTPose
and re-authors Ground Truth without changing the hash, so prior runs stay paired —
re-calibration stops corrupting analysis. The ViTPose request stops gating the seed
against the Climber Crop and instead sends a `seedRegion` box derived from the seed tap
(a documented downloader handoff, same pattern as ADR 0020).

The calibrator page splits into three acts: **Setup** (crops + analysis tap + wall +
tier + metadata → `setup.json`), **Calibrate** (a seed-tap-only view that runs ViTPose
+ flag review; first-time pre-fills the seed tap from the analysis tap; re-calibrate
re-opens the same view), and **Analyze** (unchanged). Bulk work gets two additions: a
**Batch Calibrate** sweep that submits ViTPose jobs for setup-but-truthless bundles so
they land `seed ready` for fast per-bundle review (generalizing the reseed sweeper, no
auto-accept), and a **Batch Analyze** All / Un-analyzed toggle where "Un-analyzed"
targets only fresh-truth bundles with zero paired runs.

## User Stories

1. As a calibration author, I want the Climber tap I set in Setup to feed MediaPipe
   analysis, and a separate Seed tap to feed the ViTPose job, so the two detectors get
   the tap each needs instead of one compromise tap.
2. As a calibration author, I want the Seed tap excluded from `setupHash`, so improving
   the ViTPose seed never flips my prior runs to unpaired.
3. As a calibration author, I want re-calibration to be a seed-tap-only view (scrub +
   tap, no crop editing), so I can grab the climber in a clearer later frame without
   touching crops, wall, tier, or metadata.
4. As a calibration author, I want first-time Calibrate to pre-fill the Seed tap from my
   Setup tap, so the common case needs no second tap.
5. As a calibration author, I want the ViTPose job seeded by a `seedRegion` around the
   Seed tap rather than gated by the Climber Crop, so I can seed from anywhere the
   climber is clearest without redrawing the crop.
6. As a calibration author, I want the legacy-tap and out-of-region warnings re-pointed
   at the Seed tap, so Climber-identity hazards stay visible in the new flow.
7. As a harness user, I want a Setup action that saves crops/tap/wall/tier + metadata
   without seeding, so I can rapidly set up many bundles first.
8. As a harness user, I want the Setup save affordance emphasized while the setup is
   dirty, so the quick-setup path is obvious.
9. As a harness user, I want a Batch Calibrate sweep that submits ViTPose jobs for every
   setup-but-truthless bundle, so the slow GPU waits happen in the background instead of
   blocking me per video.
10. As a harness user, I want Batch Calibrate to land bundles `seed ready` and leave
    accept to me, so no unreviewed seed is ever accepted as truth.
11. As a harness user, I want a Batch Analyze toggle between All and Un-analyzed, so I
    can re-score everything after a pipeline change or only fill in bundles that have
    never been analyzed under the current setup.
12. As a harness user, I want the corpus list to surface a paired-run count, so
    Un-analyzed's gate (`pairedRunCount === 0`) is visible and auditable.
13. As a developer, I want `seedTap` persisted in `setup.json` but excluded from
    `canonicalSetupInput`, so a Seed-tap edit re-derives an identical `setupHash` (pinned
    by a regression test), exactly as `analysisInputs` is today.
14. As a developer, I want a seed-tap-only merging PUT that preserves crops + hash
    byte-for-byte, so persisting a Seed tap never rewrites the analysis inputs.
15. As a developer, I want the `seedRegion` contract change specified in a handoff doc /
    ADR in the established format, so the downloader work is executable without this
    conversation.
16. As a developer, I want the batch-calibrate queue derived from corpus flags
    (`hasSetup && !hasGroundTruth && !seedReady`), so no new stored candidate state is
    introduced.

## Implementation Decisions

- **`setupHash` = analysis inputs only.** `canonicalSetupInput` is unchanged in shape
  (`climberCrop`, `wallCrop`, `climberPoint`, `panning`, `qualityTier`). `seedTap?:
  ClimberPoint` is added to `ScanSetup` (persisted) but never to `ScanSetupInput` — it
  is excluded from the hash exactly as `analysisInputs` is. A regression test pins that
  a changed `seedTap` produces an identical hash.
- **Seed-tap-only PUT.** `app/api/dev/corpus/setup/route.ts` gains a third body kind
  (alongside scan-input and labels-only): a `seedTap`-only write preserving crops +
  `setupHash`. New `bodyHasSeedTap()` + validation reuse `isPoint`. Client seam
  `saveSeedTap(bundleKey, seedTap)` next to `saveSetupLabels`.
- **ViTPose request.** `ViTPoseRequest` (`utils/harnessViTPose.ts`) replaces the
  `climberPoint` seed field with `seedTap` and adds `seedRegion: CropFraction` (a box
  around the seed tap, clamped to frame). The Climber Crop is no longer the seed gate.
  `requestViTPoseForGrid` builds `seedRegion`. `tapOutsideSeedGate`
  (`utils/cropContainment.ts`) is re-pointed at `seedRegion` (a frame-bounds check) or
  retired; `legacyTapNoTimestamp` moves to the seed-tap context.
- **Downloader handoff.** A new ADR (or `.scratch` handoff doc in the downloader-contract
  format) specifies the request change: seed is `seedTap` + `seedRegion`, no Climber-Crop
  gate. `vitpose_job` echo-and-match and polling are otherwise unchanged.
- **Three acts.** Corpus row actions become `[Setup] [Calibrate/Re-calibrate]
  [Analyze]`; `Selection` gains `"setup"` mode; Calibrate enables once `hasSetup`.
  Today's `Calibrator` splits into a `SetupEditor` (StepSetDetection + metadata modal,
  confirm = `saveSetup()` only, dirty-highlight the save) and a seed-tap-only
  `Calibrator` (scrub + single tap seeded from `climberPoint`/saved `seedTap`, confirm =
  persist `seedTap` off-hash + `saveAndSeed` + GT review). The GT review phase and
  ViTPose poll/seed/carry-forward machinery move across unchanged, including `Review
  seed` / `Re-run ViTPose`.
- **Batch Calibrate.** Generalize `planReseedSweep` (or a sibling `planBatchCalibrate`
  reusing `decideReseedStep`): queue = `hasSetup && !hasGroundTruth && !seedReady`;
  `!hasGroundTruth && seedReady` → review-ready, no job. A header **Batch Calibrate (N)**
  button, frozen at click like the others, drives the shared sweeper component. No
  auto-accept — human review stays per-bundle.
- **Batch Analyze toggle.** `countRuns`/`listCorpus` (`app/api/dev/shared.ts`) surface
  `pairedRunCount` (runs passing `runPairsWithTruth`); added to server + client
  `CorpusItem`. `planBatchAnalyze` gains `mode: "all" | "un-analyzed"`; "un-analyzed"
  adds `pairedRunCount === 0` to the fresh-truth + hasSetup gate. Header control becomes
  a segmented `All (N) / Un-analyzed (M)`.
- **Re-scored runs after a Seed-tap re-tap.** Because `seedTap` is off-hash, a re-seed +
  re-accept overwrites GT landmarks while keeping the same hash, so prior runs stay
  paired but their stored scores are against the old seed. Refresh by re-running Batch
  Analyze in **All** mode (Un-analyzed skips them). Acceptable for a dev harness; noted
  in the ADR.

## Testing Decisions

Tests exercise external behavior at module and route seams — hashes, parsed bodies,
plan queues, listing counts — never page state (the flow-split page stays untested per
the flag-review precedent; its decision logic lives in framework-agnostic utils).

- **`harnessSetup` + `setupRoute`**: a changed `seedTap` yields an identical `setupHash`;
  a `seedTap`-only PUT preserves crops + hash; `bodyHasSeedTap` classification.
- **`harnessViTPose`**: request carries `seedTap` + `seedRegion`; `seedRegion` derivation
  from the tap and frame clamping.
- **`harnessBatch`**: `planBatchAnalyze` "all" vs "un-analyzed" gate on `pairedRunCount`.
- **`harnessReseed` / batch-calibrate plan**: truthless queue and seed-ready split.
- **`listCorpus`**: `pairedRunCount` computed from `runPairsWithTruth`.

## Out of Scope

- **Downloader implementation** of `seedRegion` — specified here as a handoff; the
  scanner side ships independently and full seed/crop independence lands when the
  downloader honors it.
- **Auto-accepting ViTPose seeds as Ground Truth** — explicitly rejected; human flag
  review stays in the loop.
- **Scoring semantics** — ladder, thresholds, rollup shape all stand (ADR 0018 / the
  calibration-analyze-split scoring issue); only frame *pairing* inputs move.
- **Migration of stored `setup.json` / `ground-truth.json`** — none needed; `seedTap` is
  additive and absent means "use `climberPoint`."

## Further Notes

- This refines rather than reverses ADR 0020: the hash-chain pairing contract stays, but
  `setupHash` now correctly excludes an input (the seed tap) that never affects the run
  being paired. Analysis inputs still fully determine the hash.
- The `.scratch/calibration-analyze-split/issues/06` video-identity direction stays
  wontfix — this feature keeps hash-chained pairing and instead narrows what the hash
  covers.
