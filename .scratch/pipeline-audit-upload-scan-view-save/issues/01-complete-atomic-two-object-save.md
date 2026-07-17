# Complete Atomic Two-Object Save Semantics

Status: done
Branch: main
Merged: fdcc6bd
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Complete the storage-split increment so saving a run is fail-closed. Treat the
metadata object as the commit marker by writing heavy run data first and metadata
last. If heavy data write fails, the run must remain invisible in user listings.
On read, detect split-run metadata that cannot load its heavy sibling and raise a
clear error instead of returning an incomplete attempt.

## Acceptance criteria

- [x] Save ordering uses data-first and metadata-last semantics for split-run writes.
- [x] Partial save failure does not surface a list-visible run that cannot be opened.
- [x] Split-run read path throws a clear, actionable error when required heavy data is missing or invalid.
- [x] Behavior is covered by targeted tests for write ordering and download guardrails.

## Blocked by

None - can start immediately

## Comments

- 2026-07-17 (tracker audit): closed retroactively — landed in fdcc6bd (workstream A). Data-first write order + explicit heavy-data load guard verified in hooks/useS3Storage.ts.
