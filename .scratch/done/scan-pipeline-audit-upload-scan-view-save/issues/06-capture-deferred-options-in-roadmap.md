# Capture Deferred Pipeline Options in Roadmap

Status: done
Branch: main
Merged: b5e3d64
Type: AFK

## Parent

- `.scratch/done/scan-pipeline-audit-upload-scan-view-save/PRD.md`

## What to build

Record the explicitly deferred options from the pipeline audit in the roadmap so
future work is discoverable and intentionally scoped. Include recompute-on-load,
coarse-to-fine match refinement, and requestVideoFrameCallback-driven scan loop as
tracked follow-ups with clear trigger conditions.

## Acceptance criteria

- [x] Roadmap contains all three deferred options from the audit with concise rationale.
- [x] Each deferred item includes a practical trigger/condition for reconsideration.
- [x] Deferred items are documented as out-of-scope for the current hardening increment.

## Blocked by

None - can start immediately

## Comments

- 2026-07-17 (tracker audit): closed retroactively — landed in b5e3d64 (workstream C). docs/roadmap.md captures five deferrals (the original three plus the two pose-addendum ones), exceeding the three required here.
