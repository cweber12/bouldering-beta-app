# Prevent Cancel Teardown from Emitting Camera Capture

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Differentiate intentional stop-and-save from modal teardown so cancel, ESC, and
backdrop close paths do not emit partial captures. Gate capture emission on an
explicit user intent flag and ensure recorder teardown stops recording and media
tracks safely without advancing the scan flow.

## Acceptance criteria

- [ ] Capture emission occurs only after explicit stop-and-save intent.
- [ ] Cancel/ESC/backdrop close during recording does not emit a capture or advance the flow.
- [ ] Modal unmount cleanup stops recorder and stream resources safely.
- [ ] Manual verification confirms teardown behavior and preserved stop-and-save flow.

## Blocked by

None - can start immediately
