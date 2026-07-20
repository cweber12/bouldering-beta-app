# Add Preferred Outdoor Basemap with Automatic Fallback

Status: in-progress
Type: AFK
Branch: feat/map-03-outdoor-basemap-fallback

## Parent

- `.scratch/map-interaction-outdoor-style/PRD.md`

## What to build

Introduce a preferred outdoor basemap presentation for Route and Run map surfaces while preserving resilient map availability.

The slice should implement provider selection where an outdoor-oriented style is used when configured, and automatic fallback to the existing free provider path occurs when configuration is missing or tile access fails. The experience should remain theme-legible and operationally safe without requiring a map engine migration.

This should be demoable by toggling configured and fallback states and confirming maps remain usable in both paths.

## Acceptance criteria

- [ ] Preferred outdoor basemap is used when provider configuration is available.
- [ ] Automatic fallback keeps map surfaces usable when preferred provider configuration is absent or fails.
- [ ] Map popups/controls remain legible and coherent with app theme in both preferred and fallback states.
- [ ] Behavior tests validate fallback for missing configuration and runtime provider failure scenarios.

## Blocked by

- `.scratch/map-interaction-outdoor-style/issues/01-stabilize-route-map-interaction-contract.md`
