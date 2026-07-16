# 03 — Validation pass: recalibrate multi-person videos, measure residual error

Status: ready-for-human

## Context

Phase B (candidates + swap UI) is sized by how often the fixed selector is
*still* wrong. This is a human calibration session, not code.

## Scope

- Recalibrate every corpus Test Video known to have bystanders (spotters,
  belayers, passersby) after issues 01–02 land.
  - Note (2026-07-16): once `.scratch/calibration-analyze-split/issues/02` lands,
    "recalibrate" means the explicit **re-seed** action — setup edits alone no
    longer re-run ViTPose on a video with accepted Ground Truth. If the split's
    issue 01 lands first, the review steps the denser uniform 100 ms grid
    (~300 frames per 30 s) — more stepping, denser evidence for sizing Phase B.
- For each, step the filmstrip and record per video: seed correct end-to-end /
  wrong from frame 0 / hijacked mid-clip (and roughly how many Detection Frames
  were wrong).
- Append the tally as a comment on this issue.

## Exit

- Residual wrong-person rate is ~zero → consider trimming Phase B to a minimal
  per-frame swap (or deferring it) before triaging issues 04–06.
- Residual errors persist → move issues 04–06 to `ready-for-agent` as written.
