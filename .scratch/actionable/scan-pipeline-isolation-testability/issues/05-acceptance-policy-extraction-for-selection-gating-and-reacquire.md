# 05 - Acceptance policy extraction for selection, gating, and reacquire

Status: ready-for-agent

## Parent

- .scratch/actionable/scan-pipeline-isolation-testability/PRD.md

## What to build

Deliver an acceptance policy stage that owns Climber selection, gating, reacquire outcomes, and accepted vs raw keypoint shaping while preserving current Detector Attempt status semantics. This slice isolates identity and rejection rules from detector I/O.

## User stories covered

- 8, 9, 10, 11, 22, 29

## Acceptance criteria

- [ ] Acceptance policy outputs clearly separate accepted keypoints from raw keypoints when candidates exist.
- [ ] Reacquire outcomes are explicit in policy output and remain behaviorally consistent with current scan flow.
- [ ] Landmark Flip and quality rejection classifications remain compatible with existing semantics.
- [ ] Tests cover tracked selection, bystander rejection, reacquire success/failure, and status classification parity.

## Blocked by

- .scratch/actionable/scan-pipeline-isolation-testability/issues/01-stage-contract-baseline-and-parity-guardrails.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/02-crop-policy-extraction-with-decision-metadata-and-wall-fallback.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/03-dual-preprocessing-planner-wired-into-scan-flow.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/04-detector-adapter-extraction-with-mapped-candidate-contract.md
