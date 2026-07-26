# End-of-climb capture gesture in the Calibrator

Status: ready-for-agent
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

## Acceptance criteria

- [ ] A human can set, change, and clear `climbEnd` for a bundle without editing
      JSON by hand.
- [ ] The marker is confirmable against the video — the operator can see the
      frame they are marking, not just a number.
- [ ] Bundles without a marker are distinguishable from bundles marked at the
      video's end, both in the UI and in `setup.json` (absent, not `duration`).
- [ ] Setting the marker leaves `setupHash` unchanged, so no run goes stale and
      no Ground Truth is orphaned.
- [ ] A marker at or before the setup tap's `t` is rejected in the UI with a
      reason, not silently clamped.
- [ ] Dismiss/close seams use `useClickOutside` / `useEscapeKey` or
      `components/ui/Modal`, per the hooks rule in AGENTS.md.
- [ ] Semantic colour tokens only — no raw Tailwind palette classes.

## Comments

- Ships after issue 01 and before the pre-reset control batch. Until markers
  exist, post-topout frames are scored in-scope, and because the reacquire ladder
  (ADR 0024) fires on every missing frame, that tail is exactly where inference
  cost and missing-run length concentrate. Marking first is what makes the
  batch's absolute numbers readable rather than diff-only.
- Ninety bundles need a marker for the reset to be worth running once. Whatever
  the surface, sweep ergonomics are the requirement that matters most.
- Dev-harness only. No user-visible scan surface changes.
