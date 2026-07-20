# Align Profile Map with Stable Viewport Policy

Status: in-progress
Branch: fix/map-02-align-profile-viewport-policy
Type: AFK

## Parent

- `.scratch/map-interaction-outdoor-style/PRD.md`

## What to build

Apply the same stable viewport policy and interaction contract from Routes to profile map usage so Run exploration behavior is consistent across map entry points.

The slice should ensure profile-side pin interactions do not cause camera resets from callback churn or selection updates, and preserve manual map navigation after user interaction.

This should be verifiable as a complete user-facing improvement on profile map flows without requiring the basemap styling work.

## Acceptance criteria

- [ ] Profile map pin selection no longer causes unintended viewport resets during normal interactions.
- [ ] Viewport behavior in profile map aligns with the same policy used in Routes (first-load/data-change fit only).
- [ ] Manual pan/zoom remains stable after opening climb details from map interactions.
- [ ] Behavior tests cover profile-specific map interaction regression boundaries.

## Blocked by

- `.scratch/map-interaction-outdoor-style/issues/01-stabilize-route-map-interaction-contract.md`
