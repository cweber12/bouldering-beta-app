# 02 - Secure publisher gate and atomic manifest swap

Status: wontfix
Superseded-by: .scratch/actionable/ui-public-landing-replay-curation/issues/11-private-authoring-workspace-and-single-item-builder.md

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Deliver a guarded publish path for global Landing Replay Playlist updates. Publishing must require authenticated allowlisted UID access, be restricted to development in v1, and replace the active playlist atomically so visitors never read mixed editions.

## User stories covered

- 5, 11, 12, 23

## Acceptance criteria

- [ ] Publish is rejected when unauthenticated.
- [ ] Publish is rejected when caller UID is not allowlisted.
- [ ] Publish is rejected outside development environment.
- [ ] Publish writes full target artifacts before activating the new manifest.
- [ ] Active manifest pointer/object swap is atomic from reader perspective.
- [ ] Tests cover authorization and atomic replacement behavior.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/01-global-playlist-read-path-and-landing-fallback.md

## Superseded notes

Removed by plan change to checked-in static artifacts. No runtime publisher API, allowlist, or manifest swap remains in scope.
