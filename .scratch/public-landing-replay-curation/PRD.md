# PRD: Public Landing Replay Curation

Status: ready-for-agent

## Problem Statement

The landing page replay currently relies on a single baked demo and cannot be curated as a global, rotating set of high-quality Runs. Maintainers need a dedicated workflow to select multiple existing Runs, publish them as a shared Landing Replay Playlist, and render a richer transition from scan-space x-ray signals to Route Overlay context.

## Solution

Create a dev-only Landing Replay Curation workflow where an allowlisted publisher can select and manually order multiple existing Fixed Capture Runs, validate eligibility, and atomically publish a global public playlist bundle. The landing hero reads this playlist first and falls back to the baked default asset when unavailable.

Each replay item follows fixed phase timing:

1. 0-45%: starfield + video-space Skeleton
2. 45-62%: starfield fades to matched ORB points
3. 62-80%: Route Photo + matched points + transformed Skeleton
4. 80-100%: matched points fade out, transformed Skeleton completes over Route Photo

## User Stories

See the issue slices in `.scratch/public-landing-replay-curation/issues/` for execution-ready, independently grabbable vertical stories.

## Implementation Decisions

- Global Landing Replay Playlist shared by all visitors.
- Manual multi-select curation on a dedicated dev page.
- Atomic full replacement on publish.
- Existing scanned Runs as the only curation source for v1.
- Fixed Capture only for v1.
- Route Photo required for every selected run.
- Publisher policy: authenticated allowlisted UID and development-only publish gate.
- Fixed editorial order with manual reordering.
- Fixed phase timing percentages in v1.

## Testing Decisions

- Verify external behavior and contracts, not internal implementation details.
- Add focused tests for eligibility checks, publish auth and atomicity, playback phase boundaries, and deterministic item cycling.

## Out of Scope

- Panning Capture support.
- Randomized playlist order.
- Per-item custom timing controls.
- Production publish enablement in v1.

## Further Notes

- Keep fallback behavior to bundled default replay for resilience.
- Reserve additive schema headroom for optional timing overrides in future versions.
