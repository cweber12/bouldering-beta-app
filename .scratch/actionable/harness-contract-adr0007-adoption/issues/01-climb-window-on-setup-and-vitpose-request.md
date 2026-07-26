# Climb window on the Scan Setup and the ViTPose request

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/harness-contract-adr0007-adoption/PRD.md`
- Spec: `beta-scan-analysis/docs/handoffs/scanner-tap-split-adr0007.md` §3–§4
- Why now: `beta-scan-analysis/docs/handoffs/scanner-reset-sequencing-reply.md`

## What to build

Make the climb window **writable and transmissible**. No UI in this issue — the
capture gesture is issue 02. This is the slice the harness is actually blocked
on: once `climbEnd` can exist on a bundle, a re-calibration produces a correct
one and the corpus reset can be scheduled.

1. **`climbEnd?: number` on `ScanSetup`**, seconds into the video. **Off-hash.**
   `setupHash` is computed from `pickScanInput` / `canonicalSetupInput`
   (`utils/harnessSetup.ts`), which covers `climberCrop`, `wallCrop`,
   `climberPoint`, `panning`, `qualityTier`. `climbEnd` must not join that set —
   adding it would invalidate all 90 existing calibrations and mark every prior
   run stale through the freshness chain (ADR 0020). Follow `seedTap`'s
   precedent exactly: merged on write, carried forward when absent from the body,
   cleared by an explicit `null`.

2. **A `climbEnd`-only save path** on `POST /api/dev/corpus/setup`, mirroring the
   existing `seedTap`-only body. Like that one, it must refuse to create a setup
   from nothing (422 when there is no saved setup to merge onto) and must leave
   `setupHash` untouched.

3. **Validation.** `climbEnd` must be a finite number ≥ 0 and strictly greater
   than the climb start (the setup tap's `t`) when that is known. Reject with 422
   rather than writing a window the harness will 422 on later — the endpoint's
   own rule is `climb_end > climb_start`, both ≥ 0.

4. **Send the window on `POST /api/dev/corpus/vitpose`**: `climb_start` from the
   setup tap's `t`, `climb_end` from `climbEnd`. Both optional — omit a field
   rather than sending null/NaN when its source is absent, since the harness
   falls back to the bundle's `setup.json`.

## Acceptance criteria

- [ ] `climbEnd` round-trips through `setup.json` and is absent (never `null` or
      `0`) when unset.
- [ ] Adding, changing, or clearing `climbEnd` leaves `setupHash` byte-identical
      — pinned by a test that hashes a setup with and without it.
- [ ] A `climbEnd`-only body merges onto the saved setup without disturbing
      crops, `climberPoint`, `panning`, `qualityTier`, `seedTap`, labels, or
      provenance.
- [ ] A `climbEnd`-only body with no saved setup returns 422, matching the
      `seedTap` path.
- [ ] `climbEnd` ≤ the setup tap's `t`, negative, or non-finite returns 422 and
      writes nothing.
- [ ] The ViTPose request carries `climb_start` / `climb_end` when known and
      omits each independently when not; a bundle with neither produces a request
      byte-identical to today's.
- [ ] No detection behavior changes — the seek loop still analyses the whole
      video, and `frames[]` for a given input is unchanged.

## Comments

- The window is a **scoring** concept the harness applies, not a bound on our
  seek loop. Truncating analysis at `climbEnd` would be a detection-behavior
  change and would confound the loss-recovery 03/04 measurements. Explicitly out
  of scope.
- `climb_start` needs no new gesture or field: it is `climberPoint.t`, which the
  human already supplied at calibration. Note that 27 bundles currently carry a
  setup tap sitting mid-climb from the pre-split overwrite bug — those are not
  repairable here and are why the harness resets rather than migrates.
- Both request fields also accept camelCase. Pick one form and keep it
  consistent with the existing `seed_tap` / `seed_region` snake_case body.
