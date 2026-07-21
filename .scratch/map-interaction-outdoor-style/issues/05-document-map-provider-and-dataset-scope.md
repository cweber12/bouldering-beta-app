# Document Map Provider Strategy and Dataset Scope

Status: in-progress
Type: AFK
Branch: feat/map-05-outdoor-contours-docs

## Parent

- `.scratch/map-interaction-outdoor-style/PRD.md`

## What to build

Publish documentation alignment for map behavior, provider strategy, and data-scope decisions so implementation and future planning stay consistent.

This slice should update product/engineering docs to reflect the preferred outdoor basemap strategy, automatic fallback expectations, and explicit deferral of heavyweight external dataset ingestion for this increment.

The outcome should provide a clear, durable record that this work remains free-tier-friendly and focused on Route map reliability and Run exploration value.

## Acceptance criteria

- [x] Documentation reflects the current preferred basemap and fallback behavior accurately.
- [x] Documentation explicitly records deferral of heavyweight external style/geocoding dataset ingestion for this PRD scope.
- [x] Documentation language aligns with Route/Run map workflows and avoids implying a map engine migration.

## Implementation notes

- ADR `docs/adr/0021-outdoor-contour-basemap-provider-strategy.md` records the
  preferred/fallback tiers, the theme-tint approach, and the explicit deferral of
  heavyweight style/geocoding dataset ingestion (no map-engine migration).
- README "Location & Maps" + stack table updated: fallback is now OpenTopoMap
  (contour lines), and the dark-theme tile filter is described.
- Shipped the aligned UI change: fallback basemap switched CartoDB Voyager →
  OpenTopoMap in `utils/leaflet.ts`, and a theme-aware `.leaflet-tile-pane`
  filter in `app/globals.css` darkens the tiles to the app surface in dark mode.

## Blocked by

- `.scratch/map-interaction-outdoor-style/issues/03-add-outdoor-basemap-with-fallback.md`
- `.scratch/map-interaction-outdoor-style/issues/04-keep-climbing-overlay-fast-and-bounded.md`
