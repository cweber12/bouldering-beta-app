# 04 - Multi-select and manual reorder curation workspace

Status: wontfix
Superseded-by: .scratch/actionable/ui-public-landing-replay-curation/issues/11-private-authoring-workspace-and-single-item-builder.md

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Deliver a dedicated Landing Replay Curation Page where maintainers can build an editorial set by selecting multiple eligible Runs and manually reordering them. The workspace should expose preflight eligibility status clearly and prepare an ordered publish payload.

## User stories covered

- 3, 4, 14, 26, 29

## Acceptance criteria

- [ ] Dedicated curation page can load candidate runs from existing saved data.
- [ ] Curator can multi-select runs for playlist inclusion.
- [ ] Curator can reorder selected runs and the order is preserved in publish payload preparation.
- [ ] Preflight eligibility status is visible per selected run.
- [ ] Curation state clearly distinguishes selected, rejected, and publish-ready items.
- [ ] Tests cover selection, reorder, and eligibility-state rendering behavior.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/03-curation-preflight-eligibility-fixed-capture-route-photo-starfield.md

## Superseded notes

Workspace remains, but flow changed to one-item-at-a-time authoring and approval before list assembly.
