# Retire the Centre-Shrink Pose Retry (S1)

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md` (Addendum: Pose Detection & Climber Tracking)

## What to build

`estimateFrameWithRetry` in `pipeline/poseDetection.ts` shrinks the detection
crop uniformly toward the centre on low confidence — which can crop the climber
_out_ when they sit near an edge, and is no longer wired into the main scan loop
(the climber tracker's "widen + re-select by identity" path superseded it).

Remove the dead retry primitive (or repurpose it to re-centre on the partial
detection's centroid rather than blind-shrink), and delete its now-unused options
and tests. Ensure the only low-confidence response in the pipeline is
climber-aware via the tracker.

## Acceptance criteria

- [ ] `estimateFrameWithRetry` and its `RetryOptions` are removed, or reworked to
      re-centre on the detected centroid instead of shrinking from edges.
- [ ] No remaining references to the centre-shrink retry in `hooks/` or `pipeline/`.
- [ ] `scorePoseFrame` / `meanConfidence` are retained if still used elsewhere,
      otherwise removed with their tests.
- [ ] tsc, eslint, and vitest are green; obsolete retry tests are deleted, not skipped.

## Blocked by

None — can start immediately. (The tracker work it depends on is already shipped
on `feat/climber-identity-tracking`.)
