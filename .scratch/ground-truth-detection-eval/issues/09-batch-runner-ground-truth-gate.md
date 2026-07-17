# Batch Runner Ground-Truth Gate

Status: wontfix
Superseded-by: .scratch/calibration-analyze-split/issues/05-batch-analyze-gt-gate.md
Type: AFK

> 2026-07-17 (tracker audit): superseded, not rejected. The batch sweep is now
> the Analyze batch gated on accepted Ground Truth — implement from
> calibration-analyze-split issue 05, not this file.

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`

## What to build

Extend the ADR 0017 batch runner (`harness:batch`, Playwright) to drive the headless scoring pass: skip any Test Video without a `ground-truth.json` (on top of the existing skip-without-`setup.json`), load GT, run detection with the frozen setup, score in-browser (issue 08), and post the run. The batch page's machine-readable progress/done contract is preserved.

## Acceptance criteria

- [ ] `harness:batch` skips videos lacking `ground-truth.json` and logs them as skipped.
- [ ] For calibrated videos it runs detection, scores against GT, and posts one run each, unattended.
- [ ] The batch-mode completion signal still works for the driver.
- [ ] No human interaction required end-to-end.

## Blocked by

- `.scratch/ground-truth-detection-eval/issues/08-headless-scoring-pass.md`
