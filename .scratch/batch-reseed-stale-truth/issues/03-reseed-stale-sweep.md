# Re-seed stale sweep on the corpus page

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/batch-reseed-stale-truth/PRD.md`

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

- [ ] Corpus page shows "Re-seed stale (N)" with N = stale-truth bundles needing jobs; disabled at N = 0.
- [ ] Sweep submits jobs one at a time over the dense duration-derived grid via the existing relay routes, never concurrently.
- [ ] Error sidecar, poll timeout, and no-Climber scaffolds each mark the bundle failed with a reason and the sweep continues; a summary lists every outcome.
- [ ] Stop control halts after the in-flight job; listing refreshes as artifacts land.
- [ ] No ground-truth file is written by the sweep.
- [ ] Planner and step functions are pure with unit tests in the Batch Analyze plan-test style (queue membership, seed-ready exclusion, truthless exclusion, every failure classification, advance after success and failure).

## Blocked by

- `.scratch/batch-reseed-stale-truth/issues/01-seed-ready-state.md`
