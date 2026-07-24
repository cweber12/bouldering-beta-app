# Enforce Route Text Limits at Serialization Boundary

Status: done
Branch: main
Merged: fdcc6bd
Type: AFK

## Parent

- `.scratch/done/scan-pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Add a single serialization-boundary clamp for user-entered run metadata fields so
all save paths consistently enforce route text limits. Mirror these limits in the
metadata UI controls to provide immediate user feedback while preserving server
transport endpoint schema-agnostic behavior.

## Acceptance criteria

- [x] Route metadata text fields are clamped to the configured route text limit during serialization.
- [x] Metadata input controls expose matching max-length constraints for user feedback.
- [x] Both scan and upload save paths inherit the same limit enforcement without duplicate logic.
- [x] Targeted tests verify truncation behavior at and above the configured limit.

## Blocked by

None - can start immediately

## Comments

- 2026-07-17 (tracker audit): closed retroactively — landed in fdcc6bd (workstream A). ROUTE_TEXT_LIMIT clamp verified in utils/fsHelpers.ts + MetadataBottomSheet maxLength.
