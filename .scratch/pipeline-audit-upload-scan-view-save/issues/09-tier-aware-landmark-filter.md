# Tier-Aware, Climbing-Weighted Landmark Filtering (S3)

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md` (Addendum: Pose Detection & Climber Tracking)

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

- [ ] Filtering judges frames primarily on a climbing-relevant keypoint subset,
      not all 33 weighted equally.
- [ ] The missing/low-confidence tolerance is parameterised (default preserves or
      improves current behavior; tier-tunable).
- [ ] Frames with occluded feet but strong hands/torso/hips survive; genuinely
      degraded frames are still dropped.
- [ ] Targeted tests cover occluded-foot survival and degraded-frame rejection.
- [ ] tsc, eslint, and vitest are green.

## Blocked by

None — can start immediately. Tier wiring is optional and lands with issue 10.
