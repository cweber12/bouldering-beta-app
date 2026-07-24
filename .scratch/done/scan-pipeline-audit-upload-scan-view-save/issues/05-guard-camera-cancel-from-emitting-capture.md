# Prevent Cancel Teardown from Emitting Camera Capture

Status: done
Branch: main
Merged: fdcc6bd
Type: AFK

## Parent

- `.scratch/done/scan-pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Differentiate intentional stop-and-save from modal teardown so cancel, ESC, and
backdrop close paths do not emit partial captures. Gate capture emission on an
explicit user intent flag and ensure recorder teardown stops recording and media
tracks safely without advancing the scan flow.

## Acceptance criteria

- [x] Capture emission occurs only after explicit stop-and-save intent.
- [x] Cancel/ESC/backdrop close during recording does not emit a capture or advance the flow.
- [x] Modal unmount cleanup stops recorder and stream resources safely.
- [x] Manual verification confirms teardown behavior and preserved stop-and-save flow.

## Blocked by

None - can start immediately

## Comments

- 2026-07-17 (tracker audit): closed retroactively — landed in fdcc6bd (workstream A). saveIntentRef gating verified in components/capture/CameraRecorderModal.tsx.
