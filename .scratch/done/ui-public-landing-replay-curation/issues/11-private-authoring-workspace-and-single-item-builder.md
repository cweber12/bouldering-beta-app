# 11 - Private authoring workspace and single-item builder

Status: wontfix
Superseded-by: .scratch/done/ui-public-landing-replay-curation/issues/15-replay-clip-contract-and-authoring-export.md

## Parent

- .scratch/done/ui-public-landing-replay-curation/PRD.md

## What to build

Create a hidden development-only authoring workspace for private maintainer use. The flow builds one replay item at a time from a known-good Fixed Capture Run: select clip window, reattach Route Photo, rerun rematch, visually approve, then stage item for playlist assembly.

## User stories covered

- Private maintainer tooling for curation.
- One-item-at-a-time reviewable asset construction.
- No runtime publish or repository mutation from the UI.

## Acceptance criteria

- [ ] Add an unlinked development-only route for landing replay authoring.
- [ ] Workspace requires normal authentication and only uses existing user-scoped read access to candidate runs.
- [ ] Candidate filtering enforces v1 source constraints (known-good Fixed Capture inputs with required display labels and usable starfield data).
- [ ] Curator can choose a fixed-width 8-second source window with endpoint preview and segment playback review.
- [ ] Curator can attach a Route Photo, run existing ORB matching/homography validation, and view alignment result.
- [ ] Route Photo is normalized for export (compressed WebP near agreed target) and retained only in local authoring state until export.
- [ ] Curator must explicitly approve item after visual review before it can be added to playlist assembly state.
- [ ] No runtime publish endpoint, allowlist role, or repository write behavior is introduced.
- [ ] Tests cover private route behavior, selection/build flow, rematch validation handling, and approval gating.

## Blocked by

- .scratch/done/ui-public-landing-replay-curation/issues/09-versioned-replay-contract-and-projection.md

## Superseded notes

Replaced by issue 15. This slice specified a workspace as if the matching flow
had to be built; `RouteConsole`, `useImageMatcher`, `buildSkeletonFrames`, and
`useHolds` already do the work, so the new slice is a clip-window picker plus a
serializer over those. Explicit approval gating and candidate eligibility
filtering are dropped — one maintainer on a hidden dev route, where approval is
clicking Export.
