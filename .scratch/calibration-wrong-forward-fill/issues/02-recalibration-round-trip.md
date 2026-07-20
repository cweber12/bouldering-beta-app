# Re-calibration round-trip: carry-forward guard, reconstruction, absent soft-retire, reset

Status: in-progress
Branch: feat/wff-02-recalibration-round-trip

## Parent

`.scratch/calibration-wrong-forward-fill/PRD.md`

## What to build

Make the forward-fill structure survive reopening and re-seeding a Test Video,
and complete the ADR 0005 absent-deprecation alignment.

- **Carry-forward guard.** `buildGroundTruthScaffold` carries a prior Wrong
  forward by timestamp **only when the new seed frame has joints**; a carried
  Wrong onto a now-empty seed reverts to seeded-absent `auto` (never the
  degenerate `state: "present"` with empty joints). A carried legacy
  `human-flagged-absent` maps to `auto`, taking `state` from the seed — which
  delivers ADR 0005's optional `absent → auto` migration automatically on the
  next save, with no bulk script.
- **Control-point reconstruction.** When the working copy is built from a loaded
  or carried-forward file, reconstruct the control points by comparing each
  seeded frame to the **previous seeded frame** (absent frames skipped), so an
  absent gap inside a Wrong stretch never fabricates a boundary and the structure
  comes back editable exactly as it was left.
- **Reset-to-seed.** A "Discard flags — reset to seed" button in the review
  header resets the working copy to the pure ViTPose scaffold (all `auto`,
  `state` from seed). Un-saved until Accept, so backing out of the review
  discards the reset.

Presence stays `state`, never a flag; the scanner emits only `auto` and
`human-flagged-wrong`; the parser still reads legacy `human-flagged-absent`
files. `groundTruthHash` continues to be recomputed on every save.

## Acceptance criteria

- [x] On re-seed, a prior Wrong on a now-empty seed frame becomes seeded-absent
      `auto`; a prior Wrong on a still-posed frame is kept; a legacy
      `human-flagged-absent` becomes `auto` with `state` from the new seed.
- [x] Reopening a saved video restores the exact editable Wrong/Auto structure;
      a Wrong stretch that spanned an absent gap comes back as one stretch (the
      gap adds no boundary).
- [x] The "Discard flags — reset to seed" button resets the working copy to the
      pure scaffold and is reversible by leaving the review without saving.
- [x] No new `human-flagged-absent` is written on any save or re-seed path; the
      parser still loads legacy files containing it.
- [x] `groundTruthHash` is recomputed on save over the materialized review
      values; a re-review produces a new hash.
- [x] ADR 0018/0005 alignment note recorded (presence-from-state, absent
      soft-retire).
- [x] Scaffold-module unit tests cover the carry-forward guard (all three cases),
      reconstruction skipping absent, and a `reconstruct(materialize(derive(...)))`
      round-trip property. `npx tsc --noEmit`, `npx eslint .`, and the targeted
      `npx vitest run` pass.

## Blocked by

- `.scratch/calibration-wrong-forward-fill/issues/01-forward-fill-core.md`
