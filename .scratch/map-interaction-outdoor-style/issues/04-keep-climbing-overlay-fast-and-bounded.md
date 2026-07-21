# Keep Climbing Overlay Fast and Bounded

Status: in-progress
Branch: fix/issue-04-bounded-nearby-overlay
Type: AFK

## Parent

- `.scratch/map-interaction-outdoor-style/PRD.md`

## What to build

Harden the climbing-specific nearby overlay so it stays relevant, responsive, and bounded under real map navigation.

The slice should preserve climbing-only enrichment behavior with strict zoom gating and bounded query repetition during local pan/zoom movement. Overlay fetch behavior should be cache-aware and should not interfere with core map pan/zoom responsiveness.

This should be independently verifiable by toggling nearby climbing overlay across zoom levels and panning within and across bounded areas.

## Acceptance criteria

- [ ] Nearby climbing overlay appears only at intended zoom thresholds and hides cleanly below threshold.
- [ ] Repeated pan/zoom within equivalent bounds does not trigger redundant overlay fetch churn.
- [ ] Overlay toggling and updates do not degrade map interaction responsiveness.
- [ ] Behavior tests cover zoom gating and bounded query behavior.

## Blocked by

- `.scratch/map-interaction-outdoor-style/issues/01-stabilize-route-map-interaction-contract.md`
