# Three acts: Setup / Calibrate / Analyze flow split

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/harness-setup-calibrate-split/PRD.md`

## What to build

Restructure the harness into three explicit acts. Corpus row actions become
`[Setup] [Calibrate/Re-calibrate] [Analyze]` (`Selection` mode gains `"setup"`;
Calibrate enables once `hasSetup`). Split today's `Calibrator`
(`app/dev/harness/page.tsx`) into:

- **`SetupEditor`** — reuses `StepSetDetection` for Climber Crop + analysis tap + Wall
  Crop + tier, plus the metadata modal. Confirm = `saveSetup()` only (today's
  `handleSaveOnly` flow). Emphasize/highlight the save affordance while the setup is
  dirty.
- **`Calibrator`** (seed-tap-only) — loads the video + setup, shows a scrub + single tap
  affordance pre-filled from `setup.climberPoint` (first time) or the saved `seedTap`.
  Confirm = persist `seedTap` off-hash (issue 01 seam) + `saveAndSeed` the ViTPose job
  (issue 02 request) + open the existing GT flag review. Re-calibrate re-opens the same
  view. The GT review phase, ViTPose poll/seed effects, carry-forward, `Review seed` and
  `Re-run ViTPose` all move across unchanged.

## Acceptance criteria

- [ ] Corpus list shows Setup / Calibrate(or Re-calibrate) / Analyze; Calibrate is gated
      on `hasSetup`, Analyze on `hasSetup` as before.
- [ ] Setup saves crops/tap/wall/tier + metadata without seeding; the save affordance is
      visibly emphasized while dirty.
- [ ] Calibrate is a seed-tap-only view pre-filled from the analysis tap (first time) or
      the saved seed tap; confirming persists the seed tap off-hash and runs ViTPose + GT
      review; `setupHash` is unchanged by a seed re-tap.
- [ ] Existing GT review, carry-forward, Review-seed, and Re-run-ViTPose behaviours are
      preserved.
- [ ] Type-check, lint, and targeted tests pass (page stays untested; verify util seams).

## Blocked by

- `.scratch/harness-setup-calibrate-split/issues/01-seed-tap-off-hash.md`
- `.scratch/harness-setup-calibrate-split/issues/02-vitpose-seed-region.md`
