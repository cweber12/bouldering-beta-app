# Ground Truth Provenance Schema

Status: in-progress
Branch: feat/cfr-01-gt-provenance-schema
Type: AFK

## Parent

- `.scratch/calibration-flag-review/PRD.md`

## What to build

Add the harness contract's Phase 3 provenance fields to Ground Truth end-to-end: a required per-frame `review` value and a required top-level `setupHash` on the persisted `ground-truth.json`, flowing through the model types, the canonical pre-image and `groundTruthHash`, the untrusted-body parser, and the dev-proxy PUT route.

`review` semantics per the contract: `"auto"` (seeded, nobody objected), `"human-flagged-wrong"` (climber present, seed skeleton bad — `state` stays `present`, joints kept), `"human-flagged-absent"` (`state` must be `absent`, joints cleared), `"human"` (accepted by the parser for forward-compat, never emitted by the scanner). `verified` stays in the schema with "nobody objected" semantics — written `true` on every frame at save. Legacy files without `review` load as all-`auto`; `GROUND_TRUTH_VERSION` stays 1 (the shape change is back-compatible on the harness side). Both new fields join the canonical hash pre-image so any flag edit yields a new `groundTruthHash`; the hash and `updatedAt` remain server-authoritative on write.

## Acceptance criteria

- [ ] Persisted Ground Truth carries top-level `setupHash` and per-frame `review`; the PUT route rejects writes missing either.
- [ ] The parser accepts all four contract `review` values and enforces `human-flagged-absent` ⇒ `state: "absent"`.
- [ ] `review` and `setupHash` are part of the canonical pre-image — changing either changes `groundTruthHash`.
- [ ] Legacy saved files without `review` load as all-`auto`; version stays 1.
- [ ] Covered by tests at the schema-module and route seams.

## Blocked by

None - can start immediately
