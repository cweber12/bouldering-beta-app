# Scratch Roadmap

This file is the source of truth for priority and implementation sequence across
PRDs. PRD-local `Status:` tracks lifecycle; PRD-local `Disposition:` tracks
whether the PRD is actionable, parked, or done. PRD folders are grouped by
disposition and prefixed by primary domain:

```text
.scratch/actionable/<domain>-<feature-slug>/
.scratch/parked/<domain>-<feature-slug>/
.scratch/done/<domain>-<feature-slug>/
```

Priorities:

- `P0` — unblocker or correctness issue that should preempt planned work.
- `P1` — next planned product/build work.
- `P2` — valuable but not sequenced yet.
- `P3` — parked, speculative, or revisit-later work.

## Now

PRDs actively eligible for the next implementation branch, in pick order.

| Order | PRD                                                           | Priority |
| ----- | ------------------------------------------------------------- | -------- |
| 1     | `.scratch/actionable/arch-conventions-and-enforcement/PRD.md` | `P1`     |
| 2     | `.scratch/actionable/pose-ground-truth-detection-eval/PRD.md` | `P1`     |
| 3     | `.scratch/actionable/pose-detection-loss-recovery/PRD.md`     | `P1`     |
| 4     | `.scratch/actionable/pose-vitpose-climber-identity/PRD.md`    | `P1`     |

`arch-conventions-and-enforcement` leads on timing, not importance. Its issue 03
moves the 16 `harness*.ts` files out of `utils/` into a `harness/` module, and
three of the PRDs behind it write directly into those files — the overlap is
smallest now and grows with every issue that lands first, and every pose issue
authored afterwards is written against final paths and enforced boundary rules.

One unmerged local branch, `fix/harness-review-seed-corpus` (`250b2bb`), edits
two of the files issue 03 renames; merge or abandon it before that issue starts.
`feat/landing-clip-playlist-update` (`b372a77`) collides with
`arch-consolidation-cleanup` issue 01 over `app/dev/landing-clip/page.tsx`.

## Next

Actionable PRDs that are not first in line.

| Order | PRD                                                              | Priority |
| ----- | ---------------------------------------------------------------- | -------- |
| 1     | `.scratch/actionable/dev-harness-review-surfaces/PRD.md`         | `P2`     |
| 2     | `.scratch/actionable/dev-detection-annotation-ui/PRD.md`         | `P2`     |
| 3     | `.scratch/actionable/pose-pipeline-contract-authority/PRD.md`    | `P2`     |
| 4     | `.scratch/actionable/scan-pipeline-isolation-testability/PRD.md` | `P2`     |
| 5     | `.scratch/actionable/arch-consolidation-cleanup/PRD.md`          | `P2`     |

`dev-detection-annotation-ui` sits behind `dev-harness-review-surfaces`: its
`failureClass` / `distractor` controls annotate conditions the operator has to
be able to see first, and the review surfaces PRD builds that viewer.

`arch-consolidation-cleanup` depends on `arch-conventions-and-enforcement` and
is otherwise conflict-tolerant — its issues are mechanical consolidations that
can interleave with pose work. Its issue 09 closes out the `knip` ignore block
opened by the foundation PRD's issue 06.

`scan-pipeline-isolation-testability` owns `hooks/useVideoProcessor.ts`; both
`arch-` PRDs exclude that file by design, so the three can proceed without
contending for it.

`harness-contract-adr0007-adoption` is `in-progress` and not listed above — its
remaining issue 03 is an independent correctness fix that can land in any order.
Its two open questions are now answered in the issue's Comments against the
harness source: `climber_point` is still read (and corrupts the harness's
video-stats window), and the relay's pre-POST artifact deletion does block
`200 skipped` outright.
Its issue 02 sweep is superseded by `dev-harness-review-surfaces` issue 05.
Issue 04 landed the scaffold provenance stamp: truth written from now on carries
it, and the eleven bundles whose unstamped truth predates a re-seed badge
`accepted · drift?` until the corpus re-accept pass retires the guess.

## Parked

PRDs that are intentionally deferred. Do not start implementation from these
until their `Disposition:` changes.

| PRD                                                           | Priority | Reason                   |
| ------------------------------------------------------------- | -------- | ------------------------ |
| `.scratch/parked/pose-analyzer-tuning-suggestion-loop/PRD.md` | `P3`     | Deferred companion scope |

## Done

Completed PRDs retained for history.

| PRD                                                              | Merged          |
| ---------------------------------------------------------------- | --------------- |
| `.scratch/done/auth-login-reliability/PRD.md`                    | see issue files |
| `.scratch/done/dev-backend-analysis-evidence/PRD.md`             | see issue files |
| `.scratch/done/map-interaction-outdoor-style/PRD.md`             | see issue files |
| `.scratch/done/pose-batch-reseed-stale-truth/PRD.md`             | see issue files |
| `.scratch/done/pose-calibration-analyze-split/PRD.md`            | see issue files |
| `.scratch/done/pose-calibration-flag-review/PRD.md`              | see issue files |
| `.scratch/done/pose-calibration-wrong-forward-fill/PRD.md`       | see issue files |
| `.scratch/done/pose-harness-setup-calibrate-split/PRD.md`        | see issue files |
| `.scratch/done/pose-untrackable-bundle-quarantine/PRD.md`        | see issue files |
| `.scratch/done/scan-moving-video-displays/PRD.md`                | see issue files |
| `.scratch/done/scan-pipeline-audit-upload-scan-view-save/PRD.md` | see issue files |
| `.scratch/done/test-suite-flake-stabilisation/PRD.md`            | `e408eeb`       |
| `.scratch/done/ui-adaptive-overlay-contrast/PRD.md`              | see issue files |
| `.scratch/done/ui-landing-replay-multi-clip/PRD.md`              | see issue files |
| `.scratch/done/ui-public-landing-replay-curation/PRD.md`         | see issue files |
