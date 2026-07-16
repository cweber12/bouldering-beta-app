# 04 — Artifact v2: pose all candidates per Detection Frame

Status: needs-triage
Gated on: issue 03 outcome (Phase B)

## Context

To make a wrong selection recoverable without re-running the job, the artifact
must carry every tracked person's pose per Detection Frame, with the stitched
Climber marked selected (PRD, Phase B).

## Scope

**Downloader** (`vitpose_job.py`):

- Pose every tracked person on each requested frame, capped at the 6 most
  prominent tracks by summed box area. Batched ViTPose keeps this cheap.
- Write `version: 2`: each frame keeps `keypoints` (the selected person —
  back-compatible) and adds
  `candidates: [{ "trackId": int, "box": {x,y,w,h}, "keypoints": [...] }]`
  and `selectedTrackId: int | null`.

**beta-scanner** (`utils/harnessViTPose.ts`):

- `parseViTPoseScaffold` accepts v1 (no candidates) and v2 (validated
  candidates, finite box fields, `selectedTrackId` present among candidates or
  null). `viTPoseToPoseFrames` continues reading frame-level `keypoints`
  unchanged.

## Acceptance

- Downloader tests: candidate cap, selected echo in both `keypoints` and
  `selectedTrackId`, empty-candidates frame still `keypoints: []`.
- beta-scanner `harnessViTPose` tests: v1 parses as before; v2 candidates
  validated; malformed candidates reject the file.
- A fresh calibration writes a v2 artifact and the existing seed flow works
  unchanged.
