# Make the Harness's Evidence Human-Reviewable

Status: in-progress
Disposition: actionable

Spec inputs: this repo's own artifacts — `detections/<ts>_pose.json`
(`utils/harnessPayloads.ts` `HarnessPosePayload`), `ground-truth.json`
(`utils/harnessGroundTruth.ts`), `vitpose.json` (`utils/harnessViTPose.ts`).
Related PRDs: `.scratch/actionable/dev-detection-annotation-ui/PRD.md` (the
write half — re-sequenced behind this one);
`.scratch/actionable/harness-contract-adr0007-adoption/PRD.md` (issue 02 built
the `ClimbEndSweeper` that issue 05 here retires).
Glossary: CONTEXT.md — **Ground Truth**, **Detection Frame**, **Detection
Error**, **Scan Setup**, **Test Video**, **Detector Attempt**; plus **Bundle**,
**Seed tap** and **Climb Window**, which issue 06 adds.

## Problem Statement

The harness can now *produce* evidence at corpus scale — Batch Calibrate seeds
Ground Truth, Batch Analyze posts scored runs across ~90 Bundles — but a human
cannot *look* at any of it.

- **Analysis runs are write-only.** A batch entry drives the same
  `useAnalyzeRun` lifecycle a manual Analyze does, and posts an identical
  `HarnessPosePayload` — per-frame verdicts, detector attempts, pixel
  conditions, dense pose frames. Then it throws every field away:
  `BatchItemRunner` destructures only `phase` / `post` / `scoring`, renders a
  status word, and unmounts. The payload is durable on disk at
  `<bundle>/detections/<ts>_pose.json`, but `app/api/dev/detections/route.ts`
  exports only `POST` — nothing in this repo can read a run back. A manual
  Analyze is viewable only because its result is still in React state; reload
  the page and it is gone too.
- **A scoring number cannot be traced to a frame.** `ScoringSummary` reports
  that N frames scored `wrong`, and there is no way to see one. So the three
  distinct causes of a bad number are indistinguishable: the detector really
  failed; the frame was hostile (shadow, backlight, occlusion, bystander); or
  the **Ground Truth itself is wrong** and a correct pose was scored against a
  bad reference. The third case is not hypothetical — Ground Truth is seeded
  from ViTPose and accepted by flag-only review, so a frame nobody objected to
  can carry a wrong-person or distorted reference and silently skew the corpus.
- **Ground Truth is write-once.** An accepted truth can only be re-opened by
  re-entering the calibration flow, which is framed as *re-calibrating* rather
  than *reviewing*. There is no way to walk the corpus looking at what was
  accepted.
- **The climb window has its own sequence.** `climbEnd` is authored in a
  dedicated corpus-wide `ClimbEndSweeper`, separate from the review where the
  same operator is already looking at the same frames of the same Bundle.

Everything needed for the fix is already on disk or already re-derivable.
Frame imagery is the one thing never stored — and never needs to be, because
`useDetectionThumbnails` already re-derives it from the source mp4 after the
fact.

## Scope

1. **Read a posted run back off disk** — a `GET` on the detections route and a
   validating client seam, so batch and manual runs are equally reviewable and
   survive a reload.
2. **A per-Bundle run reviewer** — the video frame with the run's pose and the
   Ground Truth pose drawn together, plus the detector attempt's evidence
   (search regions, candidate counts, miss reason, pixel conditions).
3. **Fault-stretch navigation** — consecutive non-`good` frames grouped into
   stretches, selected with good-frame lead-in and lead-out so entry *and
   recovery* conditions are both on screen.
4. **Ground Truth browsing** — the corpus row's Calibrate button reads
   `Ground truth` once truth is accepted and opens the saved review straight
   from disk, with prev/next across Bundles and auto-save when dirty.
5. **The climb window authored in that review**, retiring the dedicated sweep,
   with an honest `window-moved` state for truth that predates its window.
6. **Docs** — the three missing glossary terms and an ADR for the climb-window
   relocation.

## Sequencing

```text
01 GET route → 02 frame viewer → 03 fault stretches
                              ↘ 04 GT browse → 05 climb end in review → 06 docs
```

Issue 01 is the unblocker and is pure backend — nothing can be reviewed until a
run can be read. Issues 04 and 05 touch the Calibrator and are independent of
02/03, so they can proceed in parallel with the viewer if two efforts are live.
Issue 05 must follow 04: the review screen has to be reachable as a browse
surface before the climb-window control is moved onto it.

`dev-detection-annotation-ui` moves behind this PRD in the roadmap. Its
`failureClass` / `distractor` controls annotate conditions the operator has to
be able to *see* first, and issue 02 here builds that surface.

## Non-Goals

- **Annotation.** `failureClass` / `distractor` labelling stays in
  `dev-detection-annotation-ui`. The reviewer built here is read-only over run
  evidence; deliberately deferred so the read path is not blocked behind the
  annotation write contract.
- **Correcting Ground Truth from the run reviewer.** Seeing a bad reference
  tells the operator to open that Bundle's Ground Truth review; it does not
  edit truth in place from the analysis surface. (Ground Truth *is* editable
  from its own review — issue 04 — because that is the existing Calibrator
  affordance being relocated, not new write surface.)
- **Changing detection behaviour.** Nothing here touches the pipeline, search
  regions, gates or acceptance. The reviewer reads artifacts a run already
  wrote.
- **Re-scoring past runs.** A Ground Truth flag edit re-derives
  `groundTruthHash`, which makes prior runs' embedded `scoring` blocks evidence
  against a superseded truth version. This PRD *surfaces* that; re-running
  Analyze is the existing remedy.
- **Any user-visible scan surface.** Dev harness only, `HARNESS_ENABLED`-gated
  like every sibling route.
- **Storing frame imagery.** Thumbnails and frame stills stay re-derived from
  the mp4 on demand.

## Further Notes

- **Pairing is `setupHash`-only.** `runPairsWithTruth` compares the run's
  stamped `setupHash` against the truth's (`utils/harnessFreshness.ts`).
  `groundTruthHash` is a provenance stamp, not a pairing key — so editing flags
  on saved truth never *unpairs* a run, it only makes that run's scoring block
  stale evidence. Issue 04 surfaces the difference rather than conflating them.
- **The climb window shapes Ground Truth, not just scoring.** The ViTPose job
  windows its tracking history *before* stitching the climber track, and skips
  posing frames outside the window — those come back seeded-absent. So a
  `climbEnd` set after truth was accepted did not shape that truth. The
  scanner's own `harnessScoring.ts` never references the window at all. This
  asymmetry is what issue 05's `window-moved` state exists to make visible, and
  what the new ADR records.
- **`climbWindow` is already written into `vitpose.json`** by the job when
  either bound is supplied, which is the honest source for the `window-moved`
  derivation. Every artifact currently on disk predates it and has the field
  absent — absent alongside a set `climbEnd` reads as "seeded without a
  window", which is exactly correct for those Bundles.
- **The reviewer's reuse surface is unusually good.** `DetectionFrameStepper` is
  already dual-purposed between the Analyzer (detector statuses) and the
  Calibrator (flag marks); `GroundTruthReviewer` already does seeked-frame +
  skeleton + 1×–6× zoom/pan; `ScoringSummary` and `DiagnosticsPanel` are pure
  props. The frame stage should be extracted from `GroundTruthReviewer` rather
  than written twice.
- The original brief also reported that re-tapping the ViTPose seed moved the
  clip start and dropped back-propagated landmarks. Re-tested against the
  current code and **confirmed fixed** — the setup tap dictates the climb start
  and the seed tap is independent and off-hash, on both sides of the contract.
  No issue is cut for it.
