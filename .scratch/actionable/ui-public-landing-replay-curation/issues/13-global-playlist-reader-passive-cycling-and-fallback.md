# 13 - Global playlist reader, passive cycling, and fallback

Status: wontfix
Superseded-by: .scratch/actionable/ui-public-landing-replay-curation/issues/17-playlist-cycling-curated-assets-and-docs.md

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

## Superseded notes

Replaced by issue 17. Ordered cycling and the ~300 ms handoff survive. Dropped:
the fallback asset path, per-item skip on malformed items, and the all-items-
invalid degradation ladder — the hero simply degrades to its text content. The
offscreen/hidden-tab suspension requirement moves into the single
`useReplayClock` in issue 16 rather than being specified against a clock owned
by another slice.
