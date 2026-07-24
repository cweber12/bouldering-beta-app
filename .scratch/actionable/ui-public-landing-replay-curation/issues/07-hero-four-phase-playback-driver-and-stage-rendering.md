# 07 - Hero four-phase playback driver and stage rendering

Status: ready-for-agent

## Parent

- .scratch/actionable/ui-public-landing-replay-curation/PRD.md

## What to build

Deliver deterministic four-phase replay rendering for a published bundle item. The playback driver should emit phase-aware progression and fade envelopes, and the stage renderer should compose channels to match fixed timing windows and transition behavior.

## User stories covered

- 16, 17, 18, 19, 21, 25

## Acceptance criteria

- [ ] Playback phases follow fixed windows at 0-45, 45-62, 62-80, and 80-100 percent.
- [ ] Channel visibility and fades match intended sequence across all four phases.
- [ ] Route Overlay transformed Skeleton plays correctly in late phases.
- [ ] Visual behavior is deterministic for repeated runs of the same replay item.
- [ ] Tests assert phase boundary behavior and channel composition outcomes.

## Blocked by

- .scratch/actionable/ui-public-landing-replay-curation/issues/05-single-item-replay-bundle-assembly-and-publish.md
