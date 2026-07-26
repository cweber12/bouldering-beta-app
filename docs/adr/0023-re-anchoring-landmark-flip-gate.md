# Re-anchoring Landmark Flip gate

## Status

accepted

## Context

The **Landmark Flip** gate exists to remove a specific MediaPipe glitch: for one
or two detection frames the model mislabels the **Climber**'s left/right sides
(or fits the whole skeleton upside down), then recovers. The One-Euro smoother
filters each keypoint by name independently, so it cannot see a flip as a flip —
it sees two unrelated jumps, and the overlay pops and settles. `detectFlips`
([flipDetection.ts]) discards those frames and leaves a gap for **Adaptive
Refinement** to re-probe.

The per-frame verdict (`isLandmarkFlip`) is sound. The **walk around it was
not**, and the first Ground-Truth-scored corpus (2026-07-24, 68 runs / 14 routes)
measured the cost:

- **76.7% of flip rejections on frames where the Climber was actually present
  discarded a pose that agreed with Ground Truth** — 1,337 good poses thrown away
  out of 1,744 checkable.
- Rejection runs reached **398 consecutive frames**. Individual runs lost 25–60%
  of all their frames to the gate.
- `flipRejected` was **7.0%** of all attempts.

The latch is structural, not a threshold being too tight. Each frame is compared
to the previous **accepted** frame (`prevKept`). When a frame is rejected the
reference does not advance, so it stays pinned to where the Climber was before
the run began. The Climber keeps moving. The measured torso displacement
therefore grows monotonically, and every later frame trips the teleport test
harder than the one before it. **The gate's own output is its next input, and
nothing in the walk can end the run** — only a coincidence of the Climber
wandering back toward a stale reference, or the video ending.

This also explains why the failure is bimodal rather than graded: a run either
never starts, or it runs until the clip does.

## Decision

Cap the run and **re-anchor the reference**. Change the walk; leave the verdict
geometry alone.

After `FLIP_MAX_RUN` (5) consecutive discards, `detectFlips` accepts the current
frame instead of discarding it, and sets `prevKept` to that frame so comparison
resumes against fresh geometry. The frame is reported in a new
`FlipScanResult.flaggedTimestamps`, separate from `flippedTimestamps`.

The cap is chosen against the detection cadence, not the geometry: at the default
frameStep 5 on the 100 ms grid a detection frame is every 500 ms, so 5 frames
caps a run at ~2.5 s of video. Real glitches last one to two detection frames and
are still discarded in full.

**Re-anchoring is the actual fix.** The cap alone would only convert a discard
run into a flag run — the reference would still be stale and every subsequent
frame would still trip. Once the reference moves into the current (mislabelled)
regime, consecutive mislabelled frames are ordinary motion relative to each other
and the gate stops firing entirely. A sustained mislabel therefore costs
`FLIP_MAX_RUN` frames per re-anchor cycle instead of the whole stretch.

Flagged frames stay `accepted` in the **Detector Attempt** stream and carry an
additive `flipFlagged: true`. The evidence contract fixes four statuses, so this
is deliberately not a fifth one.

## Alternatives considered

**Require 2–3 consecutive flip verdicts before rejecting** (the harness's
proposal). Declined. This module exists to keep the single-frame glitch off the
overlay; an entry rule requiring sustained evidence would accept exactly that
glitch, while still discarding the long runs that are the over-rejection case the
corpus actually measured. It trades the bug we have for the bug the module was
built to prevent. Sustained rejection here is evidence that the *reference* is
stale, not that every pose since is wrong — so the run length should drive
re-anchoring, not admission.

**Buffer candidate flips and discard the run retroactively** — hold flips back,
discard the whole buffered run if it reaches a confirmation length, accept the
buffer if the detector recovers first. Declined for the same reason, which is
easier to see stated plainly: a one-frame glitch is a one-frame run, it never
reaches the confirmation length, so its buffer is *accepted* and the glitch
reaches the overlay. This was the parent PRD's original decision and is superseded
by this ADR.

**Relabel flipped poses instead of discarding them.** Still declined, unchanged
from the module's original design: real flips are frequently asymmetric (only
part of the body mislabels), so a clean left↔right swap produces a wrong pose.

**Loosen `DEFAULT_TELEPORT_THRESHOLD`.** Does not address the mechanism. A looser
threshold delays the run's start and lets more genuine glitches through, but once
a run begins the displacement still grows without bound and the latch still
forms.

## Consequences

- A sustained mislabel costs at most `FLIP_MAX_RUN` frames per re-anchor cycle.
  The 398-frame latch cannot reproduce; a regression test asserts this over a
  synthetic 400-frame run.
- Fewer discarded frames means fewer Adaptive Refinement gaps to re-probe, so
  user-facing scans keep more real poses and get slightly faster.
- A flagged frame is accepted under suspicion — its pose may genuinely be
  mislabelled. This is a deliberate trade: one suspect frame every cap cycle in
  exchange for not losing the intervening stretch. The harness can score flagged
  frames separately via `flipFlagged`.
- `FLIP_MAX_RUN` is an exported tunable and `detectFlips` accepts a `maxRun`
  override, so the cap can be re-tuned from the corpus without touching the walk.
- `tagFlipDiscardedFrames` and the Scan Diagnostics `wasFlip` row continue to key
  off discarded timestamps only; a flagged frame is not a discarded frame.

The metrics the harness re-measures: `flipRejected` share (7.0% baseline, target
~2%), `over_rejection_rate_truth_present` (76.7% baseline), and max flip-rejection
run length (398 baseline). Both rates must be read together — a change that only
stops rejecting on Climber-absent frames would move the pooled figure without
improving the gate's judgement.

## References

- [flipDetection.ts] — `detectFlips`, `FLIP_MAX_RUN`, `isLandmarkFlip`
- [useVideoProcessor.ts] — flip pass wiring, `finalizeDetectorAttempts`
- ADR 0013 — predictive tap-seeded Adaptive Crop (the acquisition path this sits on)
- ADR 0018 — Ground-Truth-scored detection eval (the corpus that measured this)
- `.scratch/actionable/pose-detection-loss-recovery/issues/02-de-latch-the-landmark-flip-gate.md`

[flipDetection.ts]: ../../pipeline/pose/flipDetection.ts
[useVideoProcessor.ts]: ../../hooks/useVideoProcessor.ts
