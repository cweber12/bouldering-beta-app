# 01 - Stage contract baseline and parity guardrails

Status: ready-for-agent

## Parent

- .scratch/actionable/scan-pipeline-isolation-testability/PRD.md

## What to build

Deliver the first end-to-end refactor guardrail slice by defining stage-level contracts for scan pipeline handoffs and wiring parity checks that validate current scan behavior and detector-attempt evidence semantics are preserved. This slice establishes the baseline needed for all later extraction work.

## User stories covered

- 18, 19, 20, 26, 30

## Acceptance criteria

- [ ] Stage contract shapes are defined for crop decision output, preprocessing planning output, detector adapter output, acceptance output, and diagnostics assembler input.
- [ ] Parity checks verify current detector-attempt status semantics and required fields remain unchanged.
- [ ] Compatibility checks confirm legacy frame-only evidence remains readable and missing attempt streams are treated as unknown.
- [ ] Tests cover baseline contract parsing/validation and behavior parity at observable seams.

## Blocked by

None - can start immediately
