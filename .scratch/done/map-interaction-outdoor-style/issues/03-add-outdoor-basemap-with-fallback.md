# Add Preferred Outdoor Basemap with Automatic Fallback

Status: done
Type: AFK
Branch: feat/map-03-outdoor-basemap-fallback
Merged: 495795e676b8659aead70f065104c447a2b40d3e

## Parent

- `.scratch/done/map-interaction-outdoor-style/PRD.md`

## What to build

Introduce a preferred outdoor basemap presentation for Route and Run map surfaces while preserving resilient map availability.

The slice should implement provider selection where an outdoor-oriented style is used when configured, and automatic fallback to the existing free provider path occurs when configuration is missing or tile access fails. The experience should remain theme-legible and operationally safe without requiring a map engine migration.

This should be demoable by toggling configured and fallback states and confirming maps remain usable in both paths.

## Acceptance criteria

- [x] Preferred outdoor basemap is used when provider configuration is available.
- [x] Automatic fallback keeps map surfaces usable when preferred provider configuration is absent or fails.
- [x] Map popups/controls remain legible and coherent with app theme in both preferred and fallback states.
- [x] Behavior tests validate fallback for missing configuration and runtime provider failure scenarios.

## Blocked by

- `.scratch/done/map-interaction-outdoor-style/issues/01-stabilize-route-map-interaction-contract.md`
