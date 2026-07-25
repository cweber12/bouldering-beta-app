# 03 - Dual preprocessing planner wired into scan flow

Status: ready-for-agent

## Parent

- .scratch/actionable/scan-pipeline-isolation-testability/PRD.md

## What to build

Deliver a deterministic preprocessing planner that produces separate pose and ORB plans from explicit inputs, then wire those plans into the scan flow without changing user-visible output. This slice isolates policy from pixel execution while preserving current behavior.

## User stories covered

- 4, 5, 6, 27

## Acceptance criteria

- [ ] Planner inputs explicitly include frame conditions, crop decision metadata, run context, and detector context.
- [ ] Planner outputs separate plans for pose preprocessing and ORB preprocessing.
- [ ] Scan flow consumes planner outputs while preserving current playback and matching behavior.
- [ ] Tests validate planner determinism and integration-level parity for common condition combinations.

## Blocked by

- .scratch/actionable/scan-pipeline-isolation-testability/issues/01-stage-contract-baseline-and-parity-guardrails.md
- .scratch/actionable/scan-pipeline-isolation-testability/issues/02-crop-policy-extraction-with-decision-metadata-and-wall-fallback.md
