# Track reset and expanding reacquire ladder

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/pose-detection-loss-recovery/PRD.md`
- Handoff: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements.md` §1

## What to build

Recover from a lost track instead of re-searching the same stale rectangle for
the rest of the video.

Two mechanisms, both keyed on a consecutive-miss counter owned by the seek loop
in `hooks/useVideoProcessor.ts`, with the geometry as pure functions in
`pipeline/tracking/climberTracker.ts`:

1. **Reset the Adaptive Crop.** After `MISS_RESET_RUN` (suggest 2–3) consecutive
   misses, clear `lastClimberBox` so `pickAcquisitionRegion` falls back to the
   **Climber Crop** seed. Reset to the seed, not to the full frame: the seed is
   what keeps a small or distant Climber above MediaPipe's size floor (ADR 0013).
2. **Walk an expanding ladder.** Replace the single full-frame reacquire with an
   ordered ladder seeded at the last confident box and scaled by recent track
   velocity — last-known box ×2, ×4, then full frame — stopping at the first rung
   that finds the Climber. Export every rung tried into `reacquireSteps[]`
   (shipped in issue 01).
3. **Age out the identity gate.** `selectClimberPose` currently rejects every
   candidate further than `REACQUIRE_GATE` (0.35) from a predicted centroid that
   stops updating the moment the track is lost. Widen the gate as a function of
   consecutive misses so a stale prediction stops vetoing real candidates; a
   fresh prediction keeps today's tight gate.

## Why the crop evidence points here

The report describes the Adaptive Crop as "following a lost track". It does not
drift — it **freezes**. `lastClimberBox` is only reassigned on acceptance and
`history` (which drives `predictCentroid`) only grows on acceptance, so after a
loss the scanner re-searches an identical rectangle every frame. That is the
median crop-vs-truth IoU of **0.000** and the 31.4% containment on truth-present
misses, against 90.2% on accepted attempts. It is also why sustained misses reach
1,564 frames: nothing in the loop can ever move the region back onto the Climber.

## Acceptance criteria

- [ ] `MISS_RESET_RUN` and the ladder's scale factors are exported tunables on
      `pipeline/tracking/climberTracker.ts` with documented defaults.
- [ ] A pure `buildReacquireLadder(lastBox, velocity, frameW, frameH)` returns the
      ordered rungs, clamped to the frame, with the full frame always last and no
      duplicate rungs when a scaled rung already covers the frame.
- [ ] After `MISS_RESET_RUN` consecutive misses the adaptive crop is cleared and
      the next acquisition region is the Climber Crop seed (or the full frame
      when no seed exists).
- [ ] Reacquire stops at the first rung that finds the Climber; later rungs are
      not searched.
- [ ] `reacquireSteps[]` records every rung tried, in order, with its normalized
      region and `found` flag.
- [ ] The identity gate widens with consecutive misses via a pure, unit-tested
      function; with zero consecutive misses the gate equals today's value.
- [ ] Regression: a continuously tracked Climber still detects on the Adaptive
      Crop, never escalates to a ladder, and produces the same regions as before.
- [ ] Regression: a bystander far from a **fresh** prediction is still rejected.
- [ ] Per-attempt inference count is bounded — the ladder adds at most
      `rungs - 1` extra MediaPipe passes on a missing frame, and none on a hit.

## Target metrics (harness re-measures)

- Reacquire success rate — 4.3% baseline.
- Per-run missing p90 — 64.3% baseline; runs >50% missing — 12/68 baseline.
- Max missing run length — 1,564 baseline.
- Crop containment on truth-present misses — 31.4% baseline (90.2% on accepted).
- `unexplained` miss share — 50.5% baseline, from
  `eval_crop_quality_miss_causes.csv` and `eval_attempt_funnel_run_stats.csv`.

## Comments

- Ships **before** issue 04 and is measured separately from it. Widening the gate
  raises hallucination risk on truth-absent frames; issue 04 is the counterweight.
  Expect the hallucination-on-absent rate (46.5%) to get worse in this run's
  corpus and recover in issue 04's — that is the intended sequence, and merging
  them together would confound both metrics.
- Cost matters here: dev Analyze runs at stride 1, so a ladder on every missing
  frame multiplies inference on exactly the runs that miss the most. Record
  `inferenceMs` (issue 06) before considering any always-on cadence change.
- Author ADR 0024 for detection loss recovery: the reset, the ladder, the
  age-driven gate, and their interaction with the ADR 0013 acquisition seed.
