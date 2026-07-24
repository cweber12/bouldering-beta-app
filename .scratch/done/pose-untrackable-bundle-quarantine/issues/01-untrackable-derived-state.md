# Derive Untrackable state and hold it out of the batch sweeps

Status: done
Branch: feat/untrackable-bundle-quarantine
Merged: ca88ee2
Type: AFK

## Parent

- `.scratch/done/pose-untrackable-bundle-quarantine/PRD.md`

## What to build

A derived **Untrackable** bundle state and the sweep/UI wiring that keeps such
bundles out of Batch Calibrate and Re-seed until a per-bundle re-seed lands
landmarks.

- A pure predicate `scaffoldIsUntrackable(scaffold, setupHash)` — the poseless
  complement of `scaffoldIsSeedReady` among **non-stale** scaffolds.
- `listCorpus` sets `untrackable` on `CorpusItem`, scoped to bundles without
  fresh truth (`!hasGroundTruth || truthStale`) so fresh-truth bundles are
  immune.
- `planBatchCalibrate` and `planReseedSweep` skip Untrackable bundles into a new
  `skippedUntrackable` count, surfaced in the shared sweeper's skip summary.
- The corpus truth column renders a muted `no landmarks` / `stale · no landmarks`
  badge (replacing the `none` / `stale` rows) with a re-seed tooltip.
- `Untrackable` documented in CONTEXT.md.

## Acceptance criteria

- [x] `scaffoldIsUntrackable` is pure, exported, and unit-tested (current poseless ⇒ true; seed-ready ⇒ false; stale poseless ⇒ false; legacy unstamped poseless ⇒ true; no scaffold ⇒ false).
- [x] `listCorpus` reports `untrackable`, with fresh-truth immunity proven by a bundle that has fresh truth + a poseless scaffold reading `untrackable: false`.
- [x] Both sweep planners exclude Untrackable bundles under `skippedUntrackable`, with unit tests for each sweep.
- [x] The sweeper surfaces the `skippedUntrackable` count in both copy variants.
- [x] The corpus badge renders the muted `no landmarks` / `stale · no landmarks` states.
- [x] Quality gate green: `npx tsc --noEmit`, `npx eslint .`, targeted `npx vitest run`.

## Comments

- Implementation: pure predicate in `utils/harnessFreshness.ts`; server scoping
  in `app/api/dev/shared.ts` (`readScaffold` reads the artifact once, feeding
  both `scaffoldIsSeedReady` and `scaffoldIsUntrackable`); sweep planners in
  `utils/harnessReseed.ts`; sweeper copy in `components/dev/ReseedSweeper.tsx`;
  badge in `app/dev/harness/page.tsx`.
- Deliberately **not** built: error-sidecar quarantine (stays retryable),
  timeout quarantine (no disk trace — documented gap in the predicate
  docstring), and a dedicated "Retry untrackable" sweep (per-bundle re-seed is
  the exit while the population is a handful).
