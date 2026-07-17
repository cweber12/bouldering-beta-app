# Analyze run orchestration and production parity

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/analyze-action-production-run/PRD.md`

## What to build

Implement the Analyze action lifecycle as a deliberate, per-video run that executes the same production scan path as user-facing scan. Ensure the run uses saved Scan Setup values and current implementation behavior, supports cancel and rerun, and never auto-fires from Ground Truth acceptance transitions.

## Acceptance criteria

- [ ] Analyze starts only from explicit user action.
- [ ] Analyze runs the production scan path (sampling, refinement, adaptive crop) with saved Scan Setup values.
- [ ] Analyze supports cancel and rerun without leaving stale state.
- [ ] Analyze does not auto-fire when Ground Truth is accepted.
- [ ] Type-check, lint, and targeted tests pass.

## Blocked by

None - can start immediately.
