# PRD: Pipeline Audit — Upload -> Scan -> View -> Save

Status: ready-for-agent

## Problem Statement

Climbers can upload and process beta videos, match a route photo, and save runs, but
the current pipeline has reliability and performance gaps that affect trust in saved
results. The save path can leave partially-written artifacts visible to users, the
match step can stall the UI on high-resolution photos, seek handling can hang scans,
canceling camera recording can still emit unintended captures, and run metadata fields
are not consistently length-limited before storage.

These issues reduce confidence in scan completion, make UI responsiveness inconsistent
across devices, and increase operational risk from oversized or malformed payloads.

## Solution

Ship a focused hardening pass for the upload -> scan -> view -> save pipeline using
five decided work items:

1. Complete atomic two-object save semantics with fail-closed ordering and load guardrails.
2. Normalize query-image resolution before ORB extraction using reference-aware downscaling.
3. Enforce run text limits at the serialization boundary and mirror limits in input UX.
4. Make video seek processing bounded and abortable so scans always progress or terminate cleanly.
5. Ensure camera modal teardown never emits an unintended capture unless stop-and-save is intentional.

This keeps the current architecture and user flow, while raising reliability and
performance without rewriting core subsystems.

## User Stories

1. As a climber, I want saved runs to appear only when fully readable, so that I never open a broken climb.
2. As a climber, I want failed saves to fail safely, so that partial writes do not pollute my run list.
3. As a climber, I want route-photo matching to complete quickly on phone photos, so that I can keep momentum while scanning.
4. As a climber, I want overlays to stay aligned after image normalization, so that visual feedback remains trustworthy.
5. As a climber, I want scan reset/cancel to work immediately, so that I can recover from bad inputs without reloading the page.
6. As a climber, I want long scans to avoid infinite processing states, so that I can always continue the workflow.
7. As a climber, I want canceling camera recording to discard the recording, so that accidental captures are not saved.
8. As a climber, I want stop-and-save to remain explicit, so that only intentional captures advance the flow.
9. As a climber, I want notes and route fields to accept realistic text but not extreme payloads, so that saves stay fast and stable.
10. As a climber, I want consistent behavior across scan and upload entry points, so that I can trust whichever path I use.
11. As a maintainer, I want save contracts to use a clear commit marker, so that partial failure behavior is deterministic.
12. As a maintainer, I want load logic to throw explicit errors on missing heavy data, so that support/debugging is actionable.
13. As a maintainer, I want feature extraction workload normalized to reference resolution, so that performance scales predictably.
14. As a maintainer, I want text-length enforcement at one serialization chokepoint, so that new save paths inherit safeguards automatically.
15. As a maintainer, I want seek operations to race timeout and abort signals, so that processing loops cannot deadlock on media edge cases.
16. As a maintainer, I want camera recorder teardown semantics to distinguish intentional versus teardown stop, so that modal lifecycle is correct.
17. As a QA engineer, I want each hardening item to have focused behavioral tests, so that regressions are caught early.
18. As a product owner, I want this pass to preserve existing user-facing flow and data model compatibility, so that rollout risk stays low.
19. As an operations owner, I want oversized user text and malformed save payload behavior bounded, so that storage and API pressure are controlled.
20. As a future contributor, I want deferred redesign ideas tracked separately, so that this increment remains narrow and deliverable.

## Implementation Decisions

- Keep the two-object run storage model and treat metadata as the commit marker.
- Write heavy run data first and metadata last to ensure partial failure is fail-closed.
- Keep list/read surfaces keyed from metadata objects only; heavy data objects remain non-listing artifacts.
- Add explicit load-side validation for split-run reads; fail with a clear error if required heavy data is absent or unusable.
- Normalize query photos before ORB extraction using a reference-aware longest-edge target with a hard ceiling.
- Preserve downstream coordinate semantics by scaling extracted keypoints back to native query-image space.
- Keep OpenCV execution on the main thread and within existing synchronous pipeline boundaries.
- Apply run text clamping at serialization time using a shared route-text limit aligned with existing profile text policy.
- Mirror serialization limits in metadata input controls with max-length UX constraints.
- Add seek helper behavior that races media seek completion against timeout and abort, and use it in both primary and recovery scanning loops.
- Preserve current scan pipeline architecture; this is a reliability hardening pass, not a frame-loop rewrite.
- Add camera recorder intent gating so only an explicit save action is allowed to emit capture output from recorder stop events.
- Ensure modal teardown always stops recorder/stream safely without emitting capture callbacks.
- Keep deferred redesigns out of this increment and track them as roadmap follow-ups.

## Testing Decisions

- Good tests verify observable behavior at module boundaries and user-visible outcomes, not implementation details like internal refs or event ordering internals.
- Storage split completion tests should assert fail-closed write semantics and clear load failure behavior when heavy-data siblings are missing.
- Matching normalization tests should assert that keypoint coordinates map back to native image space and that matching remains functionally valid after downscaling.
- Serialization limit tests should assert truncation/capping behavior at the configured route text limit for all relevant user fields.
- Seek robustness tests should assert timeout handling, abort responsiveness, and loop termination/progress guarantees in both normal and recovery paths.
- Camera modal behavior tests should assert no capture emission on cancel/ESC/backdrop teardown and successful emission only on explicit stop-and-save.
- Prior art should follow existing hook-focused and utility-focused test patterns in the project, with heavy OpenCV internals mocked at module boundaries.
- Manual verification should include high-resolution route-photo matching, long-video scan interruption, and mid-recording cancellation behavior.

## Out of Scope

- Recomputing derived run data on load as a persistence simplification strategy.
- Coarse-to-fine match refinement beyond baseline reference-aware downscaling.
- Replacing the seek loop with a requestVideoFrameCallback-first architecture.
- Broad auth/documentation reconciliation work beyond recording the known stale-doc inconsistency.
- Visual theme-token cleanup unrelated to the five pipeline reliability decisions.

## Further Notes

- This PRD reflects an audit where work item #1 has a committed first increment and requires completion in this pass.
- Legacy run objects remain load-compatible; new behavior should preserve backward compatibility while improving split-object resilience.
- Roadmap entries should capture deferred options explicitly so this hardening pass can stay narrow and shippable.
