# 04 — Artifact v2: pose all candidates per Detection Frame

Status: needs-triage
Gated on: issue 03 outcome (Phase B)

> Sequencing note (2026-07-16): if activated, land after
> `.scratch/calibration-analyze-split/issues/02-video-keyed-ground-truth.md` —
> Phase B touches the same scaffold/carry-forward logic that issue re-keys from
> setupHash to timestamps. Writing against the old semantics would need rework.
> Side benefit: video-keyed GT makes re-calibration rare, shrinking the accepted
> "swaps don't survive re-calibration" loss.
>
> Re-sizing note (2026-07-17): appearance-anchored stitching shipped in the
> downloader (its issue #19), so Phase B's value proposition shrinks from
> routine correction tool to **escape hatch for the residual**
> (similarly-dressed climbers, appearance-blind footage). Artifact v2
> (candidates + `selectedTrackId`) is fully compatible with the new stitcher —
> nothing in #19 blocks this issue; issue 03's tally decides whether it is
> worth its size.

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
