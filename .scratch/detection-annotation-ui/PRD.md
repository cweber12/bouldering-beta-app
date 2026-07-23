# Detection-annotation UI: frame-range failure-class + distractor labels (harness)

Status: ready-for-agent

Authoritative schema: `docs/handoffs/scanner-detection-annotations.md` in
beta-scan-analysis (landed via PR #62, harness #45 **closed/done**). The block is written
**into `ground-truth.json`** alongside `review` — there is no separate artifact. Enums and
field names below are reconciled against that doc.

Spec inputs: beta-scan-analysis#43 (this UI, `ready-for-human`), #45 (harness ingest +
handoff doc, **closed via PR #62**), #44 (backend auto-flagging, **closed/done**), #42
(parent PRD). Design record: `.claude/plans/review-the-following-sorted-kite.md`.
Pattern precedents in this repo: Ground Truth (`utils/harnessGroundTruth.ts`,
`app/api/dev/corpus/ground-truth/route.ts` — the exact carrier: this block is an
additional field on the persisted Ground Truth, written through the existing GT route with
its existing `setupHash` freshness gate); off-hash convention (`utils/harnessSetup.ts`
`seedTap` / `analysisInputs`; and `analysisInputs` on `GroundTruth`).
Glossary: CONTEXT.md — **Scan Setup**, **Ground Truth**, **Detection Frame**,
**Detection Error**. This feature adds **Detection Annotation**, **failure class**,
**distractor**.

## Problem Statement

The harness (beta-scan-analysis) now auto-classifies every scanned frame against a
ViTPose reference into a `failureClass` (#44, done). Those auto-verdicts are useful but
imperfect: when MediaPipe latches onto a spectator, a crash pad, a tree, or hallucinates
a pose on empty wall, only a human can confirm *what* it grabbed and over *which* stretch
of frames. The harness ingest (#45) is ready to consume an optional human
`detectionAnnotations` block that refines the auto class per range and records the
distractor — but there is **no UI in the scanner to author that block**. Today a reviewer
would have to hand-edit JSON. There are zero references to `failureClass`, `distractor`,
or `detectionAnnotations` anywhere in this repo — the feature is entirely un-started here.

## Solution

Add a dev-only **Detection Annotation** authoring surface to the harness page
(`app/dev/harness`). The block is stored **inside the bundle's `ground-truth.json`** as a
new `detectionAnnotations` field alongside the existing `frames` / `review` (per the
handoff doc), in the corpus-bundle world — **not** the user-facing S3 `RouteAttempt` world.
A reviewer opens a bundle whose Ground Truth exists, sees the Detection Frame film-strip
pre-seeded with candidate ranges, selects a frame range (`startFrame`→`endFrame`, inclusive
`frameIndex` values), and tags it with a `failureClass` and a `distractor`. Staleness is
governed by the Ground Truth file's existing top-level `setupHash` (the harness ignores
ranges whose setup no longer matches), so annotations go stale on recalibration exactly
like the rest of the Ground Truth. The scanner writes the block through the **existing**
Ground Truth PUT route; the harness (#45, done) ingests it and refines its per-frame auto
classes.

## User Stories

1. As a reviewer, I want to select a *range* of frames (start→end), not one at a time,
   so I can label a whole bad stretch in one action — failures occur in stretches.
2. As a reviewer, I want to tag a range with a `failureClass`
   (`ok | wrong-subject | hallucination-fp | flipped-rotated | distorted`), so my
   judgment lines up with the harness auto taxonomy. (No `frozen-stale` — that is a #44
   auto-only cross-cutting flag, not a human-assignable annotation class.)
3. As a reviewer, I want to tag a range with a `distractor`
   (`tree_bush | rock_wall_shape | crash_pad_bag | animal | shadow | spectator |
   hallucination_none | gear | other`), so I record *what* the detector picked up.
4. As a reviewer, I want candidate ranges pre-seeded from the harness's auto-flags (#44
   `frameQuality`), so I confirm/correct rather than hunt.
5. As a reviewer, I want annotations to inherit the Ground Truth's `setupHash`, so they go
   stale on recalibration exactly like the rest of the Ground Truth.
6. As a reviewer, I want a stale-hash save refused with a clear message (the existing GT
   freshness gate), so I never write annotations against an old calibration.
7. As a developer, I want the range types + validation in `utils/harnessGroundTruth.ts`
   (framework-agnostic, no React imports), so the contract is testable at the module seam
   and shared by the GT parse/route path.
8. As a developer, I want `detectionAnnotations` persisted on `GroundTruth` but excluded
   from `canonicalGroundTruthInput`, so annotating never re-stamps `groundTruthHash` and
   invalidates prior scores (off-hash, like `analysisInputs` / `seedTap`).
9. As a developer, I want the field and its off-hash stamping recorded in CONTEXT.md +
   an ADR, so the contract is discoverable without reading the harness repo.

## Implementation Decisions

- **Storage = inside `ground-truth.json`.** `detectionAnnotations` is a new optional field
  on the persisted Ground Truth (sibling to `frames` / `setupHash`), per the handoff doc.
  No separate artifact and **no new proxy route** — it is written through the existing
  `app/api/dev/corpus/ground-truth/route.ts` PUT, which already validates and gates on
  `setupHash`. Not the S3 `RouteAttempt` world (decision locked with the user).
- **Model + parse in `utils/harnessGroundTruth.ts`** (framework-agnostic): add
  `FailureClass` union `"ok" | "wrong-subject" | "hallucination-fp" | "flipped-rotated" |
  "distorted"` and `Distractor` union `"tree_bush" | "rock_wall_shape" | "crash_pad_bag" |
  "animal" | "shadow" | "spectator" | "hallucination_none" | "gear" | "other"`; add
  `DetectionAnnotationRange { startFrame; endFrame; failureClass; distractor }`. Add
  `detectionAnnotations?: DetectionAnnotationRange[]` to the persisted `GroundTruth` and
  extend `parseGroundTruthInput` to validate + carry it (enums, integer `startFrame <=
  endFrame`, overlap policy — the doc says keep the later range authoritative, so overlaps
  are tolerated, last-wins). Follow the existing `legacy`-tolerant parse behavior: a
  missing field reads as `[]`.
- **Off-hash.** `detectionAnnotations` is persisted on `GroundTruth` but **excluded from
  `canonicalGroundTruthInput`** (the hash pre-image), so annotating never changes
  `groundTruthHash` and never invalidates prior scores — exactly how `analysisInputs` /
  `seedTap` stay off their hashes. Staleness is instead governed by the GT's existing
  top-level `setupHash`, which the harness already checks. A regression test pins that
  adding/altering `detectionAnnotations` yields an identical `groundTruthHash`.
- **Route.** The existing GT PUT must preserve `detectionAnnotations` on write (it
  currently spreads `...input` then re-hashes; confirm the new field survives the spread
  and the `GroundTruth` assembly). Likely a one-line inclusion; no freshness-gate change —
  the existing `setupHash` gate already covers it.
- **UI** — new `components/dev/DetectionAnnotator.tsx` opened via a new `"annotate"`
  `HarnessMode` from the corpus list (`app/dev/harness/page.tsx`, `utils/harnessCorpus.ts`),
  enabled once a bundle has Ground Truth. It loads the GT (existing GET), lets the reviewer
  author ranges over the Detection Frame grid, and saves by merging `detectionAnnotations`
  into the GT PUT payload. Reuse `components/dev/DetectionFrameStepper.tsx` (already renders
  `{start,end}` ranges as a continuous bar + exposes `onAnnotate`),
  `hooks/useDetectionThumbnails.ts`, and the forward-fill control-point model from
  `components/dev/GroundTruthReviewer.tsx`. Label pickers use semantic color tokens (no raw
  palette classes). Pre-seed candidate ranges from the run's `frameQuality` auto-flags when
  available.
- **Additive, no migration** — a Ground Truth without `detectionAnnotations` reads as
  un-annotated; the harness fills gaps with auto classes.

## Testing Decisions

Tests exercise external behavior at the module + route seams — parsed bodies, hash
stability, round-trip — never page state (the harness flow-split page stays untested per
the flag-review precedent; decision logic lives in framework-agnostic utils).

- **`harnessGroundTruth`**: `parseGroundTruthInput` accepts a block with valid
  `detectionAnnotations`; rejects bad enum values, non-integer/inverted ranges; a changed
  `detectionAnnotations` yields an identical `groundTruthHash` (off-hash regression).
- **`groundTruthRoute`**: PUT round-trips `detectionAnnotations` back through GET; the
  existing stale/missing-`setupHash` 409 still holds.

## Out of Scope

- **Harness-side ingest / aggregation** — beta-scan-analysis#45 (done, PR #62): the loader
  that refines auto classes with these labels and the distractor-frequency tables. This
  PRD writes the block; the harness consumes it.
- **Auto-classifying the distractor object** from a crop via a model — the enum + manual
  labels only.
- **User-facing S3 `RouteAttempt`** changes — annotations are a dev-harness artifact.

## Further Notes

- Reconciled against the merged handoff doc
  `docs/handoffs/scanner-detection-annotations.md` (beta-scan-analysis PR #62): the block
  lives in `ground-truth.json`, `failureClass` has **no** `frozen-stale`, and staleness is
  the GT's own `setupHash`. Earlier scaffolding assumed a separate artifact + route + a
  6-value enum; both were corrected here.
- Ground Truth is not just the pattern of record — it is the literal carrier. Extend it
  rather than inventing a parallel artifact.
