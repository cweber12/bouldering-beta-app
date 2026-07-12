# Headless Scoring Pass (Detection Errors)

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`

## What to build

Score a detection run against the video's **Ground Truth** and post the result. A pure scoring module compares each scored Detection Frame's run pose to GT in precedence **missing > wrong > extreme > drift > good** (present frames), and flags any pose on an **absent** frame as `wrong`; skip frames and occluded joints are excluded; distances are normalized by GT body scale (torso diagonal); thresholds are named constants. It emits per-frame Detection Error rows + a per-run rollup (counts by kind, drift `{min, avg, max}`, detection-rate-vs-GT, verified/unverified coverage), stamped with `appVersion` + `setupHash` + `groundTruthHash`. Fold this scoring block into the `pose` payload (`utils/harnessPayloads.ts`) posted via the existing `/api/dev/detections` relay. Add a "Score now" action in the harness that runs detection with the frozen setup, scores in-browser against `ground-truth.json`, and posts the run. `ScanDiagnostics` still rides along.

## Acceptance criteria

- [ ] Scoring a calibrated video produces per-frame errors + a rollup with correct precedence and body-scale normalization.
- [ ] `absent` frames with a detected pose score as `wrong`; skip frames and occluded joints are excluded.
- [ ] The posted `pose` payload carries the scoring block + `groundTruthHash`; `ScanDiagnostics` still rides along.
- [ ] "Score now" runs headlessly (no manual input) and appends one run to the bundle.
- [ ] Scoring logic covered by unit tests over synthetic GT/run pairs.

## Blocked by

- `.scratch/ground-truth-detection-eval/issues/03-ground-truth-model-persistence.md`
- `.scratch/ground-truth-detection-eval/issues/05-ground-truth-frame-states-occlusion.md`
- `.scratch/ground-truth-detection-eval/issues/07-calibration-flow-split.md`
