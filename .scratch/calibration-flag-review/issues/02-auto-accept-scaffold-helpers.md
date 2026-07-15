# Auto-Accept Scaffold and Flag Helpers

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/calibration-flag-review/PRD.md`

## What to build

Invert the Ground Truth authoring model in the framework-agnostic scaffold utils, so every Detection Frame arrives accepted and human input reduces to flags:

- **Seeding**: the scaffold seeds every Detection Frame with `review: "auto"`, state as the ViTPose seed dictates (`present` with core joints, `absent` when the seed tracked nothing). The seeded per-joint `occluded` flags (from ViTPose confidence) persist unchanged — they become display-only downstream.
- **Flag application**: a pure helper applies the three-way review toggle to a frame — unflag back to `auto` (state restored from the seed), flag **Wrong** (`review: "human-flagged-wrong"`, `state: "present"`, joints kept as known-bad), flag **Absent** (`review: "human-flagged-absent"`, `state: "absent"`, joints cleared). Flagging a seeded-absent frame Wrong flips it to `present` with empty joints. This replaces the old per-frame state setter; the `skip` state is no longer producible.
- **Staleness rule**: carry-forward of prior saved truth is keyed on `setupHash` — on a match, only the human *flags* carry onto the fresh seed (joints always come from the new seed); on a mismatch or legacy truth without a hash, the scaffold starts clean and reports that prior truth was discarded, so the UI can show a notice.
- **Counts and gating**: pure helpers for the posed / seeded-absent counts and for the seed-source gating decision (ViTPose-ready vs unavailable), extracted so the calibration page carries no decision logic.

## Acceptance criteria

- [ ] A fresh scaffold seeds every frame `review: "auto"` with state from the seed; occluded flags come from seed confidence.
- [ ] The flag helper produces exactly the three UI-emitted review/state/joints combinations, including Wrong-on-seeded-absent ⇒ present with empty joints.
- [ ] Prior flags carry forward only when `setupHash` matches; mismatch or hash-less prior truth starts clean and signals the discard.
- [ ] Posed / seeded-absent counting and seed-gating decisions are pure, tested helpers.
- [ ] Covered by tests at the scaffold-module seam.

## Blocked by

- `.scratch/calibration-flag-review/issues/01-gt-provenance-schema.md`
