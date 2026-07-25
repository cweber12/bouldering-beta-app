# 07 - ORB caller split and authoritative result contract

Status: ready-for-agent

## Parent

- .scratch/actionable/scan-pipeline-isolation-testability/PRD.md

## What to build

Deliver separate preview and authoritative ORB caller paths that share an isolated ORB core while preventing preview behavior from influencing authoritative matching outcomes. The authoritative path must return matrix-grade result status data suitable for diagnostics and regression testing.

## User stories covered

- 12, 13, 14, 15, 16, 28

## Acceptance criteria

- [ ] ORB preview caller and ORB authoritative caller are explicitly separated by contract.
- [ ] Shared ORB extraction core remains isolated from UI concerns.
- [ ] Authoritative path emits transformation-matrix result status details suitable for failure reason analysis.
- [ ] Tests verify preview-path changes cannot alter authoritative matching outcomes.

## Blocked by

- .scratch/actionable/scan-pipeline-isolation-testability/issues/01-stage-contract-baseline-and-parity-guardrails.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/03-dual-preprocessing-planner-wired-into-scan-flow.md
