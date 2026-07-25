# 05 - Single-item replay bundle assembly and publish

Status: wontfix
Superseded-by: .scratch/done/ui-public-landing-replay-curation/issues/09-versioned-replay-contract-and-projection.md

## Parent

- .scratch/done/ui-public-landing-replay-curation/PRD.md

## What to build

Deliver end-to-end assembly and publish of one eligible Run into a replay-safe bundle item for the Landing Replay Playlist. The bundle must include channels needed for the four-phase experience: starfield, matched ORB points, Route Photo context, and transformed Skeleton for Route Overlay playback.

## User stories covered

- 16, 17, 18, 19, 24

## Acceptance criteria

- [ ] One eligible run can be transformed into a schema-valid replay bundle item.
- [ ] Bundle item includes all phase-required channels in replay-safe form.
- [ ] Single-item publish path can activate a playlist containing the item via guarded publisher flow.
- [ ] Reader path can consume the resulting item without fallback.
- [ ] Tests validate bundle contract shape and end-to-end single-item publish/read behavior.

## Blocked by

- .scratch/done/ui-public-landing-replay-curation/issues/02-secure-publisher-gate-and-atomic-manifest-swap.md
- .scratch/done/ui-public-landing-replay-curation/issues/03-curation-preflight-eligibility-fixed-capture-route-photo-starfield.md

## Superseded notes

Single-item assembly remains, but runtime publish activation is removed. Contract/projection now live in issue 09 and authoring flow in issue 11.
