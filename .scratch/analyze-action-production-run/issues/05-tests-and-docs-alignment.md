# Analyze tests and docs alignment

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/analyze-action-production-run/PRD.md`

## What to build

Add focused tests for Analyze orchestration, rendered-result behavior, relay payload stamping/idempotency, and alignment summaries. Update relevant docs so the calibration-versus-analyze separation and Analyze intent are explicit and consistent with shipped behavior.

## Acceptance criteria

- [ ] Tests cover Analyze lifecycle, render visibility, payload stamps, and posting idempotency.
- [ ] Tests cover alignment summary behavior and mismatch reporting.
- [ ] Docs reflect that calibration is truth-authoring and Analyze is production detection evaluation.
- [ ] No conflicting wording remains around auto-running Analyze from Ground Truth acceptance.
- [ ] Type-check, lint, and targeted tests pass.

## Blocked by

- `.scratch/analyze-action-production-run/issues/02-rendered-result-and-diagnostics.md`
- `.scratch/analyze-action-production-run/issues/03-append-only-relay-posting.md`
- `.scratch/analyze-action-production-run/issues/04-grid-alignment-visibility.md`
