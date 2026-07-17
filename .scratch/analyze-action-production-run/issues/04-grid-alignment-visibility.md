# Analyze grid-alignment visibility and guardrails

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/analyze-action-production-run/PRD.md`

## What to build

Expose Detection Frame alignment visibility in Analyze so operators can verify that run frame timestamps align to the 100 ms grid by arithmetic. Surface mismatches as diagnostics-only guardrails without mutating run data.

## Acceptance criteria

- [ ] Analyze surfaces alignment summary for detection-frame timestamps.
- [ ] Healthy runs show 100 ms-multiple alignment.
- [ ] Mismatches are surfaced as visibility/diagnostic output only.
- [ ] Alignment logic is deterministic and unit-tested.
- [ ] Type-check, lint, and targeted tests pass.

## Blocked by

- `.scratch/analyze-action-production-run/issues/01-analyze-run-orchestration.md`
