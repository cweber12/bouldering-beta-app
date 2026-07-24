# detectionAnnotations on Ground Truth: types, parse, off-hash persistence

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/dev-detection-annotation-ui/PRD.md`

## Authoritative schema

`docs/handoffs/scanner-detection-annotations.md` (beta-scan-analysis, PR #62). The block
lives **inside `ground-truth.json`**, not a separate file.

## What to build

Extend `utils/harnessGroundTruth.ts` (framework-agnostic, no React imports):

- Add `FailureClass` union: `"ok" | "wrong-subject" | "hallucination-fp" |
  "flipped-rotated" | "distorted"` (no `frozen-stale`).
- Add `Distractor` union: `"tree_bush" | "rock_wall_shape" | "crash_pad_bag" | "animal" |
  "shadow" | "spectator" | "hallucination_none" | "gear" | "other"`.
- Add `DetectionAnnotationRange { startFrame: number; endFrame: number; failureClass:
  FailureClass; distractor: Distractor }`.
- Add `detectionAnnotations?: DetectionAnnotationRange[]` to the persisted `GroundTruth`
  interface.
- Extend `parseGroundTruthInput` to validate + carry `detectionAnnotations`: enum
  membership, integer `startFrame`/`endFrame` with `startFrame <= endFrame`, `frameIndex`
  bounds; a missing field reads as `[]` (legacy-tolerant, matching the existing `review`
  default). Overlaps are tolerated (harness keeps the later range authoritative).
- **Off-hash:** do **not** add `detectionAnnotations` to `canonicalGroundTruthInput`, so
  `groundTruthHash` is unchanged by annotating — mirroring how `analysisInputs` / `seedTap`
  stay off their hashes. Staleness stays governed by the GT's existing top-level
  `setupHash`.
- Confirm the existing GT PUT (`app/api/dev/corpus/ground-truth/route.ts`) preserves
  `detectionAnnotations` on write (the `...input` spread + `GroundTruth` assembly) and GET
  round-trips it. Likely a one-line inclusion; no freshness-gate change.

## Acceptance criteria

- [ ] `FailureClass` (5 values, no `frozen-stale`), `Distractor` (9 values), and
      `DetectionAnnotationRange` exist and match the handoff doc exactly.
- [ ] `parseGroundTruthInput` accepts valid `detectionAnnotations` and rejects unknown
      enums, non-integer/inverted ranges; a missing field yields `[]`.
- [ ] A changed `detectionAnnotations` yields an identical `groundTruthHash` (off-hash
      regression test alongside the existing hash-stability test).
- [ ] The GT PUT round-trips `detectionAnnotations` through GET; the existing
      stale/missing-`setupHash` 409 behavior is unchanged.
- [ ] Type-check, lint, and `npx vitest run __tests__/utils/harnessGroundTruth.test.ts
      __tests__/api/dev/groundTruthRoute.test.ts` pass.

## Blocked by

- (none) — schema is landed.
