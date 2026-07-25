# 17 - Playlist cycling, curated assets, and docs

Status: ready-for-agent

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Turn the single-item hero into a playlist, then curate and check in the real
content. This is the finalization slice: cycling behavior, the actual clips,
docs, and end-to-end QA.

Cycling is deliberately thin — order is array order in a checked-in file, so
there is no reorder UI, no designated default, and no per-item skip machinery.

## User stories covered

- Same curated experience for all visitors.
- Portfolio-ready curated content delivery.
- Artifact and documentation alignment.

## Acceptance criteria

- [ ] Landing hero loads one global playlist asset containing 1-5 items and
      plays them in file order for all visitors.
- [ ] Item handoff is deterministic: each item runs 8 seconds and hands off via
      an approximately 300 ms crossfade, driven by the same replay clock from
      issue 16.
- [ ] Cycling wraps to the first item and continues indefinitely while the
      clock runs.
- [ ] Use the private authoring route from issue 15 with real maintainer Runs
      and Route Photos to curate 1-5 clips, and check the exported playlist
      asset into the repo.
- [ ] Verify the checked-in asset's content surface is privacy-safe (labels
      only, no identity, notes, coordinates, keys, descriptors, or homography).
- [ ] Update README for the authoring workflow, the asset location, and the
      rollback path (revert the asset file).
- [ ] Confirm legacy planning slices 01-14 remain superseded and linked for
      traceability.
- [ ] Run end-to-end regression checks: phase behavior, cycling and handoff,
      graceful degradation when the asset is absent, reduced-motion output, and
      pause/play keyboard access.
- [ ] Tests cover ordered cycling, handoff timing, and wrap behavior.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/16-landing-four-phase-renderer-and-replay-clock.md