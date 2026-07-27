# Fault-stretch navigation

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/dev-harness-review-surfaces/PRD.md`
- Depends on: issue 02 (the reviewer it navigates)

## What to build

Detection failures are not frame-shaped. What a skeleton is doing *during* a
bad run — expanding, distorting, jumping to a bystander — and what changed at
the moment detection *recovered* are both properties of a stretch of frames, and
neither is legible one frame at a time.

Group a run's `DetectionErrorRow[]` into runs of consecutive non-`good` frames
and make each one a navigable unit.

### The pure layer

`utils/harnessRunReview.ts`. A stretch carries `{ startIndex, endIndex,
startTimestamp, endTimestamp, dominantKind, counts }`, where `counts` is the
per-kind tally within the stretch (a stretch can mix `missing` and `wrong`) and
`dominantKind` is the most frequent, ties broken by the verdict precedence
already fixed in ADR 0018 (`missing > unscored > extreme > wrong > drift`).

Model it on `enumerateWrongStretches` in
`utils/harnessGroundTruthScaffold.ts` — the same shape of problem over a
different input. Keep it framework-agnostic and total: an empty row set yields
no stretches, an all-`good` run yields none, and a gap in frame indices (an
unscored or off-grid frame) breaks a stretch rather than silently bridging it.

### The surface

A stretch list beside the frame stage. Selecting one seeks to
`startIndex - LEAD_FRAMES` and the stretch is drawn as a rule bar on the
filmstrip — `DetectionFrameStepper` already renders stretch bars for the
Calibrator's wrong-stretches, so this is the same prop.

The lead-in/lead-out is the point of the feature, not a nicety: two good frames
either side, clamped to the grid, so the frames immediately before entry and
immediately after recovery are always reachable without hunting. A stretch at
the very start or end of the grid clamps rather than disappearing.

Keyboard: prev/next stretch alongside the existing prev/next frame.

## Acceptance criteria

- [ ] Consecutive non-`good` frames group into stretches with correct bounds,
      per-kind counts and a dominant kind.
- [ ] A gap in scored frame indices ends a stretch rather than bridging it.
- [ ] An all-`good` run and an empty run both yield zero stretches without
      error.
- [ ] Selecting a stretch seeks with two good frames of lead-in visible, and the
      recovery frame after `endIndex` is reachable from the same view.
- [ ] Stretches at the first or last Detection Frame clamp cleanly.
- [ ] Stretches are drawn on the filmstrip using the existing stretch-bar prop,
      not a new mechanism.
- [ ] Prev/next stretch is available by keyboard.
- [ ] Semantic colour tokens only. No `any`.

## Tests

- `__tests__/utils/harnessRunReview.test.ts` — pure: grouping, mixed-kind
  dominance and precedence tie-break, index gaps, empty and all-good inputs,
  boundary clamping.
- A component test that selecting a stretch seeks to the expected lead-in frame.
