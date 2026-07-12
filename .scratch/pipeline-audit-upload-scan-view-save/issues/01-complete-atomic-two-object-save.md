# Complete Atomic Two-Object Save Semantics

Status: ready-for-agent
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

- [ ] Save ordering uses data-first and metadata-last semantics for split-run writes.
- [ ] Partial save failure does not surface a list-visible run that cannot be opened.
- [ ] Split-run read path throws a clear, actionable error when required heavy data is missing or invalid.
- [ ] Behavior is covered by targeted tests for write ordering and download guardrails.

## Blocked by

None - can start immediately
