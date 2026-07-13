# Calibration Flow Split (No Scored Run)

Status: done
Type: AFK
Branch: issue-07-calibration-flow-split
Merged: 65ef423

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`

## What to build

Restructure the harness so **calibration authors ground truth and posts no scored run**. Today, confirming runs one detection and relays it to the downloader (`app/dev/harness/page.tsx` `handleConfirmAndRun` → `/api/dev/detections`). Change calibration to: run the detection **scaffold** for authoring only, save `setup.json` + `ground-truth.json` (+ metadata), and **not** post to `/api/dev/detections`. The scaffold run's output stays in memory for editing and is never persisted as a run. Scored runs come only from the separate scoring pass (issue 08).

## Acceptance criteria

- [x] Completing calibration writes setup + ground truth (+ metadata) and creates no `*_pose.json` run in the bundle.
- [x] The scaffold detection still drives the editor but is not persisted as a run.
- [x] The corpus run count does not increment on calibration.
- [x] Existing setup save/reload still works; covered by tests.

## Blocked by

- `.scratch/ground-truth-detection-eval/issues/03-ground-truth-model-persistence.md`
- `.scratch/ground-truth-detection-eval/issues/04-landmark-correction-editor.md`
