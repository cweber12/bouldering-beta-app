# 0020 — Calibration freshness: the setupHash chain gates truth and runs

Date: 2026-07-18
Status: accepted
Amends: 0018 (staleness), 0019 (seed consumption); supersedes the video-identity
pairing direction of `.scratch/done/pose-calibration-analyze-split/issues/06`.

## Context

The analysis harness pairs a detection run with a bundle's Ground Truth **iff**
the run's stamped `setupHash` equals the truth's self-reported `setupHash`
(harness ADR 0004; legacy truths without one fall back to the bundle's current
`setup.json`). On 2026-07-18 the harness reported 22 run/truth pairs across 16
bundles skipped on `setupHash mismatch` while the scanner UI showed every one of
those bundles as healthy (harness issue #21, handoff
`.scratch/done/pose-calibration-freshness/scanner-calibration-freshness.md`).

Two scanner-side causes:

1. **The export race.** Ground-truth export seeded from whatever `vitpose.json`
   was on disk. After a recalibration, the previous calibration's artifact was
   still there, so an export before the fresh ViTPose job landed stamped the
   *previous* hash — and every run scanned under the new calibration could never
   pair with it. Documented three times.
2. **No staleness signal.** The scanner had deliberately moved to "video-keyed"
   truth (calibration-analyze-split issue 02) and planned to ask the harness to
   relax its pairing gate to video identity (issue 06). The harness declined:
   truth corrected against one calibration's scaffold is only attested evidence
   under that calibration. With no hash comparison in the UI, stale-but-present
   truth rendered as "accepted".

## Decision

The scanner matches the harness contract instead of asking it to relax.

- **`setupHash` is content-derived** (already true: SHA-256 over canonicalised,
  rounded scan inputs, recomputed server-side). Re-saving an unchanged
  calibration re-derives the identical hash; a regression test pins this.
- **The seed chain is gated.** The ViTPose relay deletes the previous artifact
  (and status sidecar) when a new job starts; the artifact GET withholds a
  scaffold whose stamped hash differs from the current `setup.json` (pending
  while a job is `running`, a terminal "re-run ViTPose" otherwise). The
  ground-truth PUT refuses a write whose `setupHash` is not the current
  setup's (409) — the race is structurally impossible at the write boundary.
- **Truth stamps the scaffold's hash, never `setup.json` at export time.**
- **Staleness is surfaced, not silently discarded.** Truth whose stamped hash
  differs from the current setup's reads **stale** (corpus list badge,
  calibrator banner, Analyze caution) until ViTPose is re-run and the truth
  re-accepted. The truth file itself is kept: human Wrong/Absent flags still
  carry forward by **timestamp** onto the re-seed (the video-keyed carry-forward
  from issue 02 survives; only the "hash pairs nothing" claim is reversed).
- **Runs that pair with no truth are surfaced** as an unpaired count in the
  corpus list; Analyze does not score against stale truth (the run posts
  unscored, matching what evaluate would do anyway); batch Analyze skips
  stale-truth bundles under an explicit count.

The shared predicates live in `utils/harnessFreshness.ts` and are used by the
corpus lister (server), the vitpose/ground-truth routes, the calibration page,
Analyze, and the batch planner.

## Consequences

- Recalibrating a bundle visibly invalidates its truth instead of silently
  orphaning it; the fix path (re-seed → review carried-forward flags → accept)
  reuses the existing flag review, preserving human work.
- The harness's `setupHash mismatch` skips become impossible to create through
  the scanner UI: exports under a stale scaffold are refused at three layers
  (artifact GET, client save gate, ground-truth PUT).
- Legacy artifacts without stamped hashes keep working: they fall back to the
  bundle's current `setup.json`, exactly as harness evaluate does.
