# 02 - Crop policy extraction with decision metadata and wall fallback

Status: ready-for-agent

## Parent

- .scratch/actionable/scan-pipeline-isolation-testability/PRD.md

## What to build

Deliver a complete crop-policy vertical slice that centralizes Adaptive Crop decision logic and Wall Crop fallback derivation into deterministic policy outputs consumed by the live scan flow. The slice must preserve current Climber tracking behavior while exposing structured decision metadata per Detection Frame.

## User stories covered

- 1, 2, 3, 21, 23, 24

## Acceptance criteria

- [ ] Crop policy emits chosen search region plus structured decision metadata for each Detection Frame.
- [ ] Wall Crop fallback derivation is owned by the same crop policy boundary.
- [ ] Existing scan behavior for tracked, seed-based, and full-frame fallback acquisition remains unchanged.
- [ ] Tests cover deterministic crop-policy outputs for tracked, seed, and reacquire scenarios.

## Blocked by

- .scratch/actionable/scan-pipeline-isolation-testability/issues/01-stage-contract-baseline-and-parity-guardrails.md
