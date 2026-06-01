# Bound Scan Seek Operations with Timeout and Abort Race

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Harden the scan loop so each media seek either completes, times out, or exits on
abort. Apply the same seek guard behavior in both primary scan iterations and
gap-recovery iterations so processing cannot hang indefinitely on missing seeked
events or throttled media behavior.

## Acceptance criteria

- [ ] Each seek operation races completion against timeout and abort signals.
- [ ] Scan reset/cancel interrupts in-flight processing promptly instead of waiting for unresolved seek events.
- [ ] Both main scan and recovery seek paths share the bounded behavior.
- [ ] Targeted tests cover timeout handling, abort handling, and guaranteed loop termination/progress.

## Blocked by

None - can start immediately

