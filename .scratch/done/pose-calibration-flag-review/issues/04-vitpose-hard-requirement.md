# ViTPose Hard Requirement for Ground Truth Authoring

Status: done
Type: AFK
Branch: issue-04-vitpose-hard-requirement
Merged: 5b0cb1d

## Parent

- `.scratch/done/pose-calibration-flag-review/PRD.md`

## What to build

Remove the MediaPipe Ground-Truth-seed fallback. Under auto-accept, a MediaPipe-seeded truth is the detector's own output — the harness would grade MediaPipe against itself, the exact circularity ADR 0019 exists to prevent — so ViTPose becomes a hard requirement for authoring:

- When the ViTPose scaffold fails (job error, poll timeout, no climber tracked, or no downloader configured), Ground Truth review mode is disabled with a clear message and a **retry** affordance that re-requests the scaffold job for the same Detection Frame grid.
- The Detection Preview, diagnostics, and Scan Setup calibration itself remain fully usable on seed failure — only truth authoring is gated.
- The seed-source fallback logic and its "MediaPipe seed" status badge are deleted; the gating decision comes from the pure helper extracted in the scaffold-helpers slice.

## Acceptance criteria

- [x] No code path seeds Ground Truth from MediaPipe poses.
- [x] On ViTPose failure, review mode is disabled with a message and a working retry; preview and diagnostics still work.
- [x] A successful retry enables review with a fresh ViTPose seed for the same frame grid.
- [x] Covered by tests at the scaffold-helper seam (gating) and reviewer/page-adjacent component seams as applicable.

## Blocked by

- `.scratch/done/pose-calibration-flag-review/issues/03-readonly-reviewer-accept.md`
