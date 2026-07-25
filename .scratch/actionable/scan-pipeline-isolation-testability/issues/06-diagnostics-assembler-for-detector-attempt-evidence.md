# 06 - Diagnostics assembler for detector-attempt evidence

Status: ready-for-agent

## Parent

- .scratch/actionable/scan-pipeline-isolation-testability/PRD.md

## What to build

Deliver a dedicated diagnostics assembler that consumes typed outputs from crop, preprocessing, detector, and acceptance stages to produce detector-attempt evidence, replacing inline assembly logic in orchestration without changing payload semantics.

## User stories covered

- 17, 18, 26, 29, 30

## Acceptance criteria

- [ ] Diagnostics assembler produces detector-attempt records compatible with current required fields and status semantics.
- [ ] Scan orchestration delegates detector-attempt assembly to the dedicated module.
- [ ] Evidence compatibility behavior is preserved for canonical attempt streams, legacy frame-only runs, and unknown-stream cases.
- [ ] Tests cover end-to-end evidence parity before and after assembler extraction.

## Blocked by

- .scratch/actionable/scan-pipeline-isolation-testability/issues/01-stage-contract-baseline-and-parity-guardrails.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/02-crop-policy-extraction-with-decision-metadata-and-wall-fallback.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/03-dual-preprocessing-planner-wired-into-scan-flow.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/04-detector-adapter-extraction-with-mapped-candidate-contract.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/05-acceptance-policy-extraction-for-selection-gating-and-reacquire.md
