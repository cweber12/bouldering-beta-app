# Extract harness/ as a top-level module

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-conventions-and-enforcement/PRD.md`
- Decision: `docs/adr/0025-mechanically-enforced-layer-boundaries.md` (issue 01)

## Blocked by

Issue 01 — the ADR should record the decision before the move executes it. Not a hard code
dependency; 01 touches no source files.

## What to build

Move the 16 `utils/harness*.ts` files (4,373 lines, 9% of the codebase) into a new top-level
`harness/` directory, a peer of `pipeline/` and `storage/` sitting above `pipeline/` in the layer
graph. This is a **pure move** — no logic changes, no signature changes, no behaviour changes.

This resolves 6 of the 10 `utils/ → pipeline/` inversions in one step: `harnessRuns`,
`harnessScoring`, `harnessPayloads`, `harnessGroundTruthScaffold`, and `harnessViTPose` all import
`pipeline/` types today, which is legal for `harness/` and illegal for `utils/`.

**Drop the now-redundant `harness` prefix** as part of the move — `harness/harnessRuns.ts` stutters,
and every import specifier changes either way, so renaming costs nothing extra:

```text
utils/harnessBatch.ts              → harness/batch.ts
utils/harnessClimbWindow.ts        → harness/climbWindow.ts
utils/harnessContract.ts           → harness/contract.ts
utils/harnessCorpus.ts             → harness/corpus.ts
utils/harnessDetectionGrid.ts      → harness/detectionGrid.ts
utils/harnessFreshness.ts          → harness/freshness.ts
utils/harnessGroundTruth.ts        → harness/groundTruth.ts
utils/harnessGroundTruthScaffold.ts→ harness/groundTruthScaffold.ts
utils/harnessMetadata.ts           → harness/metadata.ts
utils/harnessPayloads.ts           → harness/payloads.ts
utils/harnessReseed.ts             → harness/reseed.ts
utils/harnessRuns.ts               → harness/runs.ts
utils/harnessScoring.ts            → harness/scoring.ts
utils/harnessSetup.ts              → harness/setup.ts
utils/harnessVideoStats.ts         → harness/videoStats.ts
utils/harnessViTPose.ts            → harness/vitpose.ts
```

The last one also settles a three-way naming split — `harnessViTPose.ts` (util) vs `vitpose`
(the `app/api/dev/corpus/vitpose` route segment) vs `ViTPose` (prose). Use `vitpose.ts` to match
the route segment; the prose spelling stays `ViTPose`.

Use `git mv` so rename detection survives in history, then rewrite the `@/utils/harness*` import
specifiers across the 51 importing files (`app/dev/*`, `components/dev/*`, `hooks/`, `__tests__/`,
and sibling harness modules).

Move the 15 matching test files `__tests__/utils/harness*.test.ts` → `__tests__/harness/*.test.ts`
with the same name mapping. This is required to keep AGENTS.md's "test files mirror the source
tree" rule true; it is part of the move, not the `__tests__/` restructuring the PRD excludes.

Write a short `harness/README.md` in the register of the existing `pipeline/README.md` and
`hooks/README.md`, describing what the module owns and its position in the layer graph.

## Acceptance criteria

- [ ] All 16 files live under `harness/` with the prefix dropped per the mapping above, moved with
      `git mv` so history follows.
- [ ] All 15 corresponding test files live under `__tests__/harness/` with matching names.
- [ ] No `@/utils/harness` import specifier remains anywhere in the repo.
- [ ] `utils/` no longer contains any `harness*.ts` file.
- [ ] `harness/README.md` exists and states what the module owns and what it may import.
- [ ] No exported function, type, or constant changed name, signature, or body — the diff outside
      import lines and the `README` is empty.
- [ ] `npx tsc --noEmit` passes with zero output.
- [ ] `npx eslint .` passes.
- [ ] **Full** `npx vitest run` passes with the same test count as before the move.

## Comments

- Verification rests on `tsc` rather than on new tests, and that is deliberate: under
  `"strict": true` with `moduleResolution: "bundler"`, a pure move that type-checks and leaves
  1,404 assertions green has no runtime path on which a broken import could survive.
- The move is scheduled early because the overlap is currently small and grows with every issue
  that lands first. Three of the queued P1 PRDs (`pose-ground-truth-detection-eval`,
  `pose-vitpose-climber-identity`, `dev-harness-review-surfaces`) write directly into these files.
- **Reconcile `fix/harness-review-seed-corpus` before starting.** That unmerged local branch
  (`250b2bb`, 2026-07-22) edits `utils/harnessCorpus.ts` and `utils/harnessFreshness.ts`, both of
  which this issue renames. Either merge it into `main` first or confirm it is abandoned — do not
  rename underneath it and leave the branch to be rebased across a 16-file move.
- Two other unmerged local branches exist. `feat/landing-clip-playlist-update` (`b372a77`) does
  not touch `utils/harness*` and is unaffected here, though it collides with
  `arch-consolidation-cleanup` issue 01 over `app/dev/landing-clip/page.tsx`.
  `refactor/overlay-video-recorder` (`cd75be0`, 2026-07-01) touches neither.
- `utils/harnessCorpus.ts` declares a `CorpusItem` type that mirrors the one in
  `app/api/dev/shared.ts` by hand. Leave the duplication alone here —
  `arch-consolidation-cleanup` issue 03 owns it. Moving it is enough for this issue.
