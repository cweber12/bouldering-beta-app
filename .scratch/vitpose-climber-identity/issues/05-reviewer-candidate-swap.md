# 05 — Reviewer: render candidates, click to swap the subject on a frame

Status: needs-triage
Gated on: issue 03 outcome (Phase B); depends on issue 04

> Sequencing note (2026-07-16): if activated, land after
> `.scratch/calibration-analyze-split/issues/02-video-keyed-ground-truth.md`
> (see the note on issue 04 — shared carry-forward semantics).
>
> Re-sizing note (2026-07-17): with appearance-anchored stitching shipped in
> the downloader (its issue #19), the swap UI is an escape hatch for the
> residual (similarly-dressed climbers, appearance-blind footage), not a
> routine correction tool — see the note on issue 04. Issue 03's tally may
> trim this to the minimal per-frame swap or defer it.

## Context

First tracer slice of the swap UI: per-frame swap only (propagation is issue 06).

## Scope

- `GroundTruthReviewer` renders non-selected candidates as faint boxes (skeleton
  optional) over the paused frame; the selected subject renders as today.
- Clicking a candidate swaps the subject **for that frame**: joints re-seed from
  the candidate's keypoints, occlusion flags re-seed from its scores.
- Review-state rule for the clicked frame (explicit intent — always applies):
  whatever the prior flag (`auto`, `human-flagged-wrong`, `human-flagged-absent`),
  the frame becomes `present` with `review: "auto"` on the new seed.
- Swap logic (candidate → frame seed mutation, review reset) lives in a
  framework-agnostic util next to the Ground Truth scaffold helpers, not in the
  component.

## Acceptance

- Util tests: joint/occlusion re-seed, review reset matrix for the clicked frame.
- Component test: candidates render, click fires the swap callback, no
  regression in the flag controls.
- `npx tsc --noEmit`, `npx eslint .`, targeted vitest clean.
