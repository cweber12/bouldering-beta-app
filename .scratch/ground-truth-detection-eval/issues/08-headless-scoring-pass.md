# Headless Scoring Pass (Detection Errors)

Status: wontfix
Superseded-by: .scratch/calibration-analyze-split/issues/04-scoring-vs-ground-truth.md
Type: AFK

> 2026-07-17 (tracker audit): superseded, not rejected. The calibration-analyze-split
> PRD amends this design (probed-frame scoring domain, `probeCoverage`, amended
> `detectionRateVsGT` denominator) and its issue 04 is the implementation ticket.
> The grilled ladder/thresholds/rollup below remain the spec of record and are
> referenced from there — do not implement from this file.

> Unaffected by ADR 0019 / issue 10. The ViTPose scaffold change is entirely on
> the authoring side: it reads `ground-truth.json` exactly as before, with the
> same per-Detection-Frame schema and scoring contract.

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`

## What to build

Score a detection run against the video's **Ground Truth** and post the result. A pure scoring module compares each scored Detection Frame's run pose to GT in precedence **missing > wrong > extreme > drift > good** (present frames), and flags any pose on an **absent** frame as `wrong`; skip frames and occluded joints are excluded; distances are normalized by GT body scale (torso diagonal); thresholds are named constants. It emits per-frame Detection Error rows + a per-run rollup (counts by kind, drift `{min, avg, max}`, detection-rate-vs-GT, verified/unverified coverage), stamped with `appVersion` + `setupHash` + `groundTruthHash`. Fold this scoring block into the `pose` payload (`utils/harnessPayloads.ts`) posted via the existing `/api/dev/detections` relay. Add a "Score now" action in the harness that runs detection with the frozen setup, scores in-browser against `ground-truth.json`, and posts the run. `ScanDiagnostics` still rides along.

## Design decisions (grilled 2026-07-13)

- **Per-frame row, joint detail embedded.** One Detection Error row per scored
  present frame with a single `kind`; the row also carries `bodyScale`,
  `driftAvg`, `driftMax`, `worstJoint`, and `jointDrift: Record<jointName,
  number>` (normalized displacement over non-occluded core joints). Row count ==
  scored-frame count; per-joint signal is preserved without per-joint rows.
- **Ladder keys off max non-occluded core-joint drift**, applied per present
  frame in precedence: `missing` (no/low-coverage pose) > `unscored` (no body
  scale) > `extreme` (bone-length, ADR 0015) > `wrong` (maxDrift ≥ `WRONG_MAX`) >
  `drift` (maxDrift ≥ `DRIFT_MIN`) > `good`. Named starter constants, tune against
  the real drift histogram later:
  - `DRIFT_MIN = 0.08` (torso-diag)
  - `WRONG_MAX = 0.35` (torso-diag) — keys off **max** joint drift, not mean
  - `MIN_JOINT_COVERAGE = 0.6` — `coverage = returnedCoreJoints /
    nonOccludedGtCoreJoints`; below the floor the frame is `missing` regardless of
    how the returned joints scored (mostly-absent skeleton is a miss, not a pose).
  - `extreme` reuses the ADR 0015 bone-length tolerance against GT bones.
- **Body scale = mean of resolvable torso segments** (shoulder-width, hip-width,
  the two shoulder↔hip sides), not a strict corner-to-corner diagonal — degrades
  gracefully. If fewer than one torso segment is resolvable the frame is
  **`unscored`** (`reason: no-body-scale`): counts toward coverage denominators,
  carries no drift verdict. `absent` frames skip the divisor entirely (pose ⇒
  `wrong`/`absentViolation`, no pose ⇒ `good`/`absentOk`).
- **Unverified frames scored identically to verified** — no weighting or exclusion
  inside the scoring module; the `verified` flag rides on each row. Policy (how
  much to trust unverified) lives in trend analysis so stale numbers stay
  recomputable.
- **Rollup** carries parallel `verified` / `unverified` sets, each `{ counts:
  { good, drift, wrong, extreme, missing, unscored, absentOk, absentViolation },
  drift: { min, avg, max } }` where drift stats aggregate **only over `good` +
  `drift` frames** (right-ish poses; `wrong`/`extreme` are counted, not averaged).
  Plus top-line `verifiedCoverage` (verifiedPresent / totalPresent) and
  `detectionRateVsGT` (present-frames-with-a-pose / total-present).

## Acceptance criteria

- [ ] Scoring a calibrated video produces one per-frame Detection Error row per scored present frame (single `kind` + embedded `jointDrift`) and a rollup with correct precedence and body-scale normalization.
- [ ] The ladder resolves in order `missing > unscored > extreme > wrong > drift > good`, keyed off max non-occluded core-joint drift, with the named constants `DRIFT_MIN`/`WRONG_MAX`/`MIN_JOINT_COVERAGE`.
- [ ] A partial pose below `MIN_JOINT_COVERAGE` is `missing`; a frame with fewer than one resolvable torso segment is `unscored` (no drift verdict, still counted).
- [ ] `absent` frames with a detected pose score as `wrong` (`absentViolation`); skip frames and occluded joints are excluded.
- [ ] Unverified frames are scored identically; the rollup splits into parallel `verified`/`unverified` sets with drift stats over `good`+`drift` frames only, plus `verifiedCoverage` and `detectionRateVsGT`.
- [ ] The posted `pose` payload carries the scoring block + `groundTruthHash`; `ScanDiagnostics` still rides along.
- [ ] "Score now" runs headlessly (no manual input) and appends one run to the bundle.
- [ ] Scoring logic covered by unit tests over synthetic GT/run pairs (each verdict kind + each body-scale degradation case).

## Blocked by

- `.scratch/ground-truth-detection-eval/issues/03-ground-truth-model-persistence.md`
- `.scratch/ground-truth-detection-eval/issues/05-ground-truth-frame-states-occlusion.md`
- `.scratch/ground-truth-detection-eval/issues/07-calibration-flow-split.md`
