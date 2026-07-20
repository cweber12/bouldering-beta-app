# PRD: Route Map Interaction Reliability and Outdoor Visual Refresh

Status: ready-for-agent

## Problem Statement

Users exploring Routes and Runs on the map experience unstable interaction behavior and inconsistent visual context.

The current map can fail to pan on click-and-drag in some sessions, and map zoom can unexpectedly snap back after selecting a Route from a pin interaction. This breaks trust in map navigation and makes reviewing GPS-tagged Runs feel unpredictable.

At the same time, the current basemap does not fully match the product's technical outdoor identity. Users want a clean, professional map look optimized for climbing context while keeping load time low and staying on free data sources.

There is also uncertainty about whether additional external map datasets should be ingested. Without a clear decision, the project risks taking on heavy data overhead without meaningful user value.

## Solution

Ship a focused map reliability and styling pass in two stages.

First, stabilize map interaction behavior so drag-to-pan and zoom persistence behave predictably during Route discovery.

Second, adopt an outdoor-focused basemap presentation with automatic fallback behavior, while preserving the current climbing-specific overlay strategy that already filters to relevant climbing places.

The end result is a map experience that is reliable, visually aligned with the app's outdoor technical tone, and constrained to low operational overhead and free-tier-friendly usage.

## User Stories

1. As a climber reviewing my Routes, I want click-and-drag panning to always work, so that I can navigate areas naturally.
2. As a climber selecting a Route pin, I want the map to keep my current zoom level unless I explicitly recenter, so that I do not lose context.
3. As a climber exploring nearby Runs, I want pin selection to keep me in map mode, so that I can continue geographic exploration without mode switching.
4. As a climber, I want map auto-fit to happen only when data actually changes, so that the map does not fight my manual navigation.
5. As a climber browsing dense areas, I want clustered pins to remain responsive while panning and zooming, so that map interaction feels smooth.
6. As a climber using mobile touch input, I want drag gestures and map taps to be interpreted correctly, so that interactions are reliable on phones.
7. As a climber toggling nearby climbing places, I want climbing-specific points to appear without cluttering the map, so that I can focus on useful context.
8. As a climber, I want nearby climbing overlays to load only when zoomed in enough, so that performance stays fast and the map stays readable.
9. As a climber, I want the default map style to look like a professional outdoor navigation surface, so that the app feels purpose-built for climbing.
10. As a climber, I want the map style to harmonize with the app theme, so that the interface looks cohesive.
11. As a climber, I want map popups and controls to remain legible in both dark and light theme modes, so that readability stays high.
12. As a climber, I want the map to still load if the preferred tile provider is unavailable, so that map browsing never becomes a dead end.
13. As a climber, I want my Route and Run Type context to stay clear in pin visuals, so that I can quickly distinguish Attempts and Sends.
14. As a product owner, I want map improvements that do not noticeably slow initial map loading, so that UX remains snappy.
15. As a product owner, I want to avoid unnecessary large dataset ingestion, so that operational cost and maintenance stay low.
16. As a maintainer, I want map viewport updates to be deterministic and driven by explicit conditions, so that regressions are easier to prevent.
17. As a maintainer, I want map interaction code to separate marker updates from viewport-fit logic, so that behavior remains predictable.
18. As a maintainer, I want callback-driven map effects to be stable across renders, so that selection state changes do not trigger unintended zoom changes.
19. As a maintainer, I want a provider fallback strategy that requires minimal manual intervention, so that reliability is maintained in production.
20. As a maintainer, I want climbing POI enrichment to remain bounded and cache-aware, so that repeated panning does not trigger excessive network churn.
21. As a QA engineer, I want explicit behavior checks for pan, zoom persistence, pin selection, and overlay toggles, so that user-facing regressions are caught early.
22. As a QA engineer, I want fallback behavior validated for missing keys and provider failures, so that outage scenarios are covered.
23. As a future contributor, I want a clear decision record on why heavy external dataset ingestion was deferred, so that future map work starts from the right assumptions.
24. As a future contributor, I want map decisions framed around Route discovery and Run review workflows, so that enhancements remain aligned with core product value.

## Implementation Decisions

- Keep the current map engine and interaction model for this increment, and prioritize behavioral correctness over a full rendering stack migration.
- Treat map interaction stability as the blocking workstream: pan reliability and zoom persistence are solved before stylistic upgrades.
- Separate map marker synchronization from viewport-fit behavior, so marker updates do not implicitly trigger camera resets.
- Define auto-fit as a policy: it runs on first load and true pin-set changes, not on selection changes or callback identity churn.
- Keep map pin selection map-first by default: selecting a Route via map interaction should not force a list-mode transition.
- Preserve Route and Run Type semantic pin distinctions so attempt/send scanning remains fast and visually consistent.
- Use an outdoor-oriented basemap as the preferred visual profile, but keep an automatic fallback provider path to guarantee map availability.
- Keep climbing-specific POI filtering on the existing climbing overlay query strategy instead of attempting uncertain direct filtering from general basemap POIs.
- Add lightweight bounds-key caching for climbing overlay fetches to reduce repeated requests during local pan/zoom activity.
- Constrain the map visual refresh to free-tier-friendly provider usage and avoid introducing paid-only dependencies.
- Do not ingest the provided external style bundle and regional geocoding archive in this PRD scope; defer until a measured product need exists.
- Extract or formalize a deep viewport policy module that encapsulates when map view should fit, recenter, or remain user-controlled behind a simple interface.
- Extract or formalize a provider selection module that encapsulates preferred-provider selection plus fallback behavior behind a stable map bootstrap contract.
- Keep geocoding and map overlays decoupled so map presentation upgrades do not force geocoding infrastructure changes.
- Keep this work focused on Route discovery and map interaction surfaces; avoid crossing into unrelated scan pipeline behavior.

## Testing Decisions

- Good tests assert external map behavior from the user perspective: panning works, zoom does not unexpectedly reset, and pin selection behaves consistently.
- Avoid testing implementation details such as internal effect ordering, internal refs, or specific transient state transitions.
- Add behavior tests for viewport policy: first-load fit, pin-set-change fit, and no-fit on mere selection changes.
- Add behavior tests for stable pin selection callbacks so state updates do not trigger unintended viewport resets.
- Add behavior tests for map-mode handling on pin click so map-first exploration behavior is preserved.
- Add behavior tests for climbing overlay toggles and zoom-threshold gating so overlay visibility and interaction remain predictable.
- Add fallback behavior tests for preferred basemap unavailable scenarios, including missing key and runtime tile failures.
- Use existing component and hook testing patterns already used in the codebase as prior art, with map internals mocked at module boundaries where needed.
- Keep manual verification as part of acceptance for desktop and mobile interactions because map gesture handling includes browser/runtime nuances.

## Out of Scope

- A full migration to a new map rendering engine.
- Building a local geocoding infrastructure from regional archive datasets.
- Ingesting large external style or geocoding data bundles into runtime flows.
- Reworking account/profile architecture, Route storage schema, or scan/detection pipelines.
- Expanding into non-climbing POI enrichment beyond the climbing-specific overlay strategy.
- Redesigning unrelated pages or non-map navigation patterns.

## Further Notes

- The map reliability pass is intentionally sequenced before visual upgrades because interaction trust is a prerequisite for map style value.
- Existing domain behavior around Route and Run presentation remains unchanged; this PRD improves map exploration reliability and visual clarity, not route semantics.
- Documentation for map provider details should be reconciled during implementation if any existing product docs describe outdated tile sources.
- If future usage metrics justify it, deferred dataset ingestion can be revisited under a separate PRD with explicit performance and operational targets.
