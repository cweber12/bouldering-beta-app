# PRD: Public Landing Replay Curation

Status: ready-for-agent
Disposition: actionable

## Problem Statement

The landing replay currently mixes a bundled demo path with signed-in user sampling and does not provide a deterministic, portfolio-grade public sequence. We need a private maintainer workflow that turns known-good Runs into checked-in replay artifacts while keeping the public hero stable, passive, and resilient.

## Solution

Replace runtime publishing with static artifact delivery:

1. Build curated replay items in a hidden development-only authoring workspace.
2. Export a versioned global playlist asset plus a standalone real-data fallback asset.
3. Check those assets into the repo and deliver through normal deployment.
4. Render a four-phase 8-second visual story per item in fixed editorial order on the landing hero.

Each replay item follows fixed phase timing:

1. 0-45%: starfield + video-space Skeleton
2. 45-62%: starfield fades while matched source points emerge
3. 62-80%: Route Photo appears while ORB and Skeleton morph toward Route Overlay
4. 80-100%: matched points fade out while Route Overlay Skeleton completes

## User Stories

See issue slices 09-14 in `.scratch/actionable/ui-public-landing-replay-curation/issues/`.

## Branch and Start Order

Use one issue per branch, branched from `main`, in this order:

1. Start issue 09 first.
	Branch: `feat/landing-replay-contract-projection`
2. Start issues 10 and 11 after issue 09 lands.
	Branches: `feat/landing-replay-renderer` and `feat/landing-replay-authoring-workspace`
3. Start issue 12 after issue 11 lands.
	Branch: `feat/landing-replay-static-export`
4. Start issue 13 after both issues 10 and 12 land.
	Branch: `feat/landing-replay-reader-cycling`
5. Start issue 14 after issue 13 lands.
	Branch: `docs/landing-replay-curation-qa`

Dependency summary:

- 09 has no blockers.
- 10 blocked by 09.
- 11 blocked by 09.
- 12 blocked by 11.
- 13 blocked by 10 and 12.
- 14 blocked by 13.

## Implementation Decisions

- One global playlist for all visitors. Remove signed-in personalized landing replay behavior.
- Curation is private maintainer tooling, not a user-facing product surface.
- No runtime publish endpoint, no allowlist role, no atomic manifest swap.
- Source material is maintainer-owned, known-good Fixed Capture Runs.
- Route Photo is reattached during authoring and embedded in export as compressed WebP data.
- Playlist contains 1-5 manually ordered items with one designated fallback item.
- Public labels include only `area`, Route name, and `rating`.
- Hero is passive: no previous/next navigation; include a minimal pause/play control for motion compliance.
- Reduced motion starts on a static final Route Overlay frame.

## Testing Decisions

- Verify contract parsing, projection correctness, privacy-safe export shape, and deterministic phase timing.
- Verify pause/play freezes and resumes the full replay clock without jumps.
- Verify item-skip fallback logic and real-data fallback resilience.
- Verify private authoring flow (window selection, photo rematch, approval, export).

## Out of Scope

- Panning Capture support.
- Cross-user curation.
- Runtime/admin publish APIs and UID allowlists.
- Randomized order and per-item timing overrides.
- Generalized replay quality scoring.
- Previous/next item navigation controls.

## Further Notes

- Keep schema versioning explicit and strict at the root contract.
- Leave shared scan loading renderer behavior stable; use landing-specific rendering where needed.
- Keep old issue slices for traceability with `wontfix` + `Superseded-by` pointers.
