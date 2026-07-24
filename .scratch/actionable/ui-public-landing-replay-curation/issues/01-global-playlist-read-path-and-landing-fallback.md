# 01 - Global playlist read path and landing fallback

Status: ready-for-agent

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Deliver an end-to-end landing replay read path for a versioned public Landing Replay Playlist while preserving resilient fallback to the bundled default replay asset. This slice establishes the public contract consumption path in the hero experience and ensures signed-in and signed-out visitors receive deterministic behavior when the public playlist is present or unavailable.

## User stories covered

- 13, 15, 20, 28

## Acceptance criteria

- [ ] Landing replay attempts to load the public Landing Replay Playlist contract first and uses it when valid.
- [ ] On fetch, parse, or validation failure, landing replay falls back to the bundled default replay without breaking hero playback.
- [ ] Contract parsing is version-aware and rejects unsupported versions safely.
- [ ] Behavior is consistent for authenticated and unauthenticated visitors.
- [ ] Tests cover success and fallback paths as observable behavior.

## Blocked by

None - can start immediately
