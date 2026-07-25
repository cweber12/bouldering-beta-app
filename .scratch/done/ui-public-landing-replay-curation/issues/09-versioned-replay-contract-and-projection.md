# 09 - Versioned replay contract and projection

Status: wontfix
Superseded-by: .scratch/done/ui-public-landing-replay-curation/issues/15-replay-clip-contract-and-authoring-export.md

## Parent

- .scratch/done/ui-public-landing-replay-curation/PRD.md

## What to build

Define and implement the v1 checked-in replay artifact contract and projection path for curated landing playback items. This slice establishes the canonical public data shape, strict parsing rules, and deterministic projection from authoring inputs into replay-safe channels.

## User stories covered

- Contract authority for public playlist artifacts.
- Deterministic projection of replay channels for fixed phase playback.
- Privacy-safe export surface for portfolio delivery.

## Acceptance criteria

- [ ] Define a strict root contract with `version`, `defaultItemId`, and an ordered `items` array (1-5 items).
- [ ] Define item contract with required `area`, Route name, `rating`, video/photo aspect metadata, compressed Route Photo payload, starfield points, paired source/photo ORB points, and timestamped source/projected keypoint poses.
- [ ] Projection path from source run + rematch result is deterministic and preserves temporal ordering and endpoints.
- [ ] Public contract excludes private/source fields (user identity, notes, coordinates, source keys, descriptors, homography matrix, run metadata not approved for display).
- [ ] Parser is version-aware and rejects unsupported root versions safely.
- [ ] Runtime item validation can reject malformed items independently without crashing contract load.
- [ ] Tests cover parse success/failure, projection determinism, field exclusion, and malformed item handling.

## Blocked by

None - can start immediately

## Superseded notes

Replaced by issue 15, which merges the contract into the authoring slice that
produces it. Version negotiation, strict version-aware parsing, and independent
malformed-item rejection are dropped: producer and consumer are the same commit
of the same repo, so a TypeScript type plus one narrow runtime guard covers the
risk. The projection requirement survives as the PRD's pure-geometry invariant.
