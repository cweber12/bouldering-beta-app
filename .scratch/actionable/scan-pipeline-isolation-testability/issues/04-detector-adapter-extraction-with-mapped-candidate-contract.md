# 04 - Detector adapter extraction with mapped-candidate contract

Status: ready-for-agent

## Parent

- .scratch/actionable/scan-pipeline-isolation-testability/PRD.md

## What to build

Deliver an extracted detector adapter stage that owns detector backend I/O and candidate mapping responsibilities while preserving existing scan detection behavior. The adapter should expose a stable mapped-candidate contract consumable by acceptance policy.

## User stories covered

- 7, 21, 24, 27

## Acceptance criteria

- [ ] Detector adapter owns timestamp-safe detector invocation and mapped candidate output responsibilities.
- [ ] Live scan flow uses the adapter output without changing detected-frame behavior.
- [ ] Adapter contract is deterministic and independent from acceptance decisions.
- [ ] Tests cover no-candidate, multi-candidate, and mapped-coordinate correctness paths.

## Blocked by

- .scratch/actionable/scan-pipeline-isolation-testability/issues/01-stage-contract-baseline-and-parity-guardrails.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/02-crop-policy-extraction-with-decision-metadata-and-wall-fallback.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/03-dual-preprocessing-planner-wired-into-scan-flow.md
