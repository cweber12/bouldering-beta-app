# Detector attempt contract

Status: done
Type: AFK
Branch: feat/detector-attempt-contract
Merged: 4fc6f61

## Parent

- `.scratch/done/dev-backend-analysis-evidence/PRD.md`

## What to build

Define the analysis-only detector attempt payload shape used by dev Analyze and the detections relay. The shape must carry one row per MediaPipe attempt, including accepted, rejected, and missing outcomes, with normalized crop rects, raw selected keypoints when present, accepted keypoints when accepted, scanner-observed condition blocks, and compact candidate metadata.

## Acceptance criteria

- [x] A typed detector attempt interface exists with statuses `accepted`, `missing`, `flipRejected`, and `qualityRejected`.
- [x] The interface includes `timestamp`, `status`, `initialSearchRegion`, `detectionRegion`, `reacquireAttempted`, `reacquired`, `rawKeypoints`, `acceptedKeypoints`, `searchConditions`, `reacquireConditions`, `candidateCount`, `rejectedCandidateCount`, and `selectionMethod`.
- [x] Full-frame regions are represented as `{ x: 0, y: 0, w: 1, h: 1 }`; `null` is reserved for unknown or not applicable.
- [x] `initialSearchRegion` is the first normalized rectangle fed to MediaPipe and `detectionRegion` is the normalized rectangle that produced `rawKeypoints`, or `null` on a miss.
- [x] The contract distinguishes `rawKeypoints` from `acceptedKeypoints`; `rawKeypoints` exists whenever MediaPipe returned a selected Climber pose and `acceptedKeypoints` exists only for `accepted` attempts.
- [x] Reacquire fields distinguish attempted full-frame fallback from a successful rescue.
- [x] Candidate metadata is limited to `candidateCount`, `rejectedCandidateCount`, and `selectionMethod`.
- [x] Harness payload tests cover preservation of the new evidence stream.

## Comments

- `limbExpanded` is an accepted source, not a rejection status.
- Reacquire is represented by `reacquired` and region fields, not as a selection method.
- `selectionMethod` values are `tap`, `tracked`, and `strongest`.
- `searchConditions` describes `initialSearchRegion`; `reacquireConditions` describes the fallback full-frame region when fallback ran.

