# Seed tap persisted off the setupHash

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/harness-setup-calibrate-split/PRD.md`

## What to build

Add an optional `seedTap?: ClimberPoint` to the persisted `ScanSetup` in
`utils/harnessSetup.ts` without adding it to `ScanSetupInput` / `canonicalSetupInput`,
so it is excluded from `setupHash` exactly as `analysisInputs` is. Extend the merging
setup PUT (`app/api/dev/corpus/setup/route.ts`) with a third body kind: a `seedTap`-only
write that preserves the existing crops and `setupHash` byte-for-byte (parallel to the
labels-only path). Add `bodyHasSeedTap()` + validation reusing `isPoint`, and a client
seam `saveSeedTap(bundleKey, seedTap)` next to `saveSetupLabels`. This is the foundation
that makes `setupHash` mean "analysis inputs only" and lets a Seed-tap edit never
re-pair prior runs.

## Acceptance criteria

- [ ] `seedTap?: ClimberPoint` exists on `ScanSetup` (persisted, validated) and is
      absent from `ScanSetupInput` and `canonicalSetupInput`.
- [ ] Re-saving a setup with only `seedTap` changed re-derives an identical `setupHash`
      (pinned by a regression test alongside the existing hash-stability test).
- [ ] The setup PUT accepts a `seedTap`-only body that preserves crops + hash + labels;
      a scan-input body still re-hashes; a labels-only body still preserves crops+hash.
- [ ] `bodyHasSeedTap()` classifies bodies correctly and `saveSeedTap` client seam PUTs
      it.
- [ ] Type-check, lint, and targeted tests pass
      (`__tests__/utils/harnessSetup.test.ts`, `__tests__/api/dev/setupRoute.test.ts`).

## Blocked by

- (none)
