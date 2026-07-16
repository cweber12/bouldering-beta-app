# Scoring vs Ground Truth — probed-frame domain

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/calibration-analyze-split/PRD.md`

## What to build

The pure scoring module from the grilled issue-08 design (`.scratch/ground-truth-detection-eval/issues/08-headless-scoring-pass.md`, amended by the parent PRD), wired into the Analyze action. The ladder (`missing > unscored > extreme > wrong > drift > good`), thresholds (`DRIFT_MIN`, `WRONG_MAX`, `MIN_JOINT_COVERAGE`), body-scale rule, per-frame rows with embedded `jointDrift`, and verified/unverified rollup split all stand unchanged. Amendments from the PRD: scoring covers only **probed** Ground Truth frames — those the run's detection-frame list matches within 1 ms — so a sparse-stride run is never charged `missing` for grid frames it never visited; the rollup gains `probeCoverage` (probed present / total present); `detectionRateVsGT`'s denominator becomes probed present frames; run frames absent from the grid are ignored with a count. The scoring block and `groundTruthHash` join the posted payload; verdicts surface in the Analyze view alongside the rendered skeleton.

## Acceptance criteria

- [ ] Scoring module verdicts match the issue-08 ladder and thresholds over synthetic GT/run pairs (every verdict kind + body-scale degradation cases).
- [ ] Only probed GT frames are scored; a sparse run over a dense grid produces no false `missing` verdicts; off-grid run frames are counted, not scored.
- [ ] Rollup carries `probeCoverage` and the amended `detectionRateVsGT`; verified/unverified split unchanged.
- [ ] The posted payload carries the scoring block + all three stamps (`appVersion`, `setupHash`, `groundTruthHash`); payload and dev-route tests updated.
- [ ] Re-flagging truth changes `groundTruthHash` so subsequent runs score against the new truth while prior posted runs remain untouched.
- [ ] Verdicts visible in the Analyze view.
- [ ] Type-check, lint, and targeted tests pass.

## Blocked by

- `.scratch/calibration-analyze-split/issues/02-video-keyed-ground-truth.md`
- `.scratch/calibration-analyze-split/issues/03-analyze-action-production-run.md`
