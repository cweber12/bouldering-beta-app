# Review Affordances: Filmstrip Marks, Counts, Staleness Notice

Status: done
Branch: feat/cfr-05-review-affordances
Merged: 8f1257c
Type: AFK

## Parent

- `.scratch/done/pose-calibration-flag-review/PRD.md`

## What to build

Make the review pass navigable and honest about what one-click acceptance commits:

- The filmstrip stepper marks human-flagged frames (Wrong / Absent) and seeded-absent frames distinctly from ordinary auto frames, so the author can jump straight to the frames worth a second look.
- The accept button surfaces the seed coverage as a count — "N posed · M seeded absent" — sourced from the pure counting helper. Surfaced only: accepting is never blocked or double-confirmed (auto-absent frames are agreement-tier evidence; the harness knows).
- When re-calibration discarded prior truth because the `setupHash` changed (or the prior truth predated hashes), the review UI shows a "prior truth discarded (setup changed)" notice driven by the discard signal from the staleness helper.

## Acceptance criteria

- [ ] Flagged and seeded-absent frames are visually distinct from auto frames on the filmstrip.
- [ ] The posed / seeded-absent counts render beside the accept button and update as flags change presence truth.
- [ ] The stale-discard notice appears exactly when prior truth was dropped for a setup change, and not on a clean first authoring.
- [ ] Covered by tests at the stepper/reviewer component seams.

## Blocked by

- `.scratch/done/pose-calibration-flag-review/issues/03-readonly-reviewer-accept.md`
