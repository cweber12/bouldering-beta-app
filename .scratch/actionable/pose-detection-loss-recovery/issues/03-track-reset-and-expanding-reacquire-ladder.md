# Track reset and tight-first reacquire ladder

Status: in-progress
Branch: feat/detection-03-reacquire-ladder
Type: AFK

## Parent

- `.scratch/actionable/pose-detection-loss-recovery/PRD.md`
- Handoff: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements.md` §1
- Decision read: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements-round-2.md` §1–§2

## What to build

Recover from a lost track instead of re-searching the same stale rectangle for
the rest of the video — with the ladder **inverted** from the original design:
the tight rungs are the payload and the full frame is the demoted fallback.

Three mechanisms, all keyed on a consecutive-miss counter owned by the seek loop
in `hooks/useVideoProcessor.ts`, with the geometry as pure functions in
`pipeline/tracking/climberTracker.ts`:

1. **Reset the Adaptive Crop.** After `MISS_RESET_RUN` (suggest 2–3) consecutive
   misses, clear `lastClimberBox` so `pickAcquisitionRegion` falls back to the
   **Climber Crop** seed. Reset to the seed, not to the full frame: the seed is
   what keeps a small or distant Climber above MediaPipe's size floor (ADR
   0013), and the size floor is now the *measured* dominant failure, not an
   inferred one (see the decision read below).
2. **Walk a tight-first ladder.** Replace the single full-frame reacquire with
   an ordered ladder seeded at the last confident box and shifted by recent
   track velocity. Rungs walk outward from tight — last-known box ×1.5, ×2.5 —
   and the full frame is the **last-resort final rung only**: the round-2 read
   proved full-frame scale is exactly where these frames already failed
   (no-candidates on a fully-searched frame), so it is retained solely as a
   bounded fallback and to measure its own rescue yield via `reacquireSteps[]`
   (shipped in issue 01; the harness confirmed it will read the array as ladder
   rungs). Rung scale factors are tunables; their defaults must be justified in
   ADR 0024 against the size evidence — a rung has to keep a miss-population
   Climber (median truth-bbox area ~0.024) above the ADR 0013 size floor.
3. **Age out the identity gate.** `selectClimberPose` currently rejects every
   candidate further than `REACQUIRE_GATE` (0.35) from a predicted centroid that
   stops updating the moment the track is lost. Widen the gate as a function of
   consecutive misses so a stale prediction stops vetoing real candidates; a
   fresh prediction keeps today's tight gate. This targets the **identity-gated
   minority only** (11.6% of misses) — do not expect it to move the headline
   missing rate; the ladder is what addresses the 88%. Fit the widening curve
   from data, not by guess: the harness now publishes
   `median_best_unselected_candidate_score` per miss cause in the report CSVs,
   and the gated population's median is **0.878** — the gate is rejecting
   high-confidence candidates, which is what ageing predicts.

## The decision read that shaped this design

Issue 01's `missReason` decision rule has been executed twice — retro-derived
from `candidateCount` on the pre-02 07-24 corpus and read as authored on the
fresh (02-behavior) batch — and both agree: **no-candidates is 88.1% / 88.4% of
misses; identity-gated is 11.9% / 11.6%.** The frame was fully searched and
MediaPipe genuinely saw nobody. By the rule set in the interim reply, that fired
the rethink branch for this issue.

The rethink is inversion, not abandonment, because of the size evidence on the
fresh batch's truth-matched attempts:

| population                              | n      | median truth-bbox area | q1–q3         |
| --------------------------------------- | ------ | ---------------------- | ------------- |
| accepted                                | 24,475 | 0.0473                 | 0.0262–0.0787 |
| no-candidates misses (truth-present)    | 5,330  | **0.0242**             | 0.0154–0.0338 |
| identity-gated misses                   | 943    | 0.0396                 | 0.0275–0.0980 |

Truth-present no-candidates misses concentrate on a Climber **half the size** of
the ones the detector accepts — their q3 barely reaches accepted's q1. Full-frame
no-candidates does not mean crop no-candidates: a Climber undetectable at
full-frame scale can be detectable in a tight, correctly-placed crop. The frozen
Adaptive Crop (containment 31.4% on truth-present misses, median IoU 0.000) means
the tight scale is currently being pointed at the wrong place — so the fix is
tight rungs walked outward from the last confident position, not a wider search.
Gated misses, by contrast, are size-normal: their problem really is the gate,
and mechanism 3 is scoped to them.

Only 10.3% of truth-present no-candidates misses have condition flags fired, so
exposure (issue 05) explains a minority — the ladder cannot be deferred in the
hope that 05 covers these frames.

## Acceptance criteria

- [x] `MISS_RESET_RUN` and the ladder's scale factors are exported tunables on
      `pipeline/tracking/climberTracker.ts` with documented defaults, and the
      defaults are justified against the size-floor evidence in ADR 0024.
- [x] A pure `buildReacquireLadder(lastBox, velocity, frameW, frameH)` returns
      the ordered rungs tightest-first, clamped to the frame, with the full
      frame always last and no duplicate rungs when a scaled rung already covers
      the frame.
- [x] After `MISS_RESET_RUN` consecutive misses the adaptive crop is cleared and
      the next acquisition region is the Climber Crop seed (or the full frame
      when no seed exists).
- [x] Reacquire stops at the first rung that finds the Climber; later rungs are
      not searched.
- [x] `reacquireSteps[]` records every rung tried, in order, with its normalized
      region and `found` flag — the full-frame rung's own rescue yield must be
      readable from the corpus so a future issue can drop it if it stays dead.
- [x] The identity gate widens with consecutive misses via a pure, unit-tested
      function; with zero consecutive misses the gate equals today's value; the
      curve's parameters are documented against the per-cause
      `median_best_unselected_candidate_score` CSV columns (gated median 0.878).
- [x] Regression: a continuously tracked Climber still detects on the Adaptive
      Crop, never escalates to a ladder, and produces the same regions as before.
- [x] Regression: a bystander far from a **fresh** prediction is still rejected.
- [ ] Per-attempt inference count is bounded — the ladder adds at most
      `rungs - 1` extra MediaPipe passes on a missing frame, and none on a hit —
      and each pass is covered by `inferenceMs` (issue 06, which now ships
      *before* this issue). **Half met:** the bound is enforced and unit-tested
      (`buildReacquireLadder` returns `REACQUIRE_LADDER_SCALES.length + 1` rungs,
      first-hit-wins, zero extra passes on a hit). `inferenceMs` does not exist
      yet — issue 06 is still `ready-for-agent`, so it was implemented out of the
      round-2 sequence. See the note in `## Comments`.

## Target metrics (harness re-measures, post-reset baseline only)

Measurement is gated on the harness's corpus reset (harness issue #101): 44% of
pooled truth-absent frames are contaminated, and the first post-reset batch on a
restarted, correctly-stamped server is the baseline this issue is judged
against. Do not size this issue's movement against pre-reset figures except as
rough orientation.

- `no-candidates` share of truth-present misses — 88.4% on the 02-behavior read;
  this is the number the tight rungs exist to move.
- Reacquire success rate — 4.3% baseline (07-24 instrument, single full-frame
  rung).
- Per-run missing p90 — 64.3% baseline; runs >50% missing — 12/68 baseline.
- Overall missing share — 26.1% (07-24) / 25.14% (02-behavior read).
- Max missing run length — 1,564 baseline.
- Crop containment on truth-present misses — 31.4% baseline (90.2% on accepted).

The `unexplained` share is no longer a metric: evaluation schema v13 retired the
bucket (`missReason` authored, `candidateCount` retro-derivation elsewhere).

## Comments

- Ships **after** issue 06 (instrumentation pulled forward so the post-reset
  baseline batch carries `inferenceMs`) and **before** issue 04, measured
  separately from both. Widening the gate raises hallucination risk on
  truth-absent frames; issue 04 is the counterweight. Expect the
  hallucination-on-absent rate to worsen in this issue's corpus and recover in
  issue 04's — that is the intended sequence, and merging them together would
  confound both metrics.
- Cost matters here: dev Analyze runs at stride 1, so a ladder on every missing
  frame multiplies inference on exactly the runs that miss the most. With 06
  landed first, the post-reset baseline carries per-attempt `inferenceMs`, so
  this issue's cost is a measured delta rather than a guess.
- Version hygiene, from the round-2 correction: restart the dev server before
  any measurement batch so `NEXT_PUBLIC_APP_VERSION` matches the running code,
  and never treat `c305954`-stamped data as 01-only in any version-delta
  comparison — that stamp behaviorally includes 02.
- Author ADR 0024 for detection loss recovery: the reset, the inverted ladder
  and why full frame was demoted (the 88% decision read plus the size table),
  the CSV-fit age-driven gate, and their interaction with the ADR 0013
  acquisition seed.

### Sequencing deviation (2026-07-26)

Implemented **before** issue 06, against the round-2 sequence
(01 → 02 → 06 → post-reset baseline → 03 → 04 → 05). Consequences to settle
before this issue is measured:

- The last acceptance criterion is only half met — the ladder's inference bound
  is enforced in code and pinned by a test, but no `inferenceMs` exists to
  measure the resulting cost delta against.
- 06 is now a **behavioral** change relative to this code rather than the pure
  instrumentation it was designed to be, in one place: it retargets
  `selectionMethod` to the path actually taken, and this issue adds ladder rungs
  to that path. 06's "no detection behavior changes" criterion still holds; its
  *baseline* claim does not, because the baseline batch would now carry ladder
  behavior.
- Land 06 next and take the post-reset baseline batch **before** issue 04, or
  accept that 03's headline movement is measured against a pre-reset corpus.

### Values chosen (defaults justified in ADR 0024)

- `MISS_RESET_RUN = 2` — median IoU 0.000 on truth-present misses, so a twice-
  failed box is pointed elsewhere; one miss stays as slack for a blur frame.
- `REACQUIRE_LADDER_SCALES = [1.5, 2.5]` — leaves a median miss-population
  Climber at 15.9% / 5.7% of the searched pixels, both above the 4.73% share the
  detector accepts on a full frame. A wider rung would fall below it.
- `IDENTITY_GATE_AGE_STEP = DEFAULT_GATE` (0.18) per miss, `MAX_IDENTITY_GATE =
1.0` — one detection step of unobserved motion added per missed frame.
