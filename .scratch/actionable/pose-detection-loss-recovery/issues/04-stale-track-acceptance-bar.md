# Stale-track acceptance bar

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/pose-detection-loss-recovery/PRD.md`
- Handoff: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements.md` §3

## What to build

Stop the tracker from latching onto whoever is standing where the Climber used to
be. **46.5% of truth-absent matched frames carry an accepted pose**, and
`selectionMethod` is `tracked` on 99.5% of attempts — when the Climber leaves the
frame, proximity-to-prediction happily selects a spectator, a pad, or a wall
feature. This is the harness's #1 failure class since the 2026-07-23 baseline
(hallucination-fp, 16.7% of detected frames).

`selectClimberPose` accepts the nearest candidate inside the gate with no regard
for its confidence or its size relative to the Climber it is supposedly
continuing. That is fine while a track is live and wrong the moment it is not.

Add a pure `passesRelatchBar(candidate, lastConfident, options)` to
`pipeline/tracking/climberTracker.ts` and apply it in the seek loop **only** when
re-latching is speculative:

- the track is recovering from one or more consecutive misses, or
- the last confident position was at or near a frame edge (the Climber plausibly
  exited).

The bar combines a minimum mean keypoint-score floor with size and position
consistency against the last confident track (pose bbox scale ratio within a
band, centroid displacement plausible for the elapsed time). A candidate that
fails the bar does not become an accepted pose: the attempt stays `missing` with
`missReason: "bar-rejected"` (a third value on the field added in issue 01).

## Acceptance criteria

- [ ] `passesRelatchBar` is a pure, exported function with exported tunables
      (score floor, scale band, displacement allowance) and documented defaults.
- [ ] The bar is applied only when recovering from a miss run or after a
      frame-edge exit; a continuously tracked Climber is never subjected to it.
- [ ] A candidate failing the bar produces `status: "missing"` with
      `missReason: "bar-rejected"`, not an accepted pose and not a
      `flipRejected`/`qualityRejected` attempt.
- [ ] `missReason` accepts `"bar-rejected"` in the payload type, and the field
      stays optional/additive.
- [ ] Unit tests cover: a half-size bystander at the last known position is
      rejected; a low-confidence blob is rejected; the real Climber re-entering
      at plausible scale is accepted.
- [ ] Regression: detect-rate on truth-present frames is not traded away —
      re-acquisition of the genuine Climber after a real occlusion still
      succeeds in the existing processor fixtures.
- [ ] Frame-edge detection is derived from the last confident pose bbox against
      the frame bounds, with the margin an exported tunable.

## Target metrics (harness re-measures)

- Hallucination-on-absent rate — 46.5% baseline.
- hallucination-fp class share — 16.7% of detected frames baseline.
- Detect rate on truth-present frames — 74.1% baseline, must hold steady.
- `climber-absent` miss share — 44.1% baseline, expected to **rise**. Those
  misses are already correct by construction, so suppressing hallucination pushes
  the share up; that is the intended direction, not a regression.

## Comments

- Ships **after** issue 03 and is measured separately. Issue 03 widens the
  identity gate as a prediction ages; this bar is what keeps that from buying
  missing-rate improvements with hallucinations.
- The score evidence this bar tunes against is `bestUnselectedCandidateScore`
  from issue 01 — set the floor from the corpus distribution rather than by
  guess, and record the chosen value's justification in the ADR.
- Extend ADR 0024 (authored in issue 03) with the re-latch bar rather than
  writing a third record; the reset, ladder, gate ageing, and bar are one
  decision about loss recovery.
