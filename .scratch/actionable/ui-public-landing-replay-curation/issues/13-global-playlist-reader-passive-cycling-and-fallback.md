# 13 - Global playlist reader, passive cycling, and fallback

Status: ready-for-agent

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Switch landing replay consumption to a global checked-in playlist reader with passive deterministic cycling. Apply runtime item-level validation, skip malformed items safely, and use standalone real-data fallback when playlist loading fails.

## User stories covered

- Same curated experience for all visitors.
- Resilient reader behavior under partial or full asset failure.
- Deterministic passive replay progression.

## Acceptance criteria

- [ ] Landing hero loads one global playlist asset for all visitors (no signed-in personalization path).
- [ ] On playlist fetch/parse failure, hero falls back to standalone fallback asset path.
- [ ] Runtime validation can skip malformed items while preserving valid editorial order.
- [ ] If all playlist items are invalid, hero uses fallback; if fallback also fails, hero degrades gracefully without crash.
- [ ] Item playback is deterministic: each item runs 8 seconds and hands off via an approximately 300 ms crossfade.
- [ ] Offscreen and hidden-tab states suspend the same replay clock used by pause/play.
- [ ] Tests cover successful load, item-skip behavior, fallback path, and deterministic cycling/handoff behavior.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/10-landing-four-phase-renderer-and-real-fallback.md
- .scratch/actionable/ui-public-landing-replay-curation/issues/12-playlist-assembly-and-static-export.md
