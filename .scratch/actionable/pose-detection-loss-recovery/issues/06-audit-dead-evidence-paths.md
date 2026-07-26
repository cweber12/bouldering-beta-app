# Audit dead evidence paths

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/pose-detection-loss-recovery/PRD.md`
- Handoff: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements.md` §5
- Contract: `beta-scan-analysis/docs/handoffs/scanner-detector-attempt-evidence.md`
  ("Iteration 2 additions")

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
   is its own measured change.

4. **`inferenceMs` is unmeasured.** Add per-attempt wall-clock MediaPipe latency
   to the Detector Attempt (additive, optional). Stride-1 dev Analyze cost has to
   be measurable before any always-on cadence change, and issue 03's ladder makes
   that cost variable.

Also land `synthesizedJoints[]` from the contract addendum: on accepted attempts
whose source is `limbExpanded`, the joint names that were synthesized rather than
detected, so backend PCK can score detected and expanded joints separately.
`findMissingLimbs` already computes this — map limb IDs to their endpoint joint
names.

## Acceptance criteria

- [ ] `searchConditions.wall` is populated on runs that have a **Wall Crop**, and
      stays `null` only when no wall region exists.
- [ ] `selectionMethod` reflects the path that produced the selection, and
      attempts with no selected pose do not assert one.
- [ ] The `strongest` path's reachability is documented in code where the label
      is produced — it requires a Setup with no `climberPoint`.
- [ ] A test pins `filterLandmarks`' current frame-level behavior at the default
      tolerance, and the finding (gate is wired, budget is loose) is recorded in
      the handoff reply rather than acted on.
- [ ] `inferenceMs` is exported per attempt and includes every MediaPipe pass on
      that attempt (initial search plus any ladder rungs).
- [ ] `synthesizedJoints[]` is exported on `limbExpanded` accepted attempts and
      omitted elsewhere.
- [ ] All new fields are additive and optional; a v1 payload stays valid.
- [ ] No detection behavior changes in this issue.

## Target metrics (harness re-measures)

- Funnel completeness: every attempt status and selection method observed in data
  at plausible rates, and no field that is structurally always `null`.

## Comments

- Ships last of the code issues because it is instrumentation, not recovery — but
  `inferenceMs` is worth pulling forward if issue 03's ladder looks expensive in
  practice.
