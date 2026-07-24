# 03 — Validation pass: recalibrate multi-person videos, measure residual error

Status: done
Branch: main
Merged: 0f304cf

## Context

Phase B (candidates + swap UI) is sized by how often the selector is *still*
wrong. This is a human calibration session, not code.

> Re-scoped 2026-07-17: this session now validates the **appearance-anchored
> stitcher** (downloader issue #19 — color signatures, scored association,
> wrong-person detector with backtrack recovery), not bare Phase A. The
> downloader's own regression fixtures and 39-bundle batch validation suggest
> the residual wrong-person rate is far lower than the Phase A gate assumed;
> this session confirms or refutes that on the scanner's own corpus.

## Scope

- Recalibrate every corpus Test Video known to have bystanders (spotters,
  belayers, passersby).
  - Note (2026-07-16): once `.scratch/done/pose-calibration-analyze-split/issues/02` lands,
    "recalibrate" means the explicit **re-seed** action — setup edits alone no
    longer re-run ViTPose on a video with accepted Ground Truth. If the split's
    issue 01 lands first, the review steps the denser uniform 100 ms grid
    (~300 frames per 30 s) — more stepping, denser evidence for sizing Phase B.
- For each, step the filmstrip and record per video: seed correct end-to-end /
  wrong from frame 0 / hijacked mid-clip (and roughly how many Detection Frames
  were wrong).
- For each run, read the status sidecar's `seedDebug.stitch` object:
  - `reseeds` entries with `restored: 0` are auto-corrected wrong-person
    events — count them per video (`discarded`/`recovered` give the frame
    magnitude); `restored > 0` means the alarm was ruled false and undone.
  - `jumps` should be empty on healthy runs — investigate any entry.
  - `stitchedFrames` (against the history length) gives coverage.
- Honest-absence check: the new stitcher leaves undetected-climber frames
  `keypoints: []` far more often than adopting a bystander — confirm the
  authoring UI handles longer absent stretches gracefully.
- Append the tally as a comment on this issue.

## Exit

- Residual wrong-person rate is ~zero (expected, given the downloader's batch
  validation) → consider trimming Phase B to a minimal per-frame swap (or
  deferring it) before triaging issues 04–06.
- Residual errors persist → move issues 04–06 to `ready-for-agent`; note they
  now target the residual only (similarly-dressed climbers, appearance-blind
  footage), so size them as an escape hatch, not a routine correction tool.

## Comments

> 2026-07-17 — Validation session complete (human calibration session, no code
> branch — closed on `main`). All batches were re-tested against the
> appearance-anchored stitcher; the **residual wrong-person rate is ~zero**,
> confirming on the scanner's corpus what the downloader's 39-bundle batch
> validation (its issue #19, `reports/stitch_batch_validation_v2.json`)
> suggested. The first exit branch applies: Phase B (issues 04–06) is
> **deferred as an escape hatch** for the residual (similarly-dressed
> climbers, appearance-blind footage) rather than activated — the gate
> outcome is recorded on those issues and in the PRD.
