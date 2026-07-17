# Scan-Time Auto Per-Frame Conditions

Status: ready-for-agent
Type: AFK

> Amendment (2026-07-17 tracker audit): still valid, but the surface has moved.
> The calibrator's throwaway MediaPipe scan and Detection Preview were deleted by
> `.scratch/calibration-analyze-split/` — detection now runs only in the Analyze
> action (production `useVideoProcessor` path), so the per-frame conditions and
> the "this frame" display belong in the Analyze view / `DiagnosticsPanel`, not
> the old calibration stepper. The computation site (`useVideoProcessor` under
> the diagnostics gate) is unchanged; only frame-0 conditions exist today.

## Parent

- `.scratch/ground-truth-detection-eval/PRD.md`

## What to build

Compute per-frame image conditions for every **Detection Frame** at scan time, and surface the current frame's conditions in the harness. As each Detection Frame is processed, run `analyzeFrame` (`pipeline/analysis/frameAnalyzer.ts`) on the ImageData already fed to MediaPipe — the climber region is that frame's Adaptive Crop (landmark box), the wall region is the Wall Crop — and record onto the frame's trace row: climber-vs-wall contrast (climberMean − wallMean, stdDev ratio), per-region mean/stdDev/sharpness, the condition flags, the count of non-Climber candidate poses the gate rejected (`selectClimberPose`, `pipeline/tracking/climberTracker.ts`), inter-frame centroid/joint jump vs the previous accepted pose, and bone-length implausibility (rigid-body model, `pipeline/pose/poseInterpolator.ts`, ADR 0015).

Gate the computation to the harness/diagnostics path so the production scan is untouched. Extend the per-frame trace type and thread it out of `useVideoProcessor`. Add a "this frame" section to `components/dev/DiagnosticsPanel.tsx` (or the stepper) showing the current Detection Frame's conditions as you step. These conditions double as the per-frame correlation axis for Detection Errors and as scoring features later.

## Acceptance criteria

- [ ] Every Detection Frame carries auto conditions computed at scan time from the in-hand ImageData (no re-seek).
- [ ] Stepping to a frame shows that frame's contrast / sharpness / flags / rejected-pose-count / jump / bone-length.
- [ ] The production scan path is unchanged (conditions computed only under the dev/diagnostics gate).
- [ ] Pipeline computations are pure and covered by tests (mock OpenCV at the module boundary).

## Blocked by

- `.scratch/ground-truth-detection-eval/issues/01-detection-frame-stepper-filmstrip.md`
