# Re-seed stale sweep on the corpus page

Status: done
Branch: feat/reseed-stale-sweep
Merged: f60882f
Type: AFK

## Parent

- `.scratch/done/pose-batch-reseed-stale-truth/PRD.md`

## What to build

A **"Re-seed stale (N)"** button on the harness corpus page (Batch Analyze
pattern) that works off the ViTPose backlog without opening bundles
individually. N = the queue length: stale-truth bundles that are **not**
seed-ready (per issue 01's predicate); truthless bundles are excluded; the
plan is frozen at click.

The sweep runs **sequentially**, one bundle at a time: fetch the Test Video
through the dev proxy, probe its duration in-browser, build the uniform 100 ms
Detection Frame grid (legacy sparse-grid bundles densify), POST the job
through the existing relay, poll the existing GET until the artifact lands or
a terminal condition hits — downloader error sidecar, poll timeout, or a
scaffold that tracked no Climber — then record the outcome and advance.
Failures skip-and-summarize; no automatic retries (individual retry lives in
the calibrator). A stop control abandons the remaining queue. The corpus
listing refreshes as artifacts land so badges flip to "stale · seed ready"
mid-sweep, and a per-bundle outcome summary shows when the sweep ends. The
sweep never writes Ground Truth — nothing is auto-accepted.

The planner (corpus items → queue + counts) and the per-job step decision
(poll result → land / fail-with-reason / continue polling / advance) are pure,
framework-agnostic functions; the sweep component is a thin shell over them.

## Acceptance criteria

- [x] Corpus page shows "Re-seed stale (N)" with N = stale-truth bundles needing jobs; disabled at N = 0.
- [x] Sweep submits jobs one at a time over the dense duration-derived grid via the existing relay routes, never concurrently.
- [x] Error sidecar, poll timeout, and no-Climber scaffolds each mark the bundle failed with a reason and the sweep continues; a summary lists every outcome.
- [x] Stop control halts after the in-flight job; listing refreshes as artifacts land.
- [x] No ground-truth file is written by the sweep.
- [x] Planner and step functions are pure with unit tests in the Batch Analyze plan-test style (queue membership, seed-ready exclusion, truthless exclusion, every failure classification, advance after success and failure).

## Comments

- 2026-07-18 (implementation): pure logic lives in `utils/harnessReseed.ts`
  (`planReseedSweep` + `decideReseedStep`, terminal decisions carry
  `advance: true`); the sweep shell is `components/dev/ReseedSweeper.tsx`,
  untested by the PRD's testing decision (Batch Analyze precedent), as is the
  in-browser duration probe (extracted to `utils/probeVideoMeta.ts`, shared
  with the calibrator). Criteria 1–5 are verified by the pure tests plus the
  existing relay-route contract tests the sweep is a client of; the sweep
  never calls the ground-truth PUT. The Stop control finishes the in-flight
  job rather than abandoning its poll — the downloader is already running it,
  so stopping earlier would lose only the outcome, not the work. Per issue
  01's comment the live queue today is 5 bundles (3 stale scaffolds + 2
  fresh-but-poseless), not the PRD's snapshot of 3.

## Blocked by

- `.scratch/done/pose-batch-reseed-stale-truth/issues/01-seed-ready-state.md`
