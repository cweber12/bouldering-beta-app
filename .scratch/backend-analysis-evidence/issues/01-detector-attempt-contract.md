# Detector attempt contract

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/backend-analysis-evidence/PRD.md`

## What to build

Define the analysis-only detector attempt payload shape used by dev Analyze and the detections relay. The shape must carry one row per MediaPipe attempt, including accepted, rejected, and missing outcomes, with normalized crop rects, raw selected keypoints when present, accepted keypoints when accepted, scanner-observed condition blocks, and compact candidate metadata.

## Acceptance criteria

- [ ] A typed detector attempt interface exists with statuses `accepted`, `missing`, `flipRejected`, and `qualityRejected`.
- [ ] Full-frame regions are represented as `{ x: 0, y: 0, w: 1, h: 1 }`; `null` is reserved for unknown or not applicable.
- [ ] The contract distinguishes `rawKeypoints` from `acceptedKeypoints`.
- [ ] Candidate metadata is limited to `candidateCount`, `rejectedCandidateCount`, and `selectionMethod`.
- [ ] Harness payload tests cover preservation of the new evidence stream.

## Comments

- `limbExpanded` is an accepted source, not a rejection status.
- Reacquire is represented by `reacquired` and region fields, not as a selection method.

