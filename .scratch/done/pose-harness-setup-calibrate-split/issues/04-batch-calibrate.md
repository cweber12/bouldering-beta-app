# Batch Calibrate sweep for setup-but-truthless bundles

Status: done
Branch: feat/harness-batch-calibrate
Merged: cffb4c9
Type: AFK

## Parent

- `.scratch/done/pose-harness-setup-calibrate-split/PRD.md`

## What to build

Add a Batch Calibrate sweep that submits ViTPose jobs for every bundle that has a Setup
but no Ground Truth yet, so the slow GPU waits run in the background instead of blocking
per video. Generalize `planReseedSweep` (`utils/harnessReseed.ts`) — or add a sibling
`planBatchCalibrate` reusing `decideReseedStep` and the `ReseedSweeper` component: the
job queue is `hasSetup && !hasGroundTruth && !seedReady`; `!hasGroundTruth && seedReady`
bundles are review-ready (no job needed). A header **Batch Calibrate (N)** button beside
Re-seed stale / Batch Analyze drives the shared sweeper, frozen at click like the
others. No auto-accept — bundles land `seed ready` and the human accepts each via the
fast Review-seed path.

## Acceptance criteria

- [x] The sweep queues exactly `hasSetup && !hasGroundTruth && !seedReady` bundles;
      already-seed-ready truthless bundles are surfaced as review-ready, not re-jobbed.
- [x] Each queued bundle submits one ViTPose job and lands a fresh scaffold (flips to
      `truth: seed ready`); no Ground Truth is auto-accepted.
- [x] The Batch Calibrate button shows a live count and its plan is frozen at click.
- [x] Type-check, lint, and targeted tests pass
      (`__tests__/utils/harnessReseed.test.ts` or a new batch-calibrate plan test).

## Blocked by

- `.scratch/done/pose-harness-setup-calibrate-split/issues/03-setup-calibrate-analyze-flow-split.md`
