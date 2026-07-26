# Tight-first reacquire ladder, crop reset, and an age-driven identity gate

## Status

accepted

Refines ADR 0013 (predictive tap-seeded **Adaptive Crop**) — the acquisition
seed it established is what a lost track now resets _to_. Independent of ADR
0023 (re-anchoring **Landmark Flip** gate), which governs acceptance of detected
poses rather than recovery from undetected ones.

## Context

The first attempt-backed corpus (68 runs / 14 routes, evaluation schema v13)
measured what happens after the scanner loses the **Climber**, and it was worse
than the design assumed:

- **The Adaptive Crop freezes.** `lastClimberBox` is only ever overwritten by a
  new accepted pose, so once the track is lost the seek loop re-searches the same
  stale rectangle for the rest of the video. Crop containment on truth-present
  misses is **31.4%** (against 90.2% on accepted frames) with a **median IoU of
  0.000** — on a miss the box is usually not merely loose, it is somewhere else.
- **Re-acquire is a single full-frame pass, and it almost never works.**
  Reacquire success rate: **4.3%**. Per-run missing p90: **64.3%**; 12 of 68 runs
  miss more than half their frames; the longest unbroken missing run is 1,564
  frames.
- **The identity gate is measured against a prediction that stops updating.**
  `predictCentroid` extrapolates from `history`, which only grows on acceptance,
  so during a miss run `selectClimberPose` keeps vetoing candidates against a
  frozen centroid using a fixed `REACQUIRE_GATE` of 0.35.

The obvious fix — search wider on a miss — is the one the evidence rules out.
The `missReason` decision rule shipped in issue 01 was executed twice, retro-
derived from `candidateCount` on the 07-24 corpus and read as authored on a fresh
batch, and both agree: **88.1% / 88.4% of misses are `no-candidates`**, only
11.9% / 11.6% `identity-gated`. On the overwhelming majority of misses the frame
was already searched at full-frame scale and MediaPipe genuinely returned nobody.

What separates those frames is **size**, not search area. On truth-matched
attempts from the fresh batch:

| population                           | n      | median truth-bbox area | q1–q3         |
| ------------------------------------ | ------ | ---------------------- | ------------- |
| accepted                             | 24,475 | 0.0473                 | 0.0262–0.0787 |
| no-candidates misses (truth-present) | 5,330  | **0.0242**             | 0.0154–0.0338 |
| identity-gated misses                | 943    | 0.0396                 | 0.0275–0.0980 |

Missed Climbers are **half the size** of accepted ones — their q3 barely reaches
accepted's q1 — which is exactly the size floor ADR 0013 introduced the
acquisition seed to defend against. Full-frame `no-candidates` does not imply
crop `no-candidates`: a Climber invisible at full-frame scale can be plainly
visible in a tight, _correctly placed_ crop. The frozen crop means the tight
scale is currently being pointed at the wrong place.

Gated misses are a separate, smaller population and are size-normal (0.0396,
close to accepted). Their median `best_unselected_candidate_score` is **0.878** —
the gate is rejecting high-confidence poses, which is the signature of a stale
prediction, not of a bystander.

Only 10.3% of truth-present `no-candidates` misses have any condition flag fired,
so exposure compensation cannot be expected to cover these frames.

## Decision

Recover from a lost track with three mechanisms, all keyed on a consecutive-miss
counter owned by the seek loop, with the geometry as pure functions in
`pipeline/tracking/climberTracker.ts`.

### 1. Reset the Adaptive Crop to the seed

After `MISS_RESET_RUN = 2` consecutive misses, clear `lastClimberBox` so
`pickAcquisitionRegion` falls back to the **Climber Crop** seed.

Two, not more: at median IoU 0.000 a box that has failed twice running — on
frames the ladder already searched outward from — is pointed at the wrong place,
and each further frame spends an initial MediaPipe pass on it. One miss is kept
as slack because a single blur or occlusion frame can miss while the box is still
right.

The reset target is the **seed**, never the full frame. The seed is what keeps a
small or distant Climber above the size floor (ADR 0013); resetting to the full
frame would drop the acquisition region to precisely the scale that produced the
88%.

A separate `lastConfidentBox` survives the reset, because the ladder still needs
somewhere to start walking outward from.

### 2. Walk a tight-first ladder, with the full frame demoted to last resort

`buildReacquireLadder(lastBox, velocity, frameW, frameH)` returns the ordered
regions a lost track re-searches: the last confident box scaled by
`REACQUIRE_LADDER_SCALES = [1.5, 2.5]`, recentred by the track's per-step
velocity and clamped to the frame, then the full frame **last**. The seek loop
stops at the first rung that finds the Climber.

The scales are sized against the miss population. A `no-candidates` miss has a
median truth-bbox area of 0.0242, and the climber box built from such a pose is
≈2.8× that area (`DEFAULT_CROP_PAD` laterally, plus `CROP_PAD_V_BIAS`
vertically), so ≈0.068 of the frame. A rung of scale `s` searches `s²` × that
box, leaving the Climber occupying:

| rung       | searched area | Climber's share of it | vs. full frame |
| ---------- | ------------- | --------------------- | -------------- |
| ×1.5       | 0.153         | 15.9%                 | 6.6×           |
| ×2.5       | 0.424         | 5.7%                  | 2.4×           |
| full frame | 1.000         | 2.4%                  | 1×             |

The detector demonstrably accepts a Climber occupying **4.73%** of a full frame
(the accepted median). `×2.5` still clears that bar; anything wider would not,
which is why the ladder stops there. The full-frame rung is retained solely as a
bounded fallback and so its own rescue yield stays readable from
`reacquireSteps[]` — if it stays dead across a post-reset corpus, a later issue
can drop it on evidence rather than on this argument.

A scaled rung that already covers the frame ends the tight part of the ladder:
it and every wider rung would duplicate the final full-frame rung, and each
duplicate costs a MediaPipe pass.

### 3. Age the identity gate

`agedIdentityGate(consecutiveMisses, base)` widens the gate by
`IDENTITY_GATE_AGE_STEP = DEFAULT_GATE` (0.18) per consecutive miss, saturating
at `MAX_IDENTITY_GATE = 1.0`. It is applied to both the initial crop search
(base `DEFAULT_GATE`) and every ladder rung (base `REACQUIRE_GATE`).

One `DEFAULT_GATE` per miss is not a tuned constant: that value already encodes
"how far the Climber may plausibly be from the prediction after one detection
step", and each missed frame adds exactly one more step of unobserved motion to
the stale prediction's error. The ceiling is where a normalised centroid distance
stops excluding anything meaningful on one frame, past which selection has
effectively reduced to nearest-candidate.

At zero consecutive misses the function returns `base` exactly, so a **fresh**
prediction keeps today's tight gate and still rejects bystanders. This mechanism
targets the identity-gated 11.6% only; it is not expected to move the headline
missing rate.

## Considered options

1. **Tight-first ladder with the full frame demoted** (chosen) — follows the size
   evidence: the failing frames fail at full-frame scale, so the recovery has to
   change scale, not search area.
2. **The original design: reset to full frame, ladder widening from the crop
   outward with full frame first.** Rejected once the `missReason` read landed —
   re-running the exact scale that just returned no candidates cannot rescue the
   88%, and putting it first spends the cheapest pass on the least likely rung.
3. **Do nothing until exposure compensation ships.** Rejected: only 10.3% of
   truth-present `no-candidates` misses carry a condition flag, so exposure
   explains a minority and the other frames would stay unrecovered.
4. **Drop the identity gate entirely during a miss run.** Rejected as
   unbounded — ageing reaches the same place on a long loss while keeping short
   blips gated, and the saturating form makes the behaviour readable from the
   miss counter alone.
5. **Search every rung and pick the best.** Rejected on cost: dev Analyze runs at
   stride 1, so this multiplies inference on exactly the runs that miss most.
   First-hit-wins bounds the extra cost at `rungs - 1` passes on a missing frame
   and zero on a hit.

## Consequences

- **Missing frames get more expensive; hit frames do not.** A miss now costs up
  to 3 MediaPipe passes instead of 2, and the cost concentrates on the runs that
  already miss most. Issue 06's per-attempt `inferenceMs` is what turns that into
  a measured delta rather than a guess, and is why it ships before this change.
- **Hallucination on truth-absent frames is expected to worsen in this issue's
  corpus.** A widened gate accepts candidates a fresh gate would veto. The
  stale-track acceptance bar (issue 04) is the deliberate counterweight, measured
  separately — merging the two would confound both metrics.
- **`detectionRegion` on a re-acquired attempt is now the rung that found the
  Climber**, not an unconditional full-frame rectangle. Consumers reading it as
  "reacquire ⇒ full frame" must read `reacquireSteps[]` instead.
- **Two boxes now exist where there was one.** `lastClimberBox` (resettable, the
  acquisition region) and `lastConfidentBox` (the ladder seed) can disagree after
  a reset; they must not be conflated.
- **The ladder cannot help a Climber who was never tracked.** With no confident
  box the ladder is the full frame alone — identical to the previous behaviour —
  so first acquisition still rests on the seed crop from ADR 0013.
