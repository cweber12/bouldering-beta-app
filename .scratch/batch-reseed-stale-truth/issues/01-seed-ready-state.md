# Seed-ready state: predicate, corpus listing, badge

Status: in-progress
Branch: feat/seed-ready-state
Type: AFK

## Parent

- `.scratch/batch-reseed-stale-truth/PRD.md`

## What to build

A single **seed-ready** definition for a Test Video bundle — its ViTPose
scaffold stamps the current Scan Setup's `setupHash` (legacy unstamped
scaffolds qualify via the existing fallback, matching the other freshness
predicates) **and** poses at least one Detection Frame — surfaced end-to-end:
the predicate lands beside the existing freshness predicates, the corpus
lister reads the bundle's scaffold and exposes a per-item seed-ready flag, and
the harness corpus page's truth badge splits into **"stale · seed ready"**
(fresh scaffold waiting — one click from review once the smart button lands)
vs plain **"stale"** (needs a ViTPose job). A scaffold that tracked no Climber
is never seed-ready.

Both later slices consume this: the calibrator smart button decides its
affordance with the same predicate, and the sweep's queue is stale-truth
bundles that are *not* seed-ready.

## Acceptance criteria

- [x] Seed-ready predicate lives with the freshness predicates, with unit tests covering the fresh, stale, missing, legacy-unstamped, and poseless-scaffold cases.
- [x] Corpus lister exposes a seed-ready flag per bundle; temp-directory fixture tests cover seed-ready, fresh-but-poseless, stale-scaffold, and missing-scaffold bundles.
- [x] Truth badge renders "stale · seed ready" vs "stale" (accepted/none badges unchanged), with an explanatory title.
- [x] Against the real corpus, the 12 fresh-scaffold stale bundles read seed-ready and the 3 stale-scaffold bundles read plain stale.

## Blocked by

None - can start immediately.

## Comments

- 2026-07-18 (implementation): the real-corpus criterion shipped with different
  counts than the PRD snapshot. `listCorpus` against the live corpus reads
  **11 seed-ready / 5 plain stale** (16 stale-truth total). The 3
  stale-scaffold bundles read plain stale exactly as specified; the delta is
  **2 fresh-but-poseless scaffolds** (`get-carter/f04-LTbJ01o_20260711-144150`,
  `get-carter/PC5eZ0Pys90_20260711-144440` — scaffold stamps the current hash
  but poses 0 frames). The PRD's "12 fresh scaffolds" evidently counted them,
  but the seed-ready definition itself (this issue + PRD user story 10)
  requires a no-Climber scaffold to never read seed-ready, so plain stale is
  the correct rendering for those two — they belong in the sweep's queue
  (issue 03), which today is therefore 5 bundles, not 3.
