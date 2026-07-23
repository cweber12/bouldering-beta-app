# Detection Annotator UI + harness "annotate" act

Status: ready-for-agent
Type: interactive

## Parent

- `.scratch/detection-annotation-ui/PRD.md`

## What to build

Add `components/dev/DetectionAnnotator.tsx` and wire it into the harness page as a fourth
act alongside Setup / Calibrate / Analyze. The block is stored in `ground-truth.json`
(issue 01), so this act loads and saves through the **existing** Ground Truth GET/PUT.

- Extend the `HarnessMode` union in `utils/harnessCorpus.ts` with `"annotate"` and add a
  corpus-row action + `Selection` routing in `app/dev/harness/page.tsx` (parallel to the
  existing `analyze` branch). Enable it for bundles that already have Ground Truth (the
  annotations are keyed to the Detection Frame grid the GT frames define).
- `DetectionAnnotator`:
  - Load the bundle's Ground Truth (existing `GET /api/dev/corpus/ground-truth`); read any
    existing `detectionAnnotations`.
  - **Reuse `components/dev/DetectionFrameStepper.tsx`** for the film-strip: it renders
    `{start,end}` frame ranges as a continuous bar and exposes `onAnnotate?(index)` +
    keyboard stepping. Feed the current annotation ranges in as stretch bars; pre-seed
    candidate ranges from the run's `frameQuality` auto-flags when available.
  - **Reuse `hooks/useDetectionThumbnails.ts`** for strip thumbnails and the forward-fill
    control-point model from `components/dev/GroundTruthReviewer.tsx` for span tagging.
  - Range editor: `startFrame`/`endFrame` pickers driven off the stepper `currentIndex`,
    plus two label pickers (`failureClass` — 5 values, `distractor` — 9 values) as
    segmented/select controls using **semantic color tokens only** (no raw palette classes).
  - Save by merging `detectionAnnotations` into the GT PUT payload (preserving `frames` /
    `setupHash` / `review`); surface the existing stale-`setupHash` 409 inline as a
    `bg-danger-surface border-danger-border text-danger` banner.

## Acceptance criteria

- [ ] `"annotate"` `HarnessMode` opens `DetectionAnnotator` from the corpus list, enabled
      when Ground Truth exists.
- [ ] Reviewer can select a frame range and tag it with a `failureClass` + `distractor`;
      existing ranges load and render; candidate ranges pre-seed from auto-flags.
- [ ] Save round-trips through the GT PUT and re-reads on reopen; a stale-hash save shows
      the inline error.
- [ ] No raw Tailwind palette classes for status/semantic colors (theme-audit clean).
- [ ] Type-check, lint, and targeted component tests pass. Manual dev walkthrough per the
      PRD verification section confirms persistence + stale-hash refusal.

## Blocked by

- Issue 01 (the `detectionAnnotations` types + parse + persistence).
