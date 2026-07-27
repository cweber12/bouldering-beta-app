# End-of-climb capture gesture in the Calibrator

Status: done
Branch: feat/adr0007-02-climb-end-gesture
Merged: 269c68f
Type: interactive

## Parent

- `.scratch/actionable/harness-contract-adr0007-adoption/PRD.md`
- Spec: `beta-scan-analysis/docs/handoffs/scanner-tap-split-adr0007.md` §4
- Depends on: issue 01 (the field and its save path must exist first)

## What to build

A way to author `climbEnd` for a bundle at corpus scale. There is no gesture to
infer the end of a climb from — a topout, or the point the attempt is over — so
it has to be captured explicitly by the human already doing calibration.

The climb **start** needs nothing: it is the setup tap's `t`.

This is the only slice in this PRD needing design judgment, hence `interactive`
rather than `AFK`. The Calibrator already has the pieces — a video element, the
100 ms Detection Frame grid (`buildDetectionGrid`), and grid thumbnails via
`useDetectionThumbnails`. Prefer composing those over introducing a new
scrubbing surface.

Open design questions to settle before building (not to guess at):

- Scrub-and-mark on the existing grid, or a numeric entry beside the seed-tap
  controls? The grid gives visual confirmation of the topout frame; numeric entry
  is faster for a sweep across 90 bundles.
- Does this belong in the Calibrator's main flow, or in `ReseedSweeper` where
  bulk work already happens? Ninety bundles need markers; a per-bundle-only path
  makes that a long afternoon.
- What does the operator see for a bundle that has no marker yet — is "unset" a
  visible gap to fill, or silent? The harness treats unset as an open window and
  behaves as today, so it is not an error state, but it is a to-do the sweep
  needs to surface.

## Design decisions

The three open questions, settled before building:

- **Both surfaces, one editor.** `ClimbEndEditor` owns the gesture; a corpus-wide
  `ClimbEndSweeper` wraps it for the ninety-bundle backlog, and the Calibrator
  opens the same editor in a `Modal` for revising a single bundle mid-
  re-calibration. Sweep ergonomics was the requirement that decided it — a
  per-bundle-only path leaves the afternoon intact.
- **Scrub plus a local film strip.** The paused video frame is the primary
  confirmation; a ±2 s strip of Detection Frame thumbnails gives frame-accurate
  context. Deliberately *local*: thumbnailing a whole video is hundreds of
  sequential seeks per bundle, which at ninety bundles is the whole cost.
- **Unmarked is visible.** A `climb` column on the corpus table reads the window
  or `unmarked`, and the Batch **Mark ends** button carries the backlog count. Not
  an error state — a to-do the sweep surfaces.

## Acceptance criteria

- [x] A human can set, change, and clear `climbEnd` for a bundle without editing
      JSON by hand.
- [x] The marker is confirmable against the video — the operator can see the
      frame they are marking, not just a number.
- [x] Bundles without a marker are distinguishable from bundles marked at the
      video's end, both in the UI and in `setup.json` (absent, not `duration`).
- [x] Setting the marker leaves `setupHash` unchanged, so no run goes stale and
      no Ground Truth is orphaned.
- [x] A marker at or before the setup tap's `t` is rejected in the UI with a
      reason, not silently clamped.
- [x] Dismiss/close seams use `useClickOutside` / `useEscapeKey` or
      `components/ui/Modal`, per the hooks rule in AGENTS.md.
- [x] Semantic colour tokens only — no raw Tailwind palette classes.

## What landed

- `utils/harnessClimbWindow.ts` — the pure layer: `planClimbEndSweep` (queue =
  set-up-but-unmarked, already-marked counted, no-Setup skipped because the route
  422s a climb-end-only write with nothing to merge onto), `checkClimbEnd`
  (mirrors `parseClimbEndEdit`, pinned by a test that walks both over the same
  candidates), `snapToDetectionFrame`, `detectionFrameWindow`, and the window
  labels. `detectionFrameCount` / `detectionFrameTime` were lifted out of
  `buildDetectionGrid` so snapping and windowing bound an index without
  allocating a whole grid per keystroke.
- `components/dev/ClimbEndEditor.tsx` — presentational; owns scrub position only,
  so the same editor drives both surfaces. Opens at the saved marker, else the
  **last** frame: a topout is near the end, so the search is a short drag back
  rather than a scrub across the clip. The marker snaps to the nearest Detection
  Frame because scoring is per Detection Frame. A candidate at or before the
  climb start disables Set and shows the reason, naming the setup tap's time.
- `components/dev/ClimbEndSweeper.tsx` — walks the backlog, one video in memory at
  a time, auto-advancing on set or clear. Skip leaves a bundle unmarked, which the
  harness reads as an open window, so skipping is a deferral, never a wrong
  answer. Submits no jobs and burns no GPU time.
- `climbStart` / `climbEnd` on the corpus listing (`app/api/dev/shared.ts`,
  `utils/harnessCorpus.ts`), read off the `setup.json` already opened for the
  labels. `climbStart` is `climberPoint.t` — the **setup** tap, never the seed
  tap.
- Harness page: the Batch **Mark ends** button with its backlog count, and the
  `climb` column.

## Comments

- Ships after issue 01 and before the pre-reset control batch. Until markers
  exist, post-topout frames are scored in-scope, and because the reacquire ladder
  (ADR 0024) fires on every missing frame, that tail is exactly where inference
  cost and missing-run length concentrate. Marking first is what makes the
  batch's absolute numbers readable rather than diff-only.
- Ninety bundles need a marker for the reset to be worth running once. Whatever
  the surface, sweep ergonomics are the requirement that matters most.
- Dev-harness only. No user-visible scan surface changes.
