# Bound Scan Seek Operations with Timeout and Abort Race

Status: done
Branch: main
Merged: fdcc6bd
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Harden the scan loop so each media seek either completes, times out, or exits on
abort. Apply the same seek guard behavior in both primary scan iterations and
gap-recovery iterations so processing cannot hang indefinitely on missing seeked
events or throttled media behavior.

## Acceptance criteria

- [x] Each seek operation races completion against timeout and abort signals.
- [x] Scan reset/cancel interrupts in-flight processing promptly instead of waiting for unresolved seek events.
- [x] Both main scan and recovery seek paths share the bounded behavior.
- [x] Targeted tests cover timeout handling, abort handling, and guaranteed loop termination/progress.

## Blocked by

None - can start immediately

## Comments

- 2026-07-17 (tracker audit): closed retroactively — landed in fdcc6bd (workstream A). seekVideo timeout/abort race verified in utils/videoSeek.ts, used by both scan loops in useVideoProcessor.
