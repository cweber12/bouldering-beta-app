# 02 — Downloader: anchor, gate, and cap the Climber selector

Status: ready-for-agent

## Context

The four selector defects live in the downloader repo's `vitpose_job.py`
(PRD problems 1–4). Work happens in the **beta-scan-analysis** repository; this
issue tracks it from the beta-scanner side because the harness owns the contract.

## Scope

Implement `.scratch/vitpose-climber-identity/downloader-selector-fix.md`:

1. Seed anchored to `climber_point.t` window (legacy no-`t`: earliest
   tap-containing box).
2. Climber Crop as a seed gate (expanded ~10%), never a trajectory gate.
3. Association slack capped (`_ASSOC_MAX ≈ 0.18`) + size-continuity band on
   re-acquisition.
4. Remove the un-crop fallback in `_largest_track`.

## Acceptance

- Downloader unit tests (stub tracker/pose seams) cover all four changes; the
  suite passes.
- End-to-end: recalibrate one known-bad clip with a spotter in `/dev/harness`;
  the seed skeleton stays on the climber across the filmstrip.

## Depends on

Issue 01 (the request must carry `t` for the anchoring to have data; the
selector changes that don't need `t` can land regardless).
