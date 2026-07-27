# Run review: the per-frame viewer

Status: ready-for-agent
Type: interactive

## Parent

- `.scratch/actionable/dev-harness-review-surfaces/PRD.md`
- Depends on: issue 01 (the run must be fetchable)

## What to build

`components/dev/RunReviewer.tsx` — a per-Bundle surface that shows, for one
posted run, what the detector saw on each Detection Frame and how it compared
against Ground Truth. Opened by a new **Review** action on each corpus row in
`app/dev/harness/page.tsx`, disabled when the Bundle has no runs.

This is the answer to a question the harness currently cannot answer: *why* is
this number bad? Three causes have to be distinguishable by eye — the detector
failed, the frame was hostile, or the Ground Truth is wrong.

### Run picker

Defaults to the newest run that pairs with current truth. The dropdown lists
every run with its timestamp and pairing state, so an unpaired run is
inspectable but never the default. A run whose `groundTruthHash` differs from
the Bundle's current truth is marked — its scoring block was computed against a
superseded reference and reads as `re-score`, not as a fresh verdict.

### Filmstrip

Reuse `components/dev/DetectionFrameStepper.tsx` over the 100 ms Detection Frame
grid, cells tinted by the frame's `DetectionErrorRow.kind`. Thumbnails come from
`hooks/useDetectionThumbnails.ts` against the mp4 served by
`/api/dev/corpus/video`. Frame imagery is always re-derived and never stored.

### Frame stage

One zoomable canvas: the seeked video frame with the **Ground Truth skeleton and
the run skeleton overlaid in contrasting colours**, so displacement reads
directly as the gap between them rather than as a number to be trusted.

`components/dev/GroundTruthReviewer.tsx` already does seeked-frame + skeleton +
1×–6× zoom/pan. Extract that machinery into a shared presentational base and
make `GroundTruthReviewer` a thin single-skeleton consumer of it — do not write
the seek/canvas/zoom loop a second time.

Toggles on the stage: run pose (accepted vs raw), Ground Truth pose, and the
detector attempt's search regions. Raw-vs-accepted matters because a
`flipRejected` or `qualityRejected` attempt *had* a pose the scanner discarded,
and seeing what was discarded is half the diagnosis.

### Evidence sidebar

From the `DetectionErrorRow` (found via `findScoredRow` in
`utils/harnessScoring.ts`): verdict `kind`, `unscoredReason`, `driftAvg`,
`driftMax`, `worstJoint`, per-joint drift, `bodyScale`.

From the matching `DetectorAttempt` in the same run: `status`, `missReason`,
`selectionMethod`, `candidateCount`, `rejectedCandidateCount`,
`bestUnselectedCandidateScore`, `reacquireAttempted` / `reacquireSteps`, and —
the environmental evidence the whole review exists for — `searchConditions` and
`reacquireConditions`.

Reuse `components/dev/ScoringSummary.tsx` verbatim (`{ scoring, currentRow }`)
for the rollup header and `components/dev/DiagnosticsPanel.tsx` for the run's
`ScanDiagnostics`.

### Ground Truth provenance on the frame

Show the frame's Ground Truth `review` value (`auto` /
`human-flagged-wrong` / `human-flagged-absent`) and `state`. A frame scored
`wrong` whose truth is `auto` — nobody ever objected to it — is precisely the
"the reference might be the problem" case, and the operator needs to see that
without leaving the surface.

## Design notes

- **Colour tokens only.** The two overlay skeletons need distinguishable
  colours: add semantic tokens to `app/globals.css` and mirror them in
  `utils/theme.ts`, which is what canvas drawing reads (AGENTS.md). No raw
  Tailwind palette classes anywhere.
- Dismiss/close seams use `useClickOutside` / `useEscapeKey` or
  `components/ui/Modal`, per the hooks rule.
- Ground Truth carries only the 13 core joints; the run's pose carries the full
  MediaPipe set. Draw the comparison over the core joints — that is the domain
  the verdict was computed on — and treat any extra run joints as context.
- Frames off the Detection Frame grid, and frames with no scored row, must
  render as such rather than as a silent gap. `summarizeGridAlignment` already
  reports off-grid probes for the Analyzer's banner.

## Acceptance criteria

- [ ] A **Review** action on each corpus row opens the reviewer; it is disabled
      when the Bundle has no posted run.
- [ ] The reviewer works identically for a run posted by Batch Analyze and one
      posted by a manual Analyze, and works after a full page reload.
- [ ] The run picker defaults to the newest paired run and marks runs scored
      against a superseded `groundTruthHash`.
- [ ] Stepping the filmstrip changes the frame image, both skeletons, the
      verdict and the conditions together and consistently.
- [ ] The Ground Truth pose and the run pose are visually distinguishable on the
      stage, and either can be hidden.
- [ ] The frame's Ground Truth `review` and `state` are visible on the frame.
- [ ] `searchConditions` are shown for every attempt that carries them, and a
      run predating `detectorAttempts` degrades to scoring-only without error.
- [ ] Semantic colour tokens only; overlay colours also defined in
      `utils/theme.ts`.
- [ ] No `any`.

## Tests

- `__tests__/components/dev/RunReviewer.test.tsx` — run selection, frame
  stepping, a run with no `detectorAttempts`, and a frame with no scored row.
- Extend `__tests__/components/dev/GroundTruthReviewer.test.tsx` to cover the
  extracted stage so the refactor is pinned.
