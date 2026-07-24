# 0021 — Outdoor contour basemap: preferred provider, free fallback, deferred datasets

Date: 2026-07-21
Status: accepted

## Context

Route discovery and Run review both lean on the Leaflet map (`ClimbsMap`,
`MapPicker`, shared bootstrap in `utils/leaflet.ts`). The PRD
`.scratch/done/map-interaction-outdoor-style/PRD.md` asks the map to look like a
"professional outdoor navigation surface" that "harmonizes with the app theme",
while staying free-tier friendly and avoiding a map-engine migration.

Two forces pull against each other:

1. **Outdoor identity.** A climbing app wants topographic context — contour
   lines and terrain shading — not a flat street basemap. The previous fallback,
   CartoDB Voyager, is a clean street style with **no contours**, and most
   deployments run without a preferred-provider key, so the no-key path was the
   one users actually saw.
2. **Reliability and cost.** The preferred provider must be optional, the map
   must never dead-end when it is absent or failing, and we do not want to take
   on paid-only dependencies or heavyweight data ingestion for this increment.

There was also standing uncertainty (PRD user story 15, 23) about whether to
ingest large external style bundles or a regional geocoding archive to drive the
map. Without a decision on record, future map work risks re-litigating it.

## Decision

**Two contour-bearing tiers, selected at bootstrap.**

- **Preferred:** MapTiler Outdoor (`outdoor-v2`), used when
  `NEXT_PUBLIC_MAPTILER_KEY` is configured. Ships contour lines and hillshading.
- **Fallback:** OpenTopoMap (`https://{s}.tile.opentopomap.org/...`), a free
  topographic style that _also_ carries contour lines. It replaces CartoDB
  Voyager as the free path so the outdoor identity survives the no-key and
  runtime-tile-failure cases, not just the keyed one. Native tiles stop at z17;
  the layer sets `maxNativeZoom: 17` / `maxZoom: 19` so Leaflet upscales past the
  native limit and the basemap never blanks out relative to the z19 marker layer.

`resolveBasemapSelection()` picks the tier; `attachBasemapWithFallback()` swaps
preferred → fallback on the first `tileerror`. This keeps the existing bootstrap
contract — no new map engine, no `react-leaflet` migration.

**Theme harmonisation via a CSS tile filter, not restyled vector tiles.**
Both tiers ship light, high-chroma raster tiles. Rather than author custom
vector styles (paid/heavyweight), a filter on `.leaflet-tile-pane`
(`app/globals.css`) tones the tiles toward the warm-charcoal app surface in dark
mode and relaxes to a near-natural render under `.theme-light`. Only the tile
pane is filtered; markers, popups, and controls live in sibling panes and keep
full colour and legibility. This is the smallest change that satisfies "colors
darker and aligned with the theme" without touching the provider pipeline.

**Climbing POIs stay on the existing overlay strategy.** The nearby-crags
overlay keeps querying Overpass on the climbing-specific query with bounds-key
caching (unchanged). We do not attempt to derive climbing POIs from basemap
tiles.

## Deferred (explicitly out of scope for this PRD)

- **No heavyweight external style bundle ingestion.** We do not import the
  provided external style bundle into the runtime; theme cohesion is achieved
  with the CSS tile filter instead.
- **No regional geocoding archive ingestion.** Geocoding stays on Nominatim
  (forward/reverse, no key). Building local geocoding infrastructure from a
  regional archive is deferred until a measured product need exists.
- **No map-engine migration.** Leaflet + raster tiles remain; a vector/WebGL
  rendering stack is out of scope.

Revisit under a separate PRD only if usage metrics justify the operational and
maintenance cost, with explicit performance targets.

## Consequences

- The outdoor, contour-lined look is guaranteed in both the keyed and free
  paths, and reads as part of the dark UI without per-provider style authoring.
- OpenTopoMap's usage policy (fair-use, attribution required) applies to the
  free path; attribution is carried on the tile layer. Its tiles can be slower
  than a CDN street style — acceptable for a fallback, and the preferred key
  path avoids it entirely.
- Theme cohesion is a raster filter, so it cannot restyle individual map
  features (e.g. recolour water); if that fidelity is ever required it becomes a
  vector-tile decision, i.e. a new ADR.
- The dataset-deferral is now a durable record, so future map work starts from
  "free-tier, Route/Run-focused" rather than re-opening the ingestion question.
