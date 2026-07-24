# 08 - Playlist cycling across curated items plus QA and docs

Status: ready-for-agent

## Parent

- .scratch/public-landing-replay-curation/PRD.md

## What to build

Complete the end-to-end curated hero experience by implementing deterministic cycling across all published items, validating behavior with targeted regression coverage, and updating docs to reflect curation, publish, and fallback behavior.

## User stories covered

- 13, 14, 15, 22, 27, 30

## Acceptance criteria

- [ ] Hero cycles through all playlist items in fixed editorial order.
- [ ] Item-to-item handoff occurs cleanly at loop boundaries.
- [ ] Fallback behavior remains intact if public playlist cannot be loaded.
- [ ] Regression tests cover cycling order and handoff stability.
- [ ] Documentation reflects curation workflow, publish constraints, and playback behavior.

## Blocked by

- .scratch/public-landing-replay-curation/issues/06-multi-item-bundle-assembly-and-ordered-atomic-publish.md
- .scratch/public-landing-replay-curation/issues/07-hero-four-phase-playback-driver-and-stage-rendering.md
