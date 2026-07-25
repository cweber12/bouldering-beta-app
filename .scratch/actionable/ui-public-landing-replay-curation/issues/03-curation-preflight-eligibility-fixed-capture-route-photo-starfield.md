# 03 - Curation preflight eligibility for Fixed Capture, Route Photo, and starfield

Status: wontfix
Superseded-by: .scratch/actionable/ui-public-landing-replay-curation/issues/11-private-authoring-workspace-and-single-item-builder.md

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Deliver a preflight eligibility validator for Landing Replay Curation that checks each selected Run against v1 constraints before publish. The validator must return structured, human-readable reasons for failures so curation remains actionable without implementation-level debugging.

## User stories covered

- 1, 2, 6, 7, 8, 9, 10

## Acceptance criteria

- [ ] Eligibility accepts only Fixed Capture runs for v1.
- [ ] Eligibility rejects runs without starfield data.
- [ ] Eligibility rejects runs without required Route Photo asset.
- [ ] Eligibility returns per-run structured failure reasons suitable for UI display.
- [ ] Eligibility can process multi-select sets and report mixed pass/fail outcomes.
- [ ] Tests cover pass, fail, and mixed-set behavior.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/01-global-playlist-read-path-and-landing-fallback.md

## Superseded notes

Eligibility moved into lightweight authoring-step validation (known-good Run selection, route-photo rematch success, and required labels) rather than a standalone multi-run preflight subsystem.
