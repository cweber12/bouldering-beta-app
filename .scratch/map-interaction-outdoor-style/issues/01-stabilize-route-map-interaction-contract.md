# Stabilize Route Map Interaction Contract

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/map-interaction-outdoor-style/PRD.md`

## What to build

Deliver a stable, map-first Route discovery experience in the Routes surface so map navigation stops fighting user intent.

The slice should make click-drag pan behavior reliable and enforce deterministic viewport behavior during Route pin interactions. Auto-fit should happen only on first load and true pin-set changes, not on selection churn. Selecting a Route pin should keep the user in map context instead of forcing a list-mode switch.

The result should be a demoable interaction contract where manual pan/zoom remains in control after pin selection, while first-load discoverability is preserved.

## Acceptance criteria

- [ ] Click-drag panning is reliable on the Routes map surface across desktop and mobile gesture paths.
- [ ] Viewport auto-fit runs on first load and true pin-set changes, and does not run on selection-only state updates.
- [ ] Selecting a Route pin keeps the user in map mode and does not force list-mode transition.
- [ ] Map interactions no longer trigger unexpected zoom snap-back during normal Route selection flows.
- [ ] Behavior-focused tests verify pan reliability and viewport policy boundaries from the user perspective.

## Blocked by

None - can start immediately.
