# Detection Loss Recovery and Gate Correctness

Status: ready-for-agent
Disposition: actionable

Spec inputs: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements.md`
(revised 2026-07-25 against the schema-v11 corpus regen, harness PRD #84);
contract addendum "Iteration 2 additions (2026-07-25)" in
`beta-scan-analysis/docs/handoffs/scanner-detector-attempt-evidence.md`;
baseline corpus 2026-07-24, 68 runs / 14 routes.
Glossary: CONTEXT.md — **Adaptive Crop**, **Climber**, **Detection Frame**,
**Detector Attempt**, **Landmark Flip**, **Adaptive Refinement**, **Ground
Truth**, **Quality Tier**.

## Problem Statement

The first attempt-backed corpus scored the scanner's detection path against
Ground Truth and found that most of the recoverable frame loss is the scanner's
own gating, not the detector's ability:

- **26.1% of attempts are `missing`**, in sustained runs (max 1,564 frames), and
  12 of 68 runs miss more than half their truth-matched attempts. On
  truth-present misses the searched region contained the Climber only **31.4%**
  of the time (median crop-vs-truth IoU **0.000**) versus 90.2% on accepted
  attempts. Full-frame reacquire runs on every miss and rescues only **4.3%**.
- **76.7% of Landmark Flip rejections on truth-present frames threw away a pose
  that agreed with Ground Truth** — 1,337 good poses discarded out of 1,744
  checkable. Rejection runs reach 398 consecutive frames; individual runs lose
  25–60% of all frames to the gate.
- **46.5% of truth-absent frames carry an accepted pose.** `selectionMethod` is
  `tracked` on 99.5% of attempts, so when the Climber leaves the frame the
  tracker latches onto spectators, pads, or wall features.
- Failure conditions cluster on flagged frames (missing frames are
  `isUnderexposed` 7.9% / `isBacklit` 5.6% versus 0.8% / 0.3% for accepted) but
  only 5.4% of misses classify as `adverse-conditions` — a real effect on a
  minority of frames.
- **50.5% of misses classify as `unexplained`** because a missing Detector
  Attempt carries no evidence about what the reacquire searched or why the
  candidates it saw were not selected. The harness cannot rank crop placement
  against detector weakness until that evidence exists.

Reading the corpus against the code identifies mechanisms the report could only
infer, and they change what to build:

- The Adaptive Crop does not drift on a lost track — it **freezes**.
  `lastClimberBox` is only reassigned when a pose is accepted, and `history` (the
  centroid trajectory driving `predictCentroid`) only grows on acceptance. Once
  the Climber is lost, the scanner re-searches the same stale rectangle every
  frame forever. That is exactly the IoU-0.000 signature.
- Full-frame reacquire already searches every pixel, so "the crop was misplaced"
  cannot by itself explain a miss. What reacquire does **not** relax is the
  identity gate: `selectClimberPose` rejects every candidate further than
  `REACQUIRE_GATE` (0.35) from a **stale** predicted centroid. A miss on a frame
  where MediaPipe returned candidates is a *gate* rejection, not a detector
  failure — and the corpus cannot currently tell those apart.
- The flip gate latches for a structural reason: `detectFlips` compares each
  frame to the previous **accepted** frame. When a frame is rejected the
  reference stays stale, the Climber keeps moving away from it, the measured
  torso displacement keeps growing, and every subsequent frame trips the teleport
  test harder than the last. Nothing in the walk can break the run.
- The quality gate (`filterLandmarks`) is genuinely wired in and genuinely frame
  level, but its weighted-bad-keypoint budget (tolerance 3) is loose enough
  against MediaPipe's visibility scores that it fires 56 times in 45k attempts.
- `selectionMethod: "strongest"` is not dead code. It is unreachable in the
  harness because every calibrated Scan Setup carries a `climberPoint`, so the
  first acquisition always labels `tap` and every later one labels `tracked`.

## Solution

Fix the three gates that discard recoverable frames, in the order that lets the
harness attribute each movement to one change, and make a missing attempt
causally legible so the next round of tuning is measured rather than inferred.

1. **Evidence first.** Export why an attempt missed (`missReason`), what the
   reacquire searched (`reacquireSteps[]`), and how close the best unselected
   candidate came (`bestUnselectedCandidateScore`) — all additive, no behavior
   change. This is the cheapest change on the list and it is the one blocking
   the harness's `unexplained` half.
2. **De-latch the Landmark Flip gate.** Require sustained flip evidence before
   discarding, retroactively discarding a confirmed run so a genuine one-frame
   glitch still never reaches the overlay, cap consecutive rejections, and
   re-anchor the comparison reference so a rejection run cannot feed itself.
3. **Reset the track and search a ladder.** After N consecutive misses, stop
   re-searching the frozen rectangle: reset the Adaptive Crop and walk an
   expanding ladder seeded at the last confident position (×2, ×4, full frame),
   relaxing the identity gate as the prediction ages. Export each rung.
4. **Raise the bar for re-latching.** A "new" subject accepted while recovering
   from a loss, or after a frame-edge exit, must clear a keypoint-score floor
   plus size/position consistency with the last confident track — otherwise the
   attempt stays `missing`. This is the counterweight to step 3's gate
   relaxation; the two must land in that order and be measured separately.
5. **Compensate exposure on flagged search regions** before inference, using a
   colour-preserving operation only.
6. **Close the dead evidence paths** — populate `searchConditions.wall`, stop
   labelling a selection method on attempts where nothing was selected, and
   record per-attempt inference latency.

Every change lands in the shared detection path, so user-facing scans get the
same fixes. Nothing in the scan wizard, Detection Preview, or Quality Tier
surface changes.

## User Stories

1. As a backend analysis author, I want a missing Detector Attempt to say why it
   missed, so that the `unexplained` half of misses can be assigned a cause.
2. As a backend analysis author, I want the regions the reacquire actually
   searched, so that crop placement can be ranked against detector weakness.
3. As a backend analysis author, I want the best unselected candidate's
   confidence, so that a hard miss (nothing seen) is distinguishable from a near
   miss (candidate just under the bar).
4. As a **User** scanning a climb, I want a brief left/right mislabel to be
   discarded without the scanner then discarding the next six seconds of good
   poses, so that my overlay does not go blank mid-climb.
5. As a User, I want the scanner to find me again after it loses me, so that a
   single bad stretch does not end detection for the rest of the video.
6. As a User, I want the skeleton to disappear when I leave the frame rather than
   jump to a bystander, so that the overlay is not confidently wrong.
7. As a developer tuning detection, I want each shipped change measured against
   the baseline table on a fresh full-corpus Batch Analyze, so that movement is
   attributable to one change at a time.
8. As a developer, I want the flip, reacquire, and acceptance thresholds to be
   exported tunables on framework-agnostic pipeline modules, so that they can be
   unit-tested without MediaPipe or OpenCV.

## Implementation Decisions

- **Sequencing is load-bearing.** Ship 01 (evidence), then 02 (flip gate), then
  03 (ladder + reset), then 04 (re-latch bar), then 05–06. `APP_VERSION` is the
  build's git SHA, so each merge is separately attributable in the harness's
  version-delta report; a batched merge would forfeit that.
- **03 and 04 are coupled.** Relaxing the identity gate during reacquire raises
  hallucination risk, and the acceptance bar is what contains it. Landing 04
  before 03 would measure a bar against a gate that never opens; landing them
  together would confound both metrics.
- **The flip fix is retroactive, not permissive.** Buffer candidate flips instead
  of accepting them: if the run reaches the confirmation length the whole
  buffered run is discarded (so a genuine glitch never reaches the overlay); if
  the detector recovers first the buffered frames are accepted. This is
  implementable because `detectFlips` runs offline over the whole sparse
  sequence, not as a stream.
- **Re-anchoring is the actual latch fix.** Sustained-evidence and the
  consecutive cap both help, but the run cannot end while the comparison
  reference stays stale. After a capped run the reference re-anchors to the
  current frame, accepted with a flag.
- **Flip flags are additive, not a new status.** The Detector Attempt contract
  fixes four statuses. A frame accepted after a capped rejection run stays
  `accepted` and carries an additive `flipFlagged: true`.
- **Reset means reset to the seed, not to nothing.** When the consecutive-miss
  reset fires, `lastClimberBox` is cleared so `pickAcquisitionRegion` falls back
  to the **Climber Crop** seed, which is what keeps a small or distant Climber
  above MediaPipe's size floor (ADR 0013). The ladder is walked from the last
  confident box; the full frame remains its last rung.
- **Gate relaxation is age-driven.** The identity gate widens as a function of
  consecutive misses (the prediction ages out), not as a flat larger constant.
  A fresh prediction keeps today's tight gate.
- **Exposure compensation must preserve colour.** `applyPosePreprocessing`
  (grayscale + `equalizeHist`) is the known-bad path: it blinded MediaPipe's
  RGB-trained model and produced zero detections on every flagged frame. The new
  operation is gamma or CLAHE on the luma channel with chroma preserved, applied
  only when `searchConditions.flags` fire on the crop, and it ships behind a
  processing option so dev Analyze can A/B it before any always-on change.
- **All new decision logic lands as pure functions in `pipeline/`** (`flipDetection`,
  `climberTracker`, `framePreprocessor`) with exported tunables. The hook wires
  them and owns state; no detection policy is written inline in
  `useVideoProcessor`.
- **`nearestCandidateDistance` is proposed, not shipped.** The evidence contract
  explicitly defers `selectionDistance`; the equivalent number on *missing*
  attempts is the single most useful input for tuning the gate, so it goes back
  to the harness as a contract question rather than landing unilaterally.
  `missReason` carries the gated/not-gated distinction without it.
- **The corpus can already separate two miss classes today.** A `missing`
  attempt with `candidateCount > 0` was gated out, not undetected. This goes in
  the handoff reply so the harness can re-slice the existing corpus without
  waiting for a new one.

## Testing Decisions

- Flip, ladder, gate-widening, and acceptance-bar logic are pure functions over
  `PoseFrame[]` / boxes — test them directly with synthetic sequences, including
  the latch case (a sustained mislabel run) and the recovery case (a one-frame
  glitch).
- Processor-level tests assert attempt classification and the new evidence
  fields at the `useVideoProcessor` seam with MediaPipe and OpenCV mocked at the
  module boundary, as the existing detector-attempt tests do.
- Every behavior change carries a regression test proving the *previous* good
  behavior is retained: a real one-frame flip is still discarded, a bystander
  outside the gate is still rejected, and a tracked Climber still detects on the
  Adaptive Crop rather than the full frame.
- Exposure compensation is tested for what it does *not* do — the output must
  retain chroma — plus a processor test proving it runs only on flag-firing
  frames.
- No test asserts corpus-level rates; those are the harness's to measure. Each
  issue names the metric the harness re-measures and the baseline figure.

## Out of Scope

- Changing the scan wizard, Detection Preview, Quality Tier defaults, or any
  user-visible surface.
- Backend metric definitions, report wording, or recommendation logic.
- Posting full MediaPipe candidate poses or `selectionDistance`.
- Replacing MediaPipe (see `.scratch/actionable/pose-vitpose-climber-identity/`).
- Retuning `filterLandmarks` thresholds — issue 06 confirms the gate's wiring and
  reports its real behavior; changing the budget is a separate, measured change.
- Any always-on cadence change for user scans (stride-1 analysis stays dev-only).

## Further Notes

- Baseline to beat, from the 2026-07-24 corpus: 66.8% accepted / 26.1% missing /
  7.0% flipRejected / 0.1% qualityRejected; detect rate on truth-present frames
  74.1%; pooled PCK@0.5-torso 0.60 (conforming runs: median 0.87).
- Two figures in the earlier revision of the handoff are superseded and must not
  be quoted: the "~71% within 0.10 normalized centroid distance" flip proxy (now
  76.7%, measured) and the "missing regions are larger, median area 0.20 vs 0.15"
  crop framing (now containment 31.4% vs 90.2%, IoU 0.000).
- Record-backed sections score truth-matched attempts (42,663 of 45,468); the
  funnel CSVs cover the full stream. The two disagree by about a point by
  construction.
