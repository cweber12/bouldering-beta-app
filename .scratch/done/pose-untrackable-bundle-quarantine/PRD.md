# Untrackable bundle quarantine

Status: done
Disposition: done
Type: AFK

## Problem

A ViTPose seed job that tracks no Climber lands a **poseless** `vitpose.json`
(or a terminal error sidecar). Re-running the *same* seed fails identically, but
the failure verdict was only ephemeral UI state in the sweep — nothing persisted
it. On the next corpus listing the bundle looked identical to a never-jobbed one,
so **Batch Calibrate** re-queued it and burned a full ViTPose poll every sweep.
The re-seed stale sweep had the same waste for stale-truth bundles whose re-seed
posed nothing.

The user wants these bundles **kept** (for a later pass once seeding/tracking
improves), not deleted, but **held out** of the batch sweeps until a deliberate
per-bundle re-seed lands landmarks.

## Approach

Introduce a derived bundle state, **Untrackable**, read straight from the
on-disk artifact — no marker file. A bundle is Untrackable when its
current-calibration ViTPose scaffold poses no Detection Frame **and** it has no
fresh accepted Ground Truth to fall back on (truthless or stale). The state
self-clears when a re-seed replaces the poseless artifact with a posed one,
because a fresh ViTPose POST wipes the prior artifact first.

Scope decisions (see the grilling session that produced this):

- **Poseless-artifact-only trigger.** A bare job-error sidecar with no artifact
  stays retryable (more likely transient); a silent timeout leaves no disk trace
  and cannot be derived — an accepted, documented gap.
- **Fresh-truth immunity.** A bundle with fresh accepted truth is never
  Untrackable, so a later poseless re-seed never yanks its good evidence out of
  Batch Analyze.
- **Stale scaffolds are retryable, not Untrackable** — the scan-affecting inputs
  changed since it was posed, so the failure may not recur.
- **No ADR.** The predicate is trivially reversible; the CONTEXT.md term plus the
  predicate docstring carry the decision.
- **Exit is a per-bundle re-seed** — no dedicated "Retry untrackable" sweep while
  the population is a handful.

## Issues

- `issues/01-untrackable-derived-state.md`
