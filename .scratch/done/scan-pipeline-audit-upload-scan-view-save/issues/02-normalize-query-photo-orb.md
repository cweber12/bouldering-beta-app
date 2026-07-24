# Normalize Query Photo Resolution Before ORB Matching

Status: done
Branch: main
Merged: fdcc6bd
Type: AFK

## Parent

- `.scratch/done/scan-pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Normalize route-photo matching workload by downscaling the query image to a
reference-aware target before ORB extraction. Use a longest-edge target aligned to
the reference frame dimensions with a hard cap to prevent high-resolution stalls.
Rescale extracted keypoints back to native query-image coordinates so homography
and overlay behavior remain unchanged.

## Acceptance criteria

- [x] Query-image preprocessing downscales to reference-aware bounds with a hard maximum edge.
- [x] Keypoint coordinates are mapped back to native query-image space before downstream matching.
- [x] High-resolution photo matching no longer causes multi-second UI blocking in normal usage.
- [x] Targeted tests verify coordinate round-trip correctness and stable matching behavior.

## Blocked by

None - can start immediately

## Comments

- 2026-07-17 (tracker audit): closed retroactively — landed in fdcc6bd (workstream A). downscaleImageData + queryMaxEdgeFor verified in hooks/useImageMatcher.ts.
