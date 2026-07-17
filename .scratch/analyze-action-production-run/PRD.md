# Analyze action — production run, rendered and posted

Status: ready-for-agent

Spec inputs: `.scratch/calibration-analyze-split/PRD.md`, `.scratch/calibration-analyze-split/issues/03-analyze-action-production-run.md`, `docs/adr/0017-external-detection-eval-harness.md`, `docs/adr/0018-ground-truth-scored-detection-eval.md`, `docs/adr/0019-vitpose-ground-truth-scaffold.md`.
Glossary: `CONTEXT.md` — **Ground Truth**, **Detection Frame**, **Scan Setup**, **Test Video**, **Climber**, **Detection Error**.

## Problem Statement

The harness needs a reliable, deliberate **Analyze** action that runs the exact production detection path and shows the rendered result where evaluation decisions are made. Calibration is now truth-authoring only, so without Analyze-as-rendered-run the user loses the practical eyeball verification loop and cannot confidently tie posted runs to current implementation behavior and current Scan Setup.

## Solution

Add a per-video Analyze action that replays the saved Scan Setup through the same production MediaPipe scan path used by user-facing scan, renders skeleton-over-video with `ScanDiagnostics`, and posts one append-only run through the detections relay with attribution stamps. Analyze remains an explicit user act and never auto-fires on Ground Truth accept.

## User Stories

1. As a harness user, I want an Analyze action per Test Video, so that I can run production detection only when I choose.
2. As a harness user, I want Analyze to run the same scan path as user-facing scan, so that harness output matches production behavior.
3. As a harness user, I want Analyze to replay the saved Scan Setup, so that results are attributable to known crops, tap, tier, and panning settings.
4. As a harness user, I want Analyze to use current implementation code, so that regressions and improvements are immediately visible.
5. As a harness user, I want rendered skeleton playback after Analyze, so that I can visually inspect landmark quality.
6. As a harness user, I want `ScanDiagnostics` shown beside the rendered output, so that visual and numeric evidence stay together.
7. As a harness user, I want grid-alignment visibility in Analyze, so that I can trust frame pairing assumptions.
8. As a harness user, I want Analyze cancellation, so that I can stop accidental or long-running runs.
9. As a harness user, I want Analyze to never auto-run after Ground Truth acceptance, so that authoring and evaluation remain separate acts.
10. As a harness user, I want each completed run posted append-only, so that run history remains auditable.
11. As a harness user, I want each posted run stamped with `appVersion` and `setupHash`, so that I can compare runs across code and setup changes.
12. As a harness user, I want run counts refreshed after posting, so that corpus state is up to date.
13. As a harness user, I want rerun from the same view, so that repeated checks are fast.
14. As a calibration author, I want calibration to stay detection-free, so that truth authoring remains fast.
15. As a calibration author, I want the removed preview replaced by Analyze rendering, so that eyeball validation happens in the evaluation phase.
16. As a developer, I want run orchestration isolated from rendering logic, so that behavior is testable and maintainable.
17. As a developer, I want payload construction isolated in a stable module seam, so that relay contract changes are low-risk.
18. As a developer, I want idempotent posting guards, so that UI state churn cannot double-post one run.
19. As a quality owner, I want tests to assert external behavior only, so that refactors do not break user-visible outcomes.
20. As an analyzer consumer, I want append-only posted evidence with setup attribution, so that trend analysis remains trustworthy.

## Implementation Decisions

- Analyze is an explicit trigger and is not coupled to Ground Truth acceptance transitions.
- Analyze execution reuses the production scan pipeline contract: sampling cadence, adaptive refinement, adaptive crop behavior, and diagnostics generation.
- The feature is implemented via deep-module seams:
- Run orchestration seam for start, cancel, complete, error, and rerun transitions.
- Payload builder seam for relay-ready pose/orb payloads and attribution stamps.
- Alignment summary seam for deterministic detection-frame multiple-of-100ms checks.
- Render seam for skeleton playback plus diagnostics presentation.
- Posting uses run-identity idempotency to guarantee at-most-once relay submission per run.
- Posted runs remain append-only; no mutation or replacement of historical runs.
- `appVersion` is sourced from diagnostics; `setupHash` is sourced from the replayed setup.
- Analyze uses current setup and current implementation each run; no harness-only detector variant is introduced.

## Testing Decisions

- Good tests verify external behavior at module seams and UI boundaries, not implementation internals.
- Test the run lifecycle states: idle, running, canceled, result, error, rerun.
- Test at-most-once posting guard behavior for a completed run.
- Test payload contract behavior for required stamps and expected fields.
- Test alignment summarization behavior and mismatch reporting.
- Test rendered result behavior: skeleton and diagnostics both visible on successful Analyze.
- Reuse prior art from harness utility tests (payload builders, grid utilities, ground-truth parsing/hashing) and dev component tests for behavior-focused assertions.

## Out of Scope

- Auto-triggering Analyze on Ground Truth acceptance.
- Changes to scoring semantics, thresholds, or verdict ladder.
- Rewriting or migrating historical detection runs.
- Reintroducing calibration-time detection preview.
- Creating a non-production detection pipeline for harness-only use.

## Further Notes

- Calibration and Analyze remain intentionally split: calibration authors truth, Analyze evaluates production detection.
- The rendered Analyze view is the replacement for the removed calibration eyeball preview, now attached to the run it describes.
- This PRD keeps provenance first: append-only records and explicit run attribution.
