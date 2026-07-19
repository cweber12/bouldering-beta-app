# Seed-ready state: predicate, corpus listing, badge

Status: ready-for-agent
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

- [ ] Seed-ready predicate lives with the freshness predicates, with unit tests covering the fresh, stale, missing, legacy-unstamped, and poseless-scaffold cases.
- [ ] Corpus lister exposes a seed-ready flag per bundle; temp-directory fixture tests cover seed-ready, fresh-but-poseless, stale-scaffold, and missing-scaffold bundles.
- [ ] Truth badge renders "stale · seed ready" vs "stale" (accepted/none badges unchanged), with an explanatory title.
- [ ] Against the real corpus, the 12 fresh-scaffold stale bundles read seed-ready and the 3 stale-scaffold bundles read plain stale.

## Blocked by

None - can start immediately.
