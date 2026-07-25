# 12 - Playlist assembly and static export

Status: wontfix
Superseded-by: .scratch/actionable/ui-public-landing-replay-curation/issues/15-replay-clip-contract-and-authoring-export.md

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Assemble approved replay items into deterministic static artifacts for deployment: one global ordered playlist plus one standalone fallback artifact derived from the designated default item.

## User stories covered

- Deterministic editorial ordering and default selection.
- Deployment-friendly static artifact generation.
- Export safety through strict contract round-trip validation.

## Acceptance criteria

- [ ] Playlist assembly state supports 1-5 approved items.
- [ ] Curator can reorder items and remove items before export.
- [ ] Curator must designate exactly one default/fallback item.
- [ ] Export produces two artifacts: full playlist and standalone fallback artifact.
- [ ] Export path runs strict parse/validate round trip and blocks download on invalid output.
- [ ] Export output is deterministic for identical inputs and order.
- [ ] Tests cover ordered assembly, default designation constraints, export shape, and round-trip validation behavior.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/11-private-authoring-workspace-and-single-item-builder.md

## Superseded notes

Export moves into issue 15; playlist order into issue 17. Dropped: the second
standalone fallback artifact (one same-origin JSON needs no fallback sibling),
the reorder UI and designated-default step (order is array order in a
checked-in file), and export round-trip validation (nothing crosses a version
boundary).
