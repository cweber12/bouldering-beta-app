# Author the climb end in the Ground Truth review; retire the dedicated sweep

Status: ready-for-agent
Type: interactive

## Parent

- `.scratch/actionable/dev-harness-review-surfaces/PRD.md`
- Depends on: issue 04 (the review must be a browse surface first)
- Supersedes the sweep built by
  `.scratch/actionable/harness-contract-adr0007-adoption/issues/02-end-of-climb-capture-gesture.md`

## What to build

The end-of-climb marker has its own corpus-wide sequence — `ClimbEndSweeper`,
reached from the **Mark ends** batch button — separate from the review where the
same operator is already looking at the same frames of the same Bundle. Collapse
the two: mark the end where the truth is reviewed, and delete the sweep.

### Move the control

The `Climb end` button and the `ClimbEndEditor` modal move from the Calibrator's
seed-tap screen onto the Ground Truth review screen. The editor itself is
unchanged and stays presentational; the commit path is unchanged too —
`saveClimbEnd`, an off-hash merging `PUT` that leaves `setupHash` byte-identical
so no run goes stale and no truth is orphaned.

### Delete the sweep

- `components/dev/ClimbEndSweeper.tsx`
- `planClimbEndSweep` and `ClimbEndPlan` from `utils/harnessClimbWindow.ts`
- the **Mark ends** header button and the `climbEndPlan` branch in
  `app/dev/harness/page.tsx`
- `__tests__/components/dev/ClimbEndSweeper.test.tsx`

Keep everything the editor still needs: `checkClimbEnd`,
`snapToDetectionFrame`, `detectionFrameWindow`, `formatClimbWindow`,
`CLIMB_WINDOW_UNMARKED`, and the `climb` column on the corpus table.

### The `window-moved` state

Moving the marker into the review creates a real ordering problem that must not
be papered over.

The ViTPose job windows its tracking history *before* stitching the climber
track, and skips posing any frame outside the window — those come back
seeded-absent. So the climb window genuinely shapes Ground Truth content. The
scanner's own `harnessScoring.ts`, by contrast, never references the window at
all. Marking an end from the review therefore lands *after* the truth it would
have shaped, and that truth does not change until the Bundle is re-seeded.

Derive the mismatch honestly rather than assuming it:

- The job already writes `climbWindow: { start, end }` into `vitpose.json`
  whenever either bound was supplied. Add the optional field to
  `ViTPoseScaffold` in `utils/harnessViTPose.ts` and compare it against the
  Bundle's current window from `setup.json`.
- A differing window means truth predates its current bounds. An **absent**
  `climbWindow` alongside a set `climbEnd` means the same thing — every artifact
  currently on disk predates the field, so absent-plus-set is the common case,
  not an edge case.

Surface it as a corpus-list badge and a review-screen banner, and fold those
Bundles into the existing **Re-seed** sweep population in
`utils/harnessReseed.ts` so the backlog is worked exactly the way stale truth
already is. Do not auto-re-seed: a ViTPose job per marker tweak makes prev/next
browsing unusable, and the whole point of the off-hash marker is that writing it
is cheap.

## Design notes

- This is the decision the new ADR in issue 06 records. Three options were
  genuinely available — mark-then-flag, re-seed-on-mark, and treat the window as
  scoring-only — and the third contradicts the job's actual behaviour, since a
  truth seeded with a window and one seeded without are different artifacts.
- Retiring a sweep shipped days earlier needs to read as deliberate. Note the
  supersession in the ADR-0007-adoption PRD and in its issue 02, per the
  tracker's supersession convention.
- A Bundle that has never been seeded can no longer get its window before its
  first ViTPose job. That is accepted: an unmarked window is not an error state
  — the harness reads it as open and behaves as it does today — and the
  `window-moved` state plus the Re-seed sweep is the path that closes it.

## Acceptance criteria

- [ ] The climb end can be set, changed and cleared from the Ground Truth
      review, against the video frame being marked.
- [ ] Setting it leaves `setupHash` unchanged and run counts undisturbed.
- [ ] A marker at or before the climb start is rejected with a reason, not
      clamped.
- [ ] `ClimbEndSweeper`, `planClimbEndSweep` and the **Mark ends** button are
      gone, and nothing references them.
- [ ] The `climb` column and the editor's remaining helpers still work.
- [ ] A Bundle whose `vitpose.json` `climbWindow` differs from — or is absent
      alongside — a set `climbEnd` reads `window-moved` in the corpus list and
      in the review.
- [ ] Those Bundles appear in the Re-seed sweep population.
- [ ] No marker change triggers an automatic ViTPose job.
- [ ] Semantic colour tokens only; dismiss seams use the shared hooks/Modal.
      No `any`.

## Tests

- Extend `__tests__/utils/harnessClimbWindow.test.ts` for the removals and
  `__tests__/utils/harnessViTPose.test.ts` for the `climbWindow` field.
- New pure coverage for the `window-moved` predicate, including the
  absent-`climbWindow`-plus-set-`climbEnd` case.
- Extend `__tests__/utils/harnessReseed.test.ts` for the widened population.
