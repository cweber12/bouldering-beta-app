# De-latch the Landmark Flip gate

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/pose-detection-loss-recovery/PRD.md`
- Handoff: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements.md` §2

## What to build

Stop the **Landmark Flip** gate from discarding good poses in sustained runs.
The harness scored every rejected raw pose against **Ground Truth**: **76.7% of
flip rejections on frames where the Climber was actually present threw away a
pose that agreed with truth** (1,337 of 1,744 checkable). Rejection runs reach
398 consecutive frames; individual runs lose 25–60% of all frames to the gate.

The latch is structural. `detectFlips` in `pipeline/pose/flipDetection.ts`
compares each frame to the previous **accepted** frame (`prevKept`). Once a frame
is rejected the reference stays stale, the Climber keeps moving away from it, the
measured torso displacement keeps growing, and every later frame trips the
teleport test harder than the last. Nothing in the walk can end the run — the
gate's own output is its next input.

Change the walk, not the per-frame verdict (`isLandmarkFlip` geometry is not what
the evidence indicts):

1. **Cap the run.** After `FLIP_MAX_RUN` (suggest 5) consecutive rejections,
   accept the current frame with a flag instead of discarding it. The stream is
   otherwise lost for the whole stretch.
2. **Re-anchor the reference.** When the cap fires, set `prevKept` to that
   accepted-with-flag frame so comparison resumes against fresh geometry. This is
   what actually ends the run; the cap alone would only convert a discard run
   into a flag run.
3. **Report the flags.** `FlipScanResult` grows `flaggedTimestamps: number[]`.
   In `useVideoProcessor`, frames on those timestamps stay `accepted` in the
   **Detector Attempt** stream and carry an additive `flipFlagged: true` — the
   contract fixes the four statuses, so this is not a new status.

## Deviation from the handoff

The handoff's change #1 — "require 2–3 consecutive flip verdicts before
rejecting" — is counterproductive in this codebase and is **not** being built.
This module exists to remove the single-frame left/right glitch that makes the
overlay pop; a sustained-evidence rule would accept exactly that glitch while
still discarding the long runs, which are the over-rejection case the corpus
actually measured. Sustained rejection here is evidence that the *reference* is
stale, not that the pose is wrong. The cap plus re-anchor targets the same
metric from the other end, and keeps the singleton discard the module was built
for.

If the harness disagrees after re-measuring, the entry rule is a separate,
cheaply-reversible follow-up — the tunables are exported for that.

## Acceptance criteria

- [ ] `FLIP_MAX_RUN` is an exported tunable on `pipeline/pose/flipDetection.ts`
      with a documented default and rationale.
- [ ] A single-frame flip followed by recovery is still discarded, and the
      recovered frame is accepted (regression test over the existing fixtures).
- [ ] A sustained mislabel run produces at most `FLIP_MAX_RUN` consecutive
      discards; the next frame is accepted and appears in `flaggedTimestamps`.
- [ ] After the cap fires, `prevKept` is the accepted-with-flag frame — a unit
      test asserts an in-sequence following frame is judged against it and is not
      discarded merely because it is far from the pre-run reference.
- [ ] A synthetic 400-frame sustained-mislabel sequence loses no more than
      `FLIP_MAX_RUN` frames per re-anchor cycle (the 398-frame latch cannot
      reproduce).
- [ ] `detectFlips` returns `flaggedTimestamps` alongside `kept` and
      `flippedTimestamps`.
- [ ] Detector Attempts on flagged timestamps have `status: "accepted"` and
      `flipFlagged: true`; `flipRejected` still means discarded.
- [ ] `tagFlipDiscardedFrames` and the diagnostics `wasFlip` row still key off
      discarded (not flagged) timestamps.
- [ ] Both verdict paths — left/right swap and vertical inversion — still fire on
      their existing unit fixtures.

## Target metrics (harness re-measures)

- `flipRejected` share — 7.0% baseline, target ~2%.
- Over-rejection on truth-present rejections — **76.7%** baseline
  (`over_rejection_rate_truth_present` on
  `eval_detection_error_attempt_runs.csv`).
- Max flip-rejection run length — 398 baseline.

Watch both rates together: a change that only stops rejecting on Climber-absent
frames moves the pooled 46.5% figure without touching the gate's judgement.

## Comments

- User-facing effect is intended and positive: fewer discarded frames means fewer
  **Adaptive Refinement** gaps to re-probe, so scans keep more real poses and get
  slightly faster. Dev Analyze runs with refinement disabled, so the corpus
  measures the gate change in isolation.
- Author ADR 0023 for the re-anchoring flip gate: what latched, why the reference
  re-anchors, why flips are still discarded rather than relabelled, and why the
  sustained-evidence entry rule was declined.
- The quality gate is clean by comparison — 56 rejections in the whole corpus, 29
  truth-checkable, none wrongly rejected. Do not touch `filterLandmarks` here.
