# Processor detector-attempt capture

Status: in-progress
Branch: feat/processor-attempt-capture
Type: AFK

## Parent

- `.scratch/actionable/dev-backend-analysis-evidence/PRD.md`

## What to build

Instrument the dev Analyze path through the production scanner processor to collect detector attempts without changing the user-facing scanner. Analysis runs should use `frameStep = 1`, keep the scanner's adaptive crop logic, disable Adaptive Refinement at that stride, and emit one canonical detector attempt per sampled frame.

## Acceptance criteria

- [ ] Dev Analyze can request analysis-only detector attempts without changing normal scan behavior.
- [ ] Analysis runs use `frameStep = 1` and disable Adaptive Refinement.
- [ ] Adaptive Crop and full-frame reacquire behavior remain enabled for analysis runs.
- [ ] Each sampled 100 ms analysis-grid frame emits one detector attempt row before playback interpolation, filling, smoothing, or constraints can obscure detector behavior.
- [ ] Attempts preserve raw selected MediaPipe keypoints before scanner-side rejection or mutation.
- [ ] `missing` attempts are emitted when no selected Climber pose is available after initial search and any full-frame reacquire.
- [ ] `flipRejected` attempts include raw keypoints and rejection status.
- [ ] `qualityRejected` is derived after filtering by comparing flip-kept detected frames against `goodFrames`.
- [ ] Reacquire attempts carry both the initial failed region and the successful detection region.
- [ ] Every attempt carries `searchConditions`; only changed-region reacquires carry `reacquireConditions`.

## Comments

- This issue should prefer extending existing diagnostics/crop-trace seams over creating a parallel scanner loop.
- Dense playback frame generation may still run for the harness view, but those frames are not detector evidence.
- Scanner-side scoring, if still posted for the dev UI, is preview evidence only; backend evaluation remains authoritative.

