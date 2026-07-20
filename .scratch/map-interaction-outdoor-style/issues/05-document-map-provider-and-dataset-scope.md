# Document Map Provider Strategy and Dataset Scope

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/map-interaction-outdoor-style/PRD.md`

## What to build

Publish documentation alignment for map behavior, provider strategy, and data-scope decisions so implementation and future planning stay consistent.

This slice should update product/engineering docs to reflect the preferred outdoor basemap strategy, automatic fallback expectations, and explicit deferral of heavyweight external dataset ingestion for this increment.

The outcome should provide a clear, durable record that this work remains free-tier-friendly and focused on Route map reliability and Run exploration value.

## Acceptance criteria

- [ ] Documentation reflects the current preferred basemap and fallback behavior accurately.
- [ ] Documentation explicitly records deferral of heavyweight external style/geocoding dataset ingestion for this PRD scope.
- [ ] Documentation language aligns with Route/Run map workflows and avoids implying a map engine migration.

## Blocked by

- `.scratch/map-interaction-outdoor-style/issues/03-add-outdoor-basemap-with-fallback.md`
- `.scratch/map-interaction-outdoor-style/issues/04-keep-climbing-overlay-fast-and-bounded.md`
