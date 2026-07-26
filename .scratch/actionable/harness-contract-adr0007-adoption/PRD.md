# Split the Setup Tap from the Seed Tap, and Bound the Climb Window

Status: ready-for-agent
Disposition: actionable

Spec inputs: `beta-scan-analysis/docs/handoffs/scanner-tap-split-adr0007.md`
(harness ADR 0007, the delta this PRD adopts);
`beta-scan-analysis/docs/handoffs/scanner-reset-sequencing-reply.md`
(2026-07-26: what the corpus reset is waiting on, and why);
companion contracts `scanner-seed-contract-adr0006.md` (the `seed_tap` /
`seed_region` split this amends) and `scanner-data-contract.md` (bundle layout,
the `/api/contract` capability probe).
Harness refs: their ADR 0007, issue #101 stories 41–45.
Glossary: CONTEXT.md — **Climber**, **Scan Setup**, **Ground Truth**,
**Detection Frame**, **Bundle**.

## Problem Statement

The harness cannot run its corpus reset until this lands, and the reset is what
unblocks a trustworthy baseline for the whole detection-improvement programme.
Three defects, measured on the corpus as it stands (90 bundles):

- **`climberPoint` is doing two jobs.** It is both the setup tap (the calibration
  gesture anchoring MediaPipe's Climber selection) and the ViTPose seed tap (which
  tells the scaffold which tracked person is the Climber). They start equal, but
  re-seeding used to write back over `climberPoint`, so every re-tap dragged the
  setup tap forward. **27 bundles now carry a setup tap sitting mid-climb**, and
  in 24 of them the Climber's hips had already risen 5–47% of frame height before
  the tap. Nothing detects it, because `setupHash` matches either way.
- **There is no end-of-climb marker.** `setup.json` has no `climbEnd`, so the
  climb window is open on the right. **0 of 90 bundles carry one.** Every frame
  after topout is scored as in-scope, which means `out-of-scope` is structurally
  zero and post-climb frames pool into the truth-absent population as apparent
  hallucinations. A reset run before this exists bakes that in and has to be
  done again.
- **A moved seed leaves a stale scaffold, silently.** `setupHash` does not cover
  the seed, so re-calibrating the seed point left the old `vitpose.json` in place
  with nothing able to tell. The harness now stamps a `seedHash` and answers
  `200 skipped` for an unchanged seed — a response this scanner does not handle.

Reading the corpus against this repo narrows the work considerably. Much of
ADR 0006/0007 is already in place:

- `seedTap` is already a separate off-hash field on `setup.json`, and a
  seed-tap-only save merges without touching `climberPoint`
  (`app/api/dev/corpus/setup/route.ts`). **The core tap-split defect is already
  fixed** — re-seeding no longer drags the setup tap forward.
- `POST /api/dev/corpus/vitpose` already sends `seed_tap` and `seed_region`.
- Scaffold frames are already requested on the truth's 100 ms grid: both call
  sites (`components/dev/Calibrator.tsx`, `components/dev/ReseedSweeper.tsx`)
  build `frames[]` from `buildDetectionGrid()` at
  `DETECTION_GRID_INTERVAL_MS = 100`. **The 8 bundles sampled at 1.0 s are legacy
  artifacts predating that code, not a live request-side defect** — re-requesting
  them fixes it, which the reset does anyway. No work is needed here.

What is left is the climb window (absent entirely) and the ADR 0007 edges: the
`climber_point: b.seedTap` alias still putting the seed tap in the setup-tap
slot, the unhandled `200 skipped`, `force`, and the `splitTaps` capability gate.

## Scope

1. **`climbEnd` on the Scan Setup, off-hash**, plus `climb_start` / `climb_end`
   on the ViTPose request. `setupHash` covers only `climberCrop`, `wallCrop`,
   `climberPoint`, `panning`, `qualityTier` (`utils/harnessSetup.ts`
   `pickScanInput`); `climbEnd` must stay outside that set so adding it cannot
   invalidate the 90 existing calibrations or disturb the freshness chain
   (ADR 0020). `climb_start` is the setup tap's `t` — no new gesture.
2. **A capture gesture for `climbEnd`** in the harness Calibrator, so the marker
   can be authored at corpus scale rather than hand-edited.
3. **The ADR 0007 edges**: drop the `climber_point` alias, treat `200 skipped` as
   success with the artifact present (never poll it), send `force`, and gate the
   new request fields on the `splitTaps` capability so a mixed-version deployment
   degrades visibly.

## Sequencing

This PRD lands **between** `pose-detection-loss-recovery` issues 06 (done) and
04. The chain:

```
06 (done) → 01 climbEnd plumbing → 02 capture UI → control batch → 04
                                 ↘ 03 ADR 0007 edges (independent)
```

Issue 01 is what unblocks the harness: once `climbEnd` is *writable*, a
re-calibration produces a correct bundle and the reset can be scheduled. Issue 02
makes it authorable at scale. Issue 03 is independent of both and fixes a live
correctness bug; it can land in any order.

The control batch is deliberately **after** 01 and 02. Post-climb frames are
missing frames by construction, and since the reacquire ladder (ADR 0024) fires
on every missing frame, the post-topout tail is where inference cost and
missing-run length concentrate. Running the batch before the marker exists yields
numbers that can only be diffed, not read — and inflates the
`REACQUIRE_LADDER_SCALES = []` A/B, whose whole purpose is to size the ladder's
cost during actual climbing.

## Non-Goals

- Changing detection behavior. Nothing here touches search regions, gates,
  acceptance, or `frames[]`; the control batch it precedes must stay a clean
  03-behavior reading.
- Migrating existing bundles. No migration can recover a setup tap that was
  already overwritten — that is why harness issue #101 ends in a corpus reset
  rather than a repair.
- Re-requesting the 8 legacy 1.0 s scaffolds as a separate task; the reset
  regenerates them.
- Any user-visible scan surface. `climbEnd` is dev-harness calibration only.
- Bounding the scanner's own seek loop by the climb window. The scanner analyses
  the whole video; the window is a *scoring* concept the harness applies. Changing
  the seek loop would be a detection-behavior change and would confound 03/04.

## Further Notes

- Absence provenance (harness schema v14) measured the contamination the round-2
  handoff estimated at 44%: **19.6%** of pooled truth-absent frames are confirmed
  absences, **44.4%** are `untracked` (the scaffold's tracker lost or never
  acquired the Climber), **36.0%** are `not-sampled`. 13,054 of 15,949 frames
  previously pooled as `hallucination-fp` are now held out of the split.
- `untracked` at 44.4% is the population the harness's re-seeding fixes exist to
  recover, and re-seeding is the only thing that moves it — which is why a batch
  run against today's scaffolds inherits all of it, and why nothing derived from
  truth-absent frames should be read off a pre-reset batch.
- The harness re-seed of all 90 scaffolds is ~144 min of GPU time, then truth is
  re-exported and the corpus re-scored. Worth batching our side so they run it
  once.
- Both climb fields accept snake_case or camelCase on the request, and both are
  optional — the harness falls back to the bundle's `setup.json`. Writing the
  calibration correctly is sufficient on its own; sending them is the explicit
  override path. `climb_end` must exceed `climb_start`, both ≥ 0, or the endpoint
  returns 422.
- Until a bundle has `climbEnd`, the harness treats the window as open on that
  side and behaves exactly as today, so issue 01 is safe to land before issue 02
  gives it a UI.
- The reply to the harness belongs in `pose-detection-loss-recovery` issue 07
  (the designated handoff reply), pointing at this PRD rather than duplicating
  it — including the correction that scaffold-grid sampling is already conformant
  on this side.
