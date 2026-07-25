# 08 - Homography default policy ownership and override controls

Status: ready-for-agent

## Parent

- .scratch/actionable/scan-pipeline-isolation-testability/PRD.md

## What to build

Deliver centralized homography quality gating defaults in the homography policy boundary with explicit caller override controls, so policy remains consistent across scan flows while still allowing controlled experiments.

## User stories covered

- 15, 16, 28

## Acceptance criteria

- [ ] Homography quality defaults are centrally owned and applied consistently by default.
- [ ] Caller overrides are explicit and validated, with no hidden policy branching.
- [ ] Authoritative and compare-relevant paths share the same default policy behavior unless explicitly overridden.
- [ ] Tests cover default behavior consistency and override behavior correctness.

## Blocked by

- .scratch/actionable/scan-pipeline-isolation-testability/issues/01-stage-contract-baseline-and-parity-guardrails.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/07-orb-caller-split-and-authoritative-result-contract.md
