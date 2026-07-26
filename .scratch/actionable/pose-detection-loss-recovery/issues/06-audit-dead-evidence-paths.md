# Audit dead evidence paths

Status: in-progress
Branch: feat/detection-06-evidence-paths
Type: AFK

## Parent

- `.scratch/actionable/pose-detection-loss-recovery/PRD.md`
- Handoff: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements.md` §5
- Contract: `beta-scan-analysis/docs/handoffs/scanner-detector-attempt-evidence.md`
  ("Iteration 2 additions")
- Decision read: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements-round-2.md` §3, §5

## Sequencing: this now ships BEFORE issue 03

Originally last of the code issues; pulled forward by the round-2 handoff's
sequencing. The harness's corpus reset (harness issue #101) runs before any
03/04 measurement batch, and **the first post-reset batch on a restarted,
correctly-stamped server is the baseline 03 and 04 are judged against.** This
issue is pure instrumentation — no detection behavior changes — so landing it
before that baseline batch cannot confound any behavioral metric, and it buys
the baseline three things it otherwise lacks:

- per-attempt `inferenceMs`, so issue 03's ladder cost lands as a measured
  delta against a real latency baseline instead of a guess;
- populated `searchConditions.wall`, so climber-region darkness is separable
  from whole-scene darkness in the baseline itself;
- truthful `selectionMethod`, so the baseline's selection-path distribution is
  clean before 03 starts changing selection behavior.

New sequence: 01 → 02 (both shipped) → **06** → post-reset baseline batch →
03 → 04 → 05.

## What to build

Close the four evidence paths the corpus showed to be empty, mislabelled, or
unmeasurable. Three are already diagnosed against the code — the work is the fix
and the write-up, not the investigation.

1. **`searchConditions.wall` is always `null`.** The call in `useVideoProcessor`
   passes the search region as `analyzeFrame`'s *climber* argument and omits the
   wall argument entirely, so `wall` can never be populated. Pass the run's
   `wallCropPx` so climber-region darkness is separable from whole-scene
   darkness. Note that `isBacklit` is currently computed as "search region darker
   than the frame", which is the right proxy — keep it and document it.

2. **`selectionMethod: "strongest"` never appears in 45k+ attempts.** Not dead
   code: `detectClimber` labels the method from `history.length === 0 &&
   tappedPoint`, and every calibrated **Scan Setup** carries a `climberPoint`, so
   the first acquisition is always `tap` (243 observed) and every later one
   `tracked` (45,225). Two fixes: label from the selection path actually taken
   rather than pre-computing it, and stop reporting a selection method on
   attempts where nothing was selected. Keep the field's type as-is for
   compatibility and express "nothing selected" additively.

3. **`qualityRejected` fired 56 times in 45k attempts, and every checkable one
   was correct.** The gate is genuinely wired in and genuinely frame-level —
   `filterLandmarks` drops whole frames on a weighted bad-keypoint budget — but
   the default tolerance of 3 is loose against MediaPipe's visibility scores, so
   it almost never fires. Confirm this in a test that pins the current behavior,
   and report the finding; **do not** retune the budget here. A threshold change
   is its own measured change. (The fresh batch reads qualityRejected 0.12%, in
   line with the baseline's 0.1% — the lane is stable, which is consistent with
   this diagnosis.)

4. **`inferenceMs` is unmeasured.** Add per-attempt wall-clock MediaPipe latency
   to the Detector Attempt (additive, optional). Stride-1 dev Analyze cost has to
   be measurable before any always-on cadence change, and issue 03's tight-first
   ladder makes that cost variable — this field landing *before* 03 is the point
   of the resequencing. The field must be defined to cover every MediaPipe pass
   on the attempt (initial search plus any future ladder rungs) so its meaning
   does not shift when 03 lands.

Also land `synthesizedJoints[]` from the contract addendum: on accepted attempts
whose source is `limbExpanded`, the joint names that were synthesized rather than
detected, so backend PCK can score detected and expanded joints separately.
`findMissingLimbs` already computes this — map limb IDs to their endpoint joint
names.

## Harness-side state this issue can rely on (schema v13)

Confirmed adopted in the round-2 handoff — do not re-propose or re-negotiate
these in the handoff reply:

- `missReason` is read as authored; pre-field streams fall back to the
  `candidateCount` derivation.
- `reacquireSteps` is parsed with the absent/empty distinction preserved and
  will be read as ladder rungs when 03 ships.
- `bestUnselectedCandidateScore` is carried on every attempt row, and the
  pooled miss-cause table publishes `median_best_unselected_candidate_score`
  per cause.

## Acceptance criteria

- [x] `searchConditions.wall` is populated on runs that have a **Wall Crop**, and
      stays `null` only when no wall region exists. Also fixed on
      `reacquireConditions`, which carried the identical always-null defect.
- [x] `selectionMethod` reflects the path that produced the selection, and
      attempts with no selected pose do not assert one.
- [x] The `strongest` path's reachability is documented in code where the label
      is produced — it requires a Setup with no `climberPoint`.
- [x] A test pins `filterLandmarks`' current frame-level behavior at the default
      tolerance, and the finding (gate is wired, budget is loose) is recorded in
      the handoff reply rather than acted on. Finding written up below for 07 to
      carry into the reply; no threshold was touched.
- [x] `inferenceMs` is exported per attempt, documented as the sum of every
      MediaPipe pass on that attempt, and correct today for the single initial
      search plus the single full-frame reacquire. Since 03 landed first it
      already covers every ladder rung — which is the definition the field was
      specified with, so no meaning shift.
- [x] `synthesizedJoints[]` is exported on `limbExpanded` accepted attempts and
      omitted elsewhere, and is stripped when an attempt is demoted to
      `flipRejected` / `qualityRejected`.
- [x] All new fields are additive and optional; a v1 payload stays valid —
      including a v1 `missing` attempt that carries a `selectionMethod`.
- [x] No detection behavior changes in this issue — search regions, gates,
      acceptance, and `frames[]` are byte-identical for the same input. **But the
      baseline claim no longer holds:** 03 landed first, so the batch this feeds
      is a 03-behavior baseline, not a 02-behavior one. See below.

## Target metrics (harness re-measures)

- Funnel completeness: every attempt status and selection method observed in data
  at plausible rates, and no field that is structurally always `null`.
- The post-reset baseline batch carries `inferenceMs` on every attempt, giving
  03 its latency baseline.

## Comments

- Version hygiene applies to the batch this feeds: the dev server must be
  restarted before the post-reset baseline run so `NEXT_PUBLIC_APP_VERSION`
  matches the running code — the round-2 correction exists because a
  hot-reloaded server stamped 02 behavior with a stale SHA (`c305954`), which
  cost the corpus its 01-only control window.

### Sequencing deviation (2026-07-26)

Shipped **after** 03, not before it. This issue's own guarantee holds — it
changes no detection behavior relative to `e0abd70` — but the guarantee it was
resequenced to provide does not: the post-reset batch it feeds now carries the
tight-first reacquire ladder, so it is a **03-behavior baseline**. Consequences:

- 03's headline movement (no-candidates share, reacquire success, missing p90)
  has no clean pre-03 post-reset control. It must be read against the pre-reset
  02-behavior figures, with the 44%-contamination caveat the round-2 handoff
  attached to them.
- 04's baseline is unaffected and clean: it is measured against this batch,
  which is exactly the "03 landed, 04 has not" state 04 wants.
- `inferenceMs` still does its job for 03 — it just measures the ladder's cost
  as an absolute rather than as a delta against a ladderless run. To recover the
  delta, set `REACQUIRE_LADDER_SCALES` to `[]` for one batch: that collapses the
  ladder to the single full-frame rung, reproducing pre-03 reacquire cost
  without a revert.

### Finding for the handoff reply (issue 07): the quality gate is wired but loose

`filterLandmarks` is genuinely wired into dev Analyze classification and is
genuinely frame-level — it drops whole frames on a weighted bad-keypoint budget
and never prunes individual keypoints. The 0.1% `qualityRejected` rate is the
budget, not a dead path. Pinned in
`__tests__/pipeline/poseInterpolator.test.ts`:

- Core joints (wrists, shoulders, hips) weigh 1.0 each; feet weigh 0.25 each;
  total available bad weight is 7.0 against a default tolerance of 3.
- A pose that lost **both hands and both feet** scores exactly 3.0 and is kept.
- Rejection needs **four of six** core joints to fail.
- A uniformly weak pose at score 0.31 accrues zero bad weight, because the
  keypoint floor is 0.3 — and MediaPipe visibility rarely lands below it. This
  is the dominant reason the gate stays quiet.

Not acted on here. Retuning the budget is its own measured change.
