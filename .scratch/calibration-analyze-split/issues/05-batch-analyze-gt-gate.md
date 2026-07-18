# Batch Analyze gated on accepted Ground Truth

Status: done
Branch: feat/batch-analyze-gt-gate
Merged: 56d690f
Type: AFK

## Parent

- `.scratch/calibration-analyze-split/PRD.md`

## What to build

The harness batch runner sweeps every corpus Test Video that has accepted Ground Truth, running the full Analyze action (production scan + scoring + append-only post) on each, and skips videos without accepted truth — surfacing skipped counts so an under-calibrated corpus is visible. This is the amended shape of the old batch-GT-gate issue (issue 09 in ground-truth-detection-eval): the gate keys on accepted truth existing, nothing else. One batch after a pipeline change re-scores the whole corpus.

## Acceptance criteria

- [x] Batch runs Analyze over exactly the accepted-GT subset of the corpus; others are skipped with a visible count.
- [x] Each batch entry posts the same stamped, scored, append-only run a manual Analyze would (guaranteed structurally: both drive the shared useAnalyzeRun lifecycle).
- [x] A batch re-run appends new runs rather than overwriting prior ones.
- [x] Type-check, lint, and targeted tests pass.

## Blocked by

- `.scratch/calibration-analyze-split/issues/04-scoring-vs-ground-truth.md`
