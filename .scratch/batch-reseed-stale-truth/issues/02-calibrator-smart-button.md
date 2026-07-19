# Calibrator smart button: Review seed / Re-run ViTPose

Status: done
Branch: feat/calibrator-smart-button
Merged: 7c52ff8
Type: AFK

## Parent

- `.scratch/batch-reseed-stale-truth/PRD.md`

## What to build

On a stale-truth bundle, the calibrator checks the on-disk scaffold (via the
existing ViTPose GET, which already withholds stale artifacts) before ever
submitting a job:

- **Fresh + posed scaffold** → the re-seed affordance reads **"Review seed"**
  and enters the flag review directly from the artifact: no POST, no waiting,
  prior Wrong/Absent flags carried forward by timestamp exactly as a job-based
  re-seed would, and Accept stamps the scaffold's own `setupHash` into the
  truth (ADR 0020 — unchanged).
- **Stale or missing scaffold** → the affordance submits a ViTPose job and
  shows seeding progress, exactly as today.
- A secondary **"Re-run ViTPose"** affordance forces a fresh job from either
  state (e.g. after a downloader model update), accepting that the POST
  deletes the existing artifact.

The affordance decision (review-seed vs run-job) is a pure function beside the
existing seed-gate decision, sharing the seed-ready predicate from issue 01.
No server route changes: this slice is purely a client of the existing gates.

## Acceptance criteria

- [x] Opening a stale-truth bundle with a fresh, posed scaffold offers "Review seed"; taking it opens the review from the on-disk artifact with carried-forward flags and no ViTPose POST.
- [x] Accepting from that review clears the stale state (truth stamps the scaffold's hash; server PUT gate passes).
- [x] With a stale or missing scaffold the affordance submits a job and behaves as the current Re-seed flow.
- [x] "Re-run ViTPose" forces a new job even when the scaffold is fresh.
- [x] Affordance decision is a pure function with unit tests beside the seed-gate decision tests (review-seed / run-job outcomes, poseless scaffold falls back to run-job).

## Comments

- 2026-07-18 (implementation): per the PRD's testing decisions the calibrator
  wiring itself is untested (Batch Analyze precedent) — criteria 1-4 are
  verified by the pure decision's unit tests plus the existing seeding-effect
  and save-gate paths the shortcut reuses unchanged. Review seed deliberately
  does **not** save the Scan Setup first: a hash-changing save would invalidate
  the very scaffold being consumed. Editing the Setup and confirming flips the
  affordance back to run-job because the decision re-evaluates against the new
  hash.

## Blocked by

- `.scratch/batch-reseed-stale-truth/issues/01-seed-ready-state.md`
