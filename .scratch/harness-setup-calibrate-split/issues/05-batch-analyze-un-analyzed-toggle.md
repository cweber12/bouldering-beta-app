# Batch Analyze All / Un-analyzed toggle + pairedRunCount

Status: done
Branch: feat/harness-batch-un-analyzed-toggle
Merged: 74c559a
Type: AFK

## Parent

- `.scratch/harness-setup-calibrate-split/PRD.md`

## What to build

Give Batch Analyze a two-way scope so a pipeline-change re-score (all) is distinct from
filling in never-analyzed bundles (un-analyzed). Surface `pairedRunCount` in the corpus
listing: `countRuns` / `listCorpus` (`app/api/dev/shared.ts`) count runs passing
`runPairsWithTruth`, and the field is added to both the server `CorpusItem` and the
client mirror. `planBatchAnalyze` (`utils/harnessBatch.ts`) gains
`mode: "all" | "un-analyzed"`; "un-analyzed" adds `pairedRunCount === 0` to the existing
fresh-truth + hasSetup gate. The header Batch Analyze control becomes a segmented
`All (N) / Un-analyzed (M)`, both counts from `planBatchAnalyze` previews.

This slice is independent of issues 01–04 and can land in any order.

## Acceptance criteria

- [x] `listCorpus` returns `pairedRunCount` (runs passing `runPairsWithTruth`) on server
      and client `CorpusItem`.
- [x] `planBatchAnalyze` accepts a `mode`; "all" is today's behaviour, "un-analyzed"
      additionally requires `pairedRunCount === 0`.
- [x] The header exposes a segmented All / Un-analyzed control with live counts; the
      chosen plan is frozen at click and drives `BatchAnalyzer` unchanged.
- [x] Type-check, lint, and targeted tests pass
      (`__tests__/utils/harnessBatch.test.ts`, `__tests__/api/dev/listCorpus.test.ts`).

## Blocked by

- (none)
