# Normalize Query Photo Resolution Before ORB Matching

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Normalize route-photo matching workload by downscaling the query image to a
reference-aware target before ORB extraction. Use a longest-edge target aligned to
the reference frame dimensions with a hard cap to prevent high-resolution stalls.
Rescale extracted keypoints back to native query-image coordinates so homography
and overlay behavior remain unchanged.

## Acceptance criteria

- [ ] Query-image preprocessing downscales to reference-aware bounds with a hard maximum edge.
- [ ] Keypoint coordinates are mapped back to native query-image space before downstream matching.
- [ ] High-resolution photo matching no longer causes multi-second UI blocking in normal usage.
- [ ] Targeted tests verify coordinate round-trip correctness and stable matching behavior.

## Blocked by

None - can start immediately
