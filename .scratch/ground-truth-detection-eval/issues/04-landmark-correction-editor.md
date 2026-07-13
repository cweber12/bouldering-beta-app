# Landmark-Correction Editor

Status: done
Branch: main
Merged: 9750b1c
Type: HITL

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`

## What to build

Editable-skeleton authoring on the Detection Frame stepper: seed each frame from the scaffold detection, let the user drag the **core body joints** into place, translate the whole skeleton when the pose is right but offset, and mark a frame's landmarks correct via **accept-as-is**. Touching or accepting a frame sets its `verified` flag. Corrections persist to `ground-truth.json` (issue 03). The core joint set is ~13 (shoulders, elbows, wrists, hips, knees, ankles, a head anchor) per `utils/poseConstants.ts`; the remaining BlazePose points draw faintly for context but are not editable.

Reuse the stepper/filmstrip component (issue 01) via its `onAnnotate` seam; do not fork playback logic. Show a live edit readout (how far each joint moved from the scaffold) as authoring feedback — this is not a score.

HITL: a human verifies the drag/translate feel and precision before this merges.

## Acceptance criteria

- [ ] From the harness, stepping to a frame lets the user drag core joints and translate the whole skeleton; edits redraw immediately.
- [ ] Accept-as-is marks a frame verified without dragging; dragging any joint also marks it verified.
- [ ] Corrections + verified flags persist to `ground-truth.json` and reload correctly.
- [ ] Only the core joint set is editable/scored; face/hand points are context-only.
- [ ] A live drag-distance readout shows during editing.

## Blocked by

- `.scratch/ground-truth-detection-eval/issues/01-detection-frame-stepper-filmstrip.md`
- `.scratch/ground-truth-detection-eval/issues/03-ground-truth-model-persistence.md`
