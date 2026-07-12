# Ground Truth Frame States and Occlusion

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`

## What to build

Per-frame GT state controls and per-joint occlusion in the editor: set each Detection Frame to **present** / **absent** / **skip**, and toggle individual core joints **occluded**. Pre-seed occluded from MediaPipe visibility/presence on the scaffold pose (joints below a visibility threshold start occluded); pre-seed state to `present` when a pose was accepted. Downstream scoring excludes occluded joints and skip frames; `absent` frames mean "no climber here" (GT empty), so a detected pose there is a false positive. Persist state + occluded flags into `ground-truth.json`, and reflect state on the filmstrip (absent / skip visually distinct from present).

## Acceptance criteria

- [ ] Each frame can be set present / absent / skip; absent clears the pose, skip excludes the frame.
- [ ] Individual core joints can be toggled occluded, pre-seeded from visibility.
- [ ] States + occluded flags persist and reload; the filmstrip reflects state.
- [ ] Covered by tests.

## Blocked by

- `.scratch/ground-truth-detection-eval/issues/04-landmark-correction-editor.md`
