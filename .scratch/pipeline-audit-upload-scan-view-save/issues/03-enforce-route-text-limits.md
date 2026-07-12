# Enforce Route Text Limits at Serialization Boundary

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Add a single serialization-boundary clamp for user-entered run metadata fields so
all save paths consistently enforce route text limits. Mirror these limits in the
metadata UI controls to provide immediate user feedback while preserving server
transport endpoint schema-agnostic behavior.

## Acceptance criteria

- [ ] Route metadata text fields are clamped to the configured route text limit during serialization.
- [ ] Metadata input controls expose matching max-length constraints for user feedback.
- [ ] Both scan and upload save paths inherit the same limit enforcement without duplicate logic.
- [ ] Targeted tests verify truncation behavior at and above the configured limit.

## Blocked by

None - can start immediately
