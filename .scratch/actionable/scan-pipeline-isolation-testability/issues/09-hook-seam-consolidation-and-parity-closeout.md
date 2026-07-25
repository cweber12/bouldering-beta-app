# 09 - Hook seam consolidation and parity closeout

Status: ready-for-agent

## Parent

- .scratch/actionable/scan-pipeline-isolation-testability/PRD.md

## What to build

Deliver final orchestration consolidation where the scan hook calls extracted stage modules in the agreed order and completes parity closeout for user-visible output, abort/reacquire behavior, and detector-attempt evidence continuity.

## User stories covered

- 19, 20, 24, 25, 26

## Acceptance criteria

- [ ] Scan orchestration calls extracted stages in a fixed sequence: crop policy, preprocessing planner, detector adapter, acceptance policy, diagnostics assembler.
- [ ] User-visible scan behavior remains stable for representative Fixed Capture and Panning Capture scenarios.
- [ ] Abort/cancel and reacquire behavior remains correct under integration tests.
- [ ] Detector-attempt evidence parity checks pass against baseline fixtures.

## Blocked by

- .scratch/actionable/scan-pipeline-isolation-testability/issues/01-stage-contract-baseline-and-parity-guardrails.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/02-crop-policy-extraction-with-decision-metadata-and-wall-fallback.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/03-dual-preprocessing-planner-wired-into-scan-flow.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/04-detector-adapter-extraction-with-mapped-candidate-contract.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/05-acceptance-policy-extraction-for-selection-gating-and-reacquire.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/06-diagnostics-assembler-for-detector-attempt-evidence.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/07-orb-caller-split-and-authoritative-result-contract.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/08-homography-default-policy-ownership-and-override-controls.md
