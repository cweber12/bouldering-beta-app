# Ground Truth Frame States and Occlusion

Status: done
Type: AFK
Branch: feat/vitpose-gt-scaffold
Merged: 0453740

## Parent

- `.scratch/actionable/pose-ground-truth-detection-eval/PRD.md`

## What to build

Per-frame GT state controls and per-joint occlusion in the editor: set each Detection Frame to **present** / **absent** / **skip**, and toggle individual core joints **occluded**. Pre-seed occluded from the **scaffold model's per-keypoint confidence** (ADR 0019 — the scaffold is now the ViTPose reference model, so confidence, not MediaPipe visibility, drives the seed; joints below the threshold start occluded); pre-seed state to `present` when the scaffold posed the frame. Downstream scoring excludes occluded joints and skip frames; `absent` frames mean "no climber here" (GT empty), so a detected pose there is a false positive. Persist state + occluded flags into `ground-truth.json`, and reflect state on the filmstrip (absent / skip visually distinct from present).

## Acceptance criteria

- [x] Each frame can be set present / absent / skip; absent clears the pose, skip excludes the frame.
- [x] Individual core joints can be toggled occluded, pre-seeded from visibility.
- [x] States + occluded flags persist and reload; the filmstrip reflects state.
- [x] Covered by tests.

## Blocked by

- `.scratch/actionable/pose-ground-truth-detection-eval/issues/04-landmark-correction-editor.md`
