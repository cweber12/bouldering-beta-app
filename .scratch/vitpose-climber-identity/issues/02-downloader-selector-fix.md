# 02 — Downloader: anchor, gate, and cap the Climber selector

Status: done
Branch: none (cross-repo — work landed in beta-scan-analysis)
Merged: c0d1f18

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

## Comments

Closed 2026-07-17 (per `handoff-beta-scanner-prd-update.md`): all four changes
are implemented and unit-tested in beta-scan-analysis `vitpose_job.py`
(`6445d7a`, seed diagnostics `c7afff9`). The `Merged:` sha above is the
beta-scanner closure-record commit — cross-repo work has no local merge
commit. The changes —
tap-anchored seeding with no global fallback when `t` is present, crop as a
seed-only gate (+10% per side), slack cap `min(0.08 + 0.04·gap, 0.18)` with an
area-ratio band [1/3, 3×] on re-acquisition, and the silent un-crop fallback
removed (crop filtering everyone out now yields an empty trajectory). The
end-to-end acceptance item (recalibrate a known-bad clip in `/dev/harness`)
folds into issue 03, which now validates the follow-up appearance-anchored
stitcher (downloader issue #19) that superseded bare Phase A behaviour.
`downloader-selector-fix.md` is archived.
