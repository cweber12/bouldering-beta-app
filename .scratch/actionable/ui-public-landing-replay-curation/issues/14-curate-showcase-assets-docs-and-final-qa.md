# 14 - Curate showcase assets, docs, and final QA

Status: wontfix
Superseded-by: .scratch/actionable/ui-public-landing-replay-curation/issues/17-playlist-cycling-curated-assets-and-docs.md

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Run the human-assisted finalization pass: curate real showcase content with the private workspace, check in exported artifacts, update docs, and complete functional and compliance QA for the landing replay experience.

## User stories covered

- Portfolio-ready curated content delivery.
- Artifact and documentation alignment.
- Final integration confidence.

## Acceptance criteria

- [ ] Use private authoring flow with real maintainer Runs/Route Photos to curate 1-5 items and designate fallback.
- [ ] Check in both exported artifacts (playlist + standalone fallback) and verify privacy-safe content surface.
- [ ] Update README/public docs for authoring workflow, artifact locations, and rollback path.
- [ ] Confirm legacy planning slices 01-08 remain superseded and linked for traceability.
- [ ] Run end-to-end regression checks for phase behavior, passive cycling, fallback resilience, and reduced-motion output.
- [ ] Verify pause/play compliance behavior (keyboard access, label, deterministic freeze/resume).

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/13-global-playlist-reader-passive-cycling-and-fallback.md

## Superseded notes

Folded into issue 17 rather than kept as a standalone finalization slice.
Curation, check-in, docs, and QA now land with the cycling behavior they
validate, so the playlist surface is never merged without its content.
