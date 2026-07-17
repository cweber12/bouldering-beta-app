# Render Analyze result with skeleton and diagnostics

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/analyze-action-production-run/PRD.md`

## What to build

Render the completed Analyze run in the harness as skeleton-over-video plus `ScanDiagnostics`, replacing the lost calibration eyeball view in the correct evaluation phase. Keep rendering tied to the completed run artifact and preserve diagnostic visibility for no-climber/partial-detection outcomes.

## Acceptance criteria

- [ ] Completed Analyze runs render skeleton-over-video in harness view.
- [ ] `ScanDiagnostics` renders alongside the visual result.
- [ ] No-climber and low-quality outcomes still surface diagnostics clearly.
- [ ] Render state is stable across reruns and route switches.
- [ ] Type-check, lint, and targeted tests pass.

## Blocked by

- `.scratch/analyze-action-production-run/issues/01-analyze-run-orchestration.md`
