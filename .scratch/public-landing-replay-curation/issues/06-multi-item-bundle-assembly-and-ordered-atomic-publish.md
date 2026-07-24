# 06 - Multi-item bundle assembly and ordered atomic publish

Status: ready-for-agent

## Parent

- .scratch/public-landing-replay-curation/PRD.md

## What to build

Extend single-item publish into full multi-item editorial publish. The system should assemble all selected items, preserve manual order, validate complete readiness, and atomically activate the full edition only when all items succeed.

## User stories covered

- 3, 4, 5, 13, 14, 23, 29

## Acceptance criteria

- [ ] Multi-item selection can be assembled into one ordered playlist edition.
- [ ] Manual curation order is preserved exactly in published manifest order.
- [ ] If any item fails assembly or validation, manifest activation does not occur.
- [ ] Successful publish activates only the full new edition (no partial visibility).
- [ ] Tests cover ordered multi-item success and all-or-nothing failure behavior.

## Blocked by

- .scratch/public-landing-replay-curation/issues/04-multi-select-and-manual-reorder-curation-workspace.md
- .scratch/public-landing-replay-curation/issues/05-single-item-replay-bundle-assembly-and-publish.md
