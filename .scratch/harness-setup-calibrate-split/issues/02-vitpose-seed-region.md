# ViTPose request seeded by seedTap + seedRegion

Status: done
Branch: feat/harness-vitpose-seed-region
Merged: 798c038
Type: AFK

## Parent

- `.scratch/harness-setup-calibrate-split/PRD.md`

## What to build

Change the ViTPose job contract so the seed comes from the off-hash Seed tap, not the
Climber Crop. In `utils/harnessViTPose.ts`, `ViTPoseRequest` replaces its `climberPoint`
seed field with `seedTap` and adds `seedRegion: CropFraction` — a box derived from the
seed tap (tap ± fixed margin, clamped to frame) that the downloader gates the seed
against instead of the Climber Crop. `requestViTPoseForGrid` in the harness page builds
`seedRegion`. Re-point `tapOutsideSeedGate` (`utils/cropContainment.ts`) at `seedRegion`
(now a frame-bounds check, since the tap is always its center) or retire it, and move
the `legacyTapNoTimestamp` caution to the seed-tap context. Document the contract change
in a handoff doc / ADR in the established downloader-contract format so the downloader
work is executable separately.

## Acceptance criteria

- [x] `ViTPoseRequest` carries `seedTap` + `seedRegion` and no longer relies on the
      Climber Crop as the seed gate.
- [x] `seedRegion` is derived from the seed tap and clamped to the frame; unit-tested.
- [x] `requestViTPoseForGrid` sends the new shape; the obsolete out-of-crop caution is
      removed and the legacy-tap caution stays on the seed tap. (Also updated the second
      caller, `ReseedSweeper`, to the same request.)
- [x] A handoff doc/ADR specifies the new request shape and the removed crop gate
      (scanner ships independently; downloader honors it later) —
      `downloader-seed-region-contract.md`.
- [x] Type-check, lint, and targeted tests pass
      (`__tests__/utils/harnessViTPose.test.ts`, `__tests__/utils/cropContainment.test.ts`,
      `__tests__/api/dev/vitposeRoute.test.ts`).

## Blocked by

- `.scratch/harness-setup-calibrate-split/issues/01-seed-tap-off-hash.md`
