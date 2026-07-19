# Batch re-seeding for stale Ground Truth

Status: in-progress

## Problem Statement

After the calibration-freshness work (ADR 0020), recalibrating a Test Video
flips its accepted Ground Truth to a surfaced **stale** state: the truth stamps
an older Scan Setup's `setupHash`, pairs with no run scanned under the current
Setup, and must be re-seeded from a fresh ViTPose scaffold and re-accepted.

Working that backlog off is currently one bundle at a time: open the
calibrator, press Re-seed, wait minutes for the downloader's ViTPose job, then
review and accept. With 16 stale bundles today that is an afternoon of
babysitting — and worse, the Re-seed path always starts a new ViTPose job and
(since the export-race fix) deletes the artifact on disk first, even though
**12 of the 16 stale bundles already hold a fresh scaffold** stamped with the
current `setupHash`. The scanner throws away finished work and re-runs
multi-minute GPU jobs it does not need.

## Solution

Make the backlog a two-step, mostly-waiting-free flow:

1. **A "Re-seed stale" sweep on the harness corpus page** (Batch Analyze
   pattern) that submits ViTPose jobs **only** for stale-truth bundles whose
   scaffold is stale or missing, sequentially, and reports per-bundle outcomes.
   Today that queue is 3 bundles, not 16.
2. **A calibrator that consumes an existing fresh scaffold without running a
   job**: opening a stale-truth bundle whose scaffold already stamps the
   current hash offers "Review seed" — straight into the flag review, human
   flags carried forward by timestamp, zero waiting. A secondary "Re-run
   ViTPose" remains for forcing a fresh job.

The corpus list distinguishes **"stale · seed ready"** (open → review →
accept) from plain **"stale"** (needs the sweep). Nothing is ever
auto-accepted: the sweep only lands scaffolds, and every bundle stays flagged
until the human presses Accept — acceptance is the attestation the freshness
gate exists to protect.

## User Stories

1. As a harness operator, I want a single "Re-seed stale" button on the corpus page, so that I don't have to open each stale bundle individually to start its ViTPose job.
2. As a harness operator, I want the sweep to skip stale-truth bundles whose scaffold is already fresh, so that no multi-minute GPU job is ever re-run for work that is already on disk.
3. As a harness operator, I want the sweep button to show how many bundles actually need jobs, so that I know the cost of a sweep before starting it.
4. As a harness operator, I want the sweep to submit jobs sequentially — one job polled to completion before the next is submitted — so that downloader GPU contention can never occur regardless of how its endpoint schedules work.
5. As a harness operator, I want each submitted job to use the dense uniform Detection Frame grid built from the video's real duration, so that legacy sparse-grid bundles densify onto the canonical 100 ms grid instead of inheriting their old sparse grid.
6. As a harness operator, I want a failed job (downloader error, poll timeout, or a scaffold that tracked no Climber) to be marked failed with its reason and the sweep to continue, so that one bad bundle never strands the rest of the queue.
7. As a harness operator, I want a per-bundle outcome summary when the sweep ends, so that I can see at a glance what landed, what failed, and why.
8. As a harness operator, I want to retry a failed bundle individually from the calibrator, so that I can fix the underlying cause (e.g. re-tap the Climber) rather than blindly re-running.
9. As a harness operator, I want the corpus truth badge to read "stale · seed ready" when a stale-truth bundle's scaffold is fresh and posed, so that I can see which bundles are one click away from review.
10. As a harness operator, I want a scaffold that tracked no Climber to count as failed rather than seed-ready, so that the badge never invites me into a review that authoring would refuse anyway.
11. As a harness operator, I want opening a stale-truth bundle with a fresh scaffold to offer "Review seed", so that I get into the flag review instantly without re-running ViTPose.
12. As a harness operator, I want "Review seed" to carry my prior Wrong/Absent flags forward by timestamp onto the fresh seed, so that my expensive human review survives recalibration.
13. As a harness operator, I want a secondary "Re-run ViTPose" affordance even when the scaffold is fresh, so that I can force a new job after a downloader model update.
14. As a harness operator, I want the smart button to fall back to today's behavior (submit a job, show seeding progress) when the scaffold is stale or missing, so that there is one affordance whatever state the bundle is in.
15. As a harness operator, I want nothing to be auto-accepted by the sweep, so that every accepted Ground Truth reflects an explicit human attestation under the current calibration.
16. As a harness operator, I want the sweep to exclude truthless bundles, so that first-time authoring stays a deliberate act and the known ViTPose-can't-track bundle doesn't burn a poll timeout every sweep.
17. As a harness operator, I want the sweep to refresh the corpus listing as artifacts land, so that badges flip to "stale · seed ready" while the sweep is still running.
18. As a harness operator, I want to stop a running sweep, so that I can reclaim the downloader without killing the dev server or the tab.
19. As a detection-eval maintainer, I want re-seeds to stamp the scaffold's own `setupHash` into the truth on accept (unchanged from ADR 0020), so that the harness's evaluate pairing holds for every re-accepted bundle.
20. As a detection-eval maintainer, I want the sweep to reuse the existing dev-proxy ViTPose routes, so that the freshness gates (artifact deletion on POST, stale-scaffold withholding on GET) apply identically to batch and manual seeding.

## Implementation Decisions

- **Sweep scope**: queue = bundles where truth exists and is stale
  (`truthIsStale`) AND the scaffold is not seed-ready. Seed-ready = scaffold
  stamps the current Scan Setup's `setupHash` (legacy unstamped scaffolds
  qualify via the existing fallback) AND poses at least one Detection Frame.
  Truthless bundles are excluded.
- **Sweep mechanics**: browser-driven from the harness page, one bundle at a
  time: fetch the Test Video through the existing dev proxy, probe its duration
  in-browser, build the uniform 100 ms Detection Frame grid, POST the ViTPose
  job through the existing relay (which deletes the prior artifact + sidecar),
  poll the existing GET until the artifact lands or a terminal condition hits
  (error sidecar, poll timeout, no-Climber scaffold), record the outcome, move
  on. No automatic retries. The plan is frozen at click, mirroring Batch
  Analyze.
- **Pure sweep logic module**: a framework-agnostic planner (corpus items →
  queue + seed-ready + skip counts) and a per-job step function (poll result →
  land / fail(reason) / continue / advance). The React sweep component is a
  thin shell over these, following the Batch Analyze split.
- **Seed-ready predicate** lands beside the existing freshness predicates so
  the lister, the planner, and the calibrator all use one definition.
- **Corpus listing** additionally reads the bundle's `vitpose.json` stamped
  hash and posed-frame presence, and exposes a seed-ready flag per item. The
  truth badge renders "stale · seed ready" vs "stale"; the sweep button's
  count is the queue length (bundles needing jobs), not the stale total.
- **Calibrator smart button**: on a stale-truth bundle, check the scaffold via
  the existing GET before submitting. Fresh + posed → "Review seed": enter the
  review phase seeded from the on-disk artifact (existing carry-forward by
  timestamp; truth stamps the scaffold's hash on accept, per ADR 0020).
  Stale/missing → submit a job exactly as today. A secondary "Re-run ViTPose"
  forces a job from either state. The affordance decision is a pure function
  beside the existing seed-gate decision.
- **No new server routes and no route behavior changes**: the ViTPose GET
  already withholds stale scaffolds and serves fresh ones; the ground-truth
  PUT already refuses stale-hash writes. The sweep and the smart button are
  clients of those gates, never bypasses.
- **No auto-accept anywhere**: the sweep never writes `ground-truth.json`; the
  stale state clears only through the human Accept in the review.
- **ADR alignment**: pure consequence of ADR 0020 (hash-chain freshness) and
  ADR 0019 (ViTPose scaffold, downloader-owned jobs); no new ADR unless the
  implementer finds the smart-button reuse semantics worth recording as an
  amendment note on 0020.

## Testing Decisions

- Tests exercise external behavior at module seams — planner outputs, listed
  corpus fields, route responses — never component internals or fetch
  sequencing details.
- **Pure sweep logic** (planner + step): unit tests in the style of the Batch
  Analyze plan tests — queue membership, seed-ready vs needs-job splits, all
  failure classifications (error sidecar / timeout / no-Climber), and advance
  behavior after both success and failure.
- **Corpus lister**: extend the existing temp-directory fixture tests with
  bundles covering seed-ready (fresh + posed), fresh-but-poseless, stale
  scaffold, and missing scaffold.
- **Freshness predicates**: unit tests for the seed-ready predicate beside the
  existing stale/pairing predicate tests, including the legacy unstamped
  scaffold fallback.
- **Smart-button decision**: unit tests beside the existing seed-gate decision
  tests (review-seed vs run-job vs disabled outcomes).
- **ViTPose route**: regression only — the fresh-serving/stale-withholding
  tests added with ADR 0020 already pin the contract the new clients rely on.
- Untested by decision: the React sweep and calibrator wiring (Batch Analyze
  precedent) and the in-browser video-duration probe (jsdom cannot decode
  video).

## Out of Scope

- Auto-accepting any Ground Truth, including flag-free (pure-auto) truths.
- Batch pre-seeding of truthless bundles / first-time authoring.
- A standalone CLI runner detached from the browser (revisit if the stale
  backlog regularly exceeds a handful of scaffolds).
- Concurrent job submission or downloader-side queue changes (the downloader
  contract is untouched; ViTPose request/artifact shapes stay as ADR 0019).
- Batch review or batch accept UX beyond the one-click-per-bundle review path.
- Retry policies inside the sweep.

## Further Notes

- Corpus reality at writing (2026-07-18): 16 stale-truth bundles; 12 already
  hold a fresh scaffold (seed-ready), 3 hold a stale scaffold (2 of them on
  the legacy 1 s sparse grid — densified by the sweep's re-run), 0 are
  missing one; 1 truthless bundle (the known ViTPose-can't-track case) is
  excluded by scope.
- The sweep keeps the dev server and tab open while running; with sequential
  jobs and today's queue of 3 that is minutes. The CLI escape hatch is the
  recorded fallback if that assumption breaks.
- The smart button materially changes the cost of the export-race protection:
  without it, every Re-seed click pays a full job even when the artifact on
  disk is already correct evidence.
