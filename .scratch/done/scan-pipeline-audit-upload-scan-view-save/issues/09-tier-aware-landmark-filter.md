# Tier-Aware, Climbing-Weighted Landmark Filtering (S3)

Status: done
Branch: main
Merged: 0dae4cd
Type: AFK

## Parent

- `.scratch/done/scan-pipeline-audit-upload-scan-view-save/PRD.md` (Addendum: Pose Detection & Climber Tracking)

## What to build

`filterLandmarks` in `pipeline/poseInterpolator.ts` discards a frame when more
than 2 of 33 keypoints are missing or below `minScore`. Climbing legitimately
occludes feet and lower-body keypoints, so this over-discards otherwise-valid
frames.

Make filtering climbing-aware: weight a relevant keypoint subset (hands, feet,
hips, shoulders) over the full 33 so a frame is judged on the joints that matter
for beta, and make the tolerance tier-aware (stricter for Accurate, looser for
Fast) once the quality tier exists (issue 10). Keep the current call sites
working with sensible defaults if tiers are not yet wired.

## Acceptance criteria

- [x] Filtering judges frames primarily on a climbing-relevant keypoint subset,
      not all 33 weighted equally.
- [x] The missing/low-confidence tolerance is parameterised (default preserves or
      improves current behavior; tier-tunable).
- [x] Frames with occluded feet but strong hands/torso/hips survive; genuinely
      degraded frames are still dropped.
- [x] Targeted tests cover occluded-foot survival and degraded-frame rejection.
- [x] tsc, eslint, and vitest are green.

## Blocked by

None — can start immediately. Tier wiring is optional and lands with issue 10.

## Comments

- 2026-07-17 (tracker audit): closed retroactively — landed in 0dae4cd (workstream B). CLIMBING_KEYPOINT_WEIGHTS + tier-tunable tolerance verified in pipeline/pose/poseInterpolator.ts.
