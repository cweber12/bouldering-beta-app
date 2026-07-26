# Stale-track acceptance bar

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/pose-detection-loss-recovery/PRD.md`
- Handoff: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements.md` §3
- Decision read: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements-round-2.md` §2

## What to build

Stop the tracker from latching onto whoever is standing where the Climber used to
be. **46.5% of truth-absent matched frames carry an accepted pose** on the 07-24
corpus, and `selectionMethod` is `tracked` on 99.5% of attempts — when the
Climber leaves the frame, proximity-to-prediction happily selects a spectator, a
pad, or a wall feature.

**Baseline caveat (round-2 / harness #101):** 44% of pooled truth-absent frames
in the current corpus are contaminated — the Climber is genuinely gone on some,
but on others the "truth-absent" label is a scaffold artifact. The 46.5% figure
is therefore an upper bound measured against dirty truth. The real baseline is
whatever the first post-reset batch reads; treat the direction as settled and
the magnitude as pending.

`selectClimberPose` accepts the nearest candidate inside the gate with no regard
for its confidence or its size relative to the Climber it is supposedly
continuing. That is fine while a track is live and wrong the moment it is not.
Issue 03 makes this sharper in both directions: the aged gate admits candidates
a stale prediction used to veto, and the tight ladder rungs deliberately
re-search the neighbourhood of the last confident box — exactly where a
bystander who wandered into the Climber's old position stands.

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
`missReason: "bar-rejected"` (a third value on the field added in issue 01 —
`missReason` is now adopted harness-side, evaluation schema v13, so the new
value is read as authored).

**Fit the floor from the published distributions, not by guess.** The pooled
miss-cause table now carries `median_best_unselected_candidate_score` per cause;
identity-gated misses — overwhelmingly the real Climber, per the gate-ageing
evidence — score a median of **0.878**. The score floor must sit below what the
genuine re-entering Climber scores and above what pads and wall features score;
derive it from those CSV columns on the post-reset baseline and record the
derivation in ADR 0024. Size and position bands lean on the same size table
issue 03 uses (identity-gated misses are size-normal, median truth-bbox area
0.0396 vs accepted 0.0473).

## Acceptance criteria

- [ ] `passesRelatchBar` is a pure, exported function with exported tunables
      (score floor, scale band, displacement allowance) and documented defaults,
      each justified from the corpus CSV distributions in ADR 0024 rather than
      asserted.
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
      succeeds in the existing processor fixtures, including via issue 03's
      ladder rungs (a rung hit must still clear the bar, and a genuine Climber
      found on a rung must pass it).
- [ ] Frame-edge detection is derived from the last confident pose bbox against
      the frame bounds, with the margin an exported tunable.

## Target metrics (harness re-measures, post-reset baseline only)

Judged against the first post-reset batch (harness issue #101), same as issue
03 — the pre-reset hallucination figures are contaminated by construction.

- Hallucination-on-absent rate — 46.5% pre-reset upper bound; re-read the true
  baseline post-reset before sizing the improvement.
- hallucination-fp class share — 16.7% of detected frames pre-reset.
- Detect rate on truth-present frames — 74.1% baseline (07-24), must hold
  steady.
- `climber-absent` miss share — expected to **rise**. Those misses are already
  correct by construction, so suppressing hallucination pushes the share up;
  that is the intended direction, not a regression.

## Comments

- Ships **after** issue 03 and is measured separately. Issue 03 widens the
  identity gate as a prediction ages *and* re-searches the last-known
  neighbourhood with tight rungs; this bar is what keeps both from buying
  missing-rate improvements with hallucinations. The sequencing argument
  survives the 03 redesign unchanged: landing 04 first would measure a bar
  against a gate that never opens, landing them together would confound both.
- `bestUnselectedCandidateScore` is carried on every attempt row harness-side,
  so the floor can also be sanity-checked against *accepted* attempts' score
  distribution, not just the miss causes.
- Extend ADR 0024 (authored in issue 03) with the re-latch bar rather than
  writing a third record; the reset, ladder, gate ageing, and bar are one
  decision about loss recovery.
